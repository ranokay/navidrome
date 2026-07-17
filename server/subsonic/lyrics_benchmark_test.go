package subsonic

import (
	"context"
	"encoding/json"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/navidrome/navidrome/conf"
	"github.com/navidrome/navidrome/conf/configtest"
	"github.com/navidrome/navidrome/consts"
	"github.com/navidrome/navidrome/core/lyrics"
	"github.com/navidrome/navidrome/core/storage/local"
	"github.com/navidrome/navidrome/model"
	"github.com/navidrome/navidrome/model/metadata"
	"github.com/navidrome/navidrome/tests"
)

var subsonicBenchmarkStorageOnce sync.Once

type subsonicBenchmarkDurations []time.Duration

func (d *subsonicBenchmarkDurations) measure(run func()) {
	started := time.Now()
	run()
	if len(*d) < 10_000 {
		*d = append(*d, time.Since(started))
	}
}

func (d subsonicBenchmarkDurations) report(b *testing.B) {
	if len(d) == 0 {
		return
	}
	values := append([]time.Duration(nil), d...)
	sort.Slice(values, func(i, j int) bool { return values[i] < values[j] })
	index := (95*len(values)+99)/100 - 1
	b.ReportMetric(float64(values[index].Nanoseconds()), "p95-ns/op")
}

type subsonicBenchmarkProvider struct {
	lyrics model.LyricList
	delay  time.Duration
	calls  atomic.Int64
}

func (p *subsonicBenchmarkProvider) GetLyrics(ctx context.Context, _ *model.MediaFile) (model.LyricList, error) {
	p.calls.Add(1)
	if p.delay > 0 {
		timer := time.NewTimer(p.delay)
		defer timer.Stop()
		select {
		case <-timer.C:
		case <-ctx.Done():
			return nil, ctx.Err()
		}
	}
	return p.lyrics, nil
}

type subsonicBenchmarkLoader struct {
	provider *subsonicBenchmarkProvider
}

func (l subsonicBenchmarkLoader) LoadLyricsProvider(string) (lyrics.Provider, bool) {
	return l.provider, l.provider != nil
}

type subsonicBenchmarkExtractor struct{}

func (subsonicBenchmarkExtractor) Parse(...string) (map[string]metadata.Info, error) { return nil, nil }
func (subsonicBenchmarkExtractor) Version() string                                   { return "benchmark" }

func subsonicBenchmarkLyrics() model.LyricList {
	start := int64(1000)
	end := int64(2500)
	return model.LyricList{{
		Kind:   model.LyricKindMain,
		Lang:   "eng",
		Synced: true,
		Line:   []model.Line{{Start: &start, End: &end, Value: "A deterministic lyric line"}},
	}}
}

func subsonicBenchmarkMediaFiles(b *testing.B) (embedded, sidecar, empty model.MediaFile) {
	b.Helper()
	subsonicBenchmarkStorageOnce.Do(func() {
		local.RegisterExtractor(consts.DefaultScannerExtractor, func(fs.FS, string) local.Extractor {
			return subsonicBenchmarkExtractor{}
		})
	})

	dir := b.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "sidecar.lrc"), []byte("[00:01.00]A deterministic lyric line\n"), 0o600); err != nil {
		b.Fatal(err)
	}
	embeddedJSON, err := json.Marshal(subsonicBenchmarkLyrics())
	if err != nil {
		b.Fatal(err)
	}

	embedded = model.MediaFile{ID: "embedded", LibraryPath: dir, Path: "embedded.mp3", Lyrics: string(embeddedJSON)}
	sidecar = model.MediaFile{ID: "sidecar", LibraryPath: dir, Path: "sidecar.mp3"}
	empty = model.MediaFile{ID: "empty", LibraryPath: dir, Path: "empty.mp3"}
	return embedded, sidecar, empty
}

func newSubsonicBenchmarkRouter(ds model.DataStore, loader subsonicBenchmarkLoader) *Router {
	service := lyrics.NewLyrics(ds, loader)
	return &Router{ds: ds, lyrics: service}
}

func BenchmarkLyricsHTTP(b *testing.B) {
	defer configtest.SetupConfig()()
	embedded, sidecar, empty := subsonicBenchmarkMediaFiles(b)
	repo := &tests.MockMediaFileRepo{}
	repo.SetData(model.MediaFiles{embedded, sidecar, empty})
	ds := &tests.MockDataStore{MockedMediaFile: repo}

	for _, fixture := range []struct {
		name     string
		priority string
		id       string
		provider *subsonicBenchmarkProvider
	}{
		{name: "Embedded", priority: "embedded", id: embedded.ID},
		{name: "Sidecar", priority: ".lrc", id: sidecar.ID},
		{name: "Empty", priority: "embedded,.lrc", id: empty.ID},
		{name: "Plugin50ms", priority: "benchmark-plugin", id: empty.ID, provider: &subsonicBenchmarkProvider{lyrics: subsonicBenchmarkLyrics(), delay: 50 * time.Millisecond}},
	} {
		b.Run(fixture.name, func(b *testing.B) {
			conf.Server.LyricsPriority = fixture.priority
			for _, mode := range []string{"Cold", "Repeated"} {
				b.Run(mode, func(b *testing.B) {
					loader := subsonicBenchmarkLoader{provider: fixture.provider}
					var router *Router
					if mode == "Repeated" {
						router = newSubsonicBenchmarkRouter(ds, loader)
					}
					if fixture.provider != nil {
						fixture.provider.calls.Store(0)
					}
					durations := subsonicBenchmarkDurations{}
					b.ReportAllocs()
					b.ResetTimer()
					for i := 0; i < b.N; i++ {
						if mode == "Cold" {
							router = newSubsonicBenchmarkRouter(ds, loader)
						}
						durations.measure(func() {
							if _, err := router.GetLyricsBySongId(newGetRequest("id=" + fixture.id)); err != nil {
								b.Fatal(err)
							}
						})
					}
					b.StopTimer()
					durations.report(b)
					if fixture.provider != nil {
						b.ReportMetric(float64(fixture.provider.calls.Load())/float64(b.N), "provider-calls/op")
					}
				})
			}
		})
	}
}

func BenchmarkLyricsHTTPFanout(b *testing.B) {
	defer configtest.SetupConfig()()
	conf.Server.LyricsPriority = "benchmark-plugin"
	_, _, mf := subsonicBenchmarkMediaFiles(b)
	repo := &tests.MockMediaFileRepo{}
	repo.SetData(model.MediaFiles{mf})
	ds := &tests.MockDataStore{MockedMediaFile: repo}

	for _, fanout := range []int{16, 32} {
		b.Run(fmt.Sprintf("Fanout%d", fanout), func(b *testing.B) {
			provider := &subsonicBenchmarkProvider{lyrics: subsonicBenchmarkLyrics(), delay: 50 * time.Millisecond}
			router := newSubsonicBenchmarkRouter(ds, subsonicBenchmarkLoader{provider: provider})
			durations := subsonicBenchmarkDurations{}
			var failures atomic.Int64
			b.ReportAllocs()
			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				durations.measure(func() {
					start := make(chan struct{})
					var wg sync.WaitGroup
					wg.Add(fanout)
					for range fanout {
						go func() {
							defer wg.Done()
							<-start
							response, err := router.GetLyricsBySongId(newGetRequest("id=" + mf.ID))
							if err != nil || response == nil || response.LyricsList == nil {
								failures.Add(1)
							}
						}()
					}
					close(start)
					wg.Wait()
				})
			}
			b.StopTimer()
			if failures.Load() != 0 {
				b.Fatalf("%d concurrent HTTP resolutions failed", failures.Load())
			}
			durations.report(b)
			b.ReportMetric(float64(provider.calls.Load())/float64(b.N), "provider-calls/op")
		})
	}
}
