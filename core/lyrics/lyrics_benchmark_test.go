package lyrics_test

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
)

const benchmarkSampleLimit = 10_000

var benchmarkStorageOnce sync.Once

type benchmarkDurations struct {
	values []time.Duration
}

func (d *benchmarkDurations) measure(run func()) {
	started := time.Now()
	run()
	if len(d.values) < benchmarkSampleLimit {
		d.values = append(d.values, time.Since(started))
	}
}

func (d *benchmarkDurations) report(b *testing.B) {
	if len(d.values) == 0 {
		return
	}
	values := append([]time.Duration(nil), d.values...)
	sort.Slice(values, func(i, j int) bool { return values[i] < values[j] })
	index := (95*len(values)+99)/100 - 1
	b.ReportMetric(float64(values[index].Nanoseconds()), "p95-ns/op")
}

type benchmarkLyricsProvider struct {
	lyrics model.LyricList
	delay  time.Duration
	calls  atomic.Int64
}

func (p *benchmarkLyricsProvider) GetLyrics(ctx context.Context, _ *model.MediaFile) (model.LyricList, error) {
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

type benchmarkPluginLoader struct {
	provider *benchmarkLyricsProvider
}

func (l benchmarkPluginLoader) LoadLyricsProvider(string) (lyrics.Provider, bool) {
	return l.provider, l.provider != nil
}

func benchmarkLyricList() model.LyricList {
	start := int64(1000)
	end := int64(2500)
	return model.LyricList{{
		Kind:   model.LyricKindMain,
		Lang:   "eng",
		Synced: true,
		Line:   []model.Line{{Start: &start, End: &end, Value: "A deterministic lyric line"}},
	}}
}

func benchmarkMediaFiles(b *testing.B) (embedded, sidecar, empty model.MediaFile) {
	b.Helper()
	benchmarkStorageOnce.Do(func() {
		local.RegisterExtractor(consts.DefaultScannerExtractor, func(_ fs.FS, _ string) local.Extractor {
			return &noopExtractor{}
		})
	})

	dir := b.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "song.lrc"), []byte("[00:01.00]A deterministic lyric line\n"), 0o600); err != nil {
		b.Fatal(err)
	}
	embeddedJSON, err := json.Marshal(benchmarkLyricList())
	if err != nil {
		b.Fatal(err)
	}

	base := model.MediaFile{ID: "benchmark-track", LibraryPath: dir, Path: "song.mp3"}
	embedded = base
	embedded.Lyrics = string(embeddedJSON)
	return embedded, base, model.MediaFile{ID: base.ID, LibraryPath: dir, Path: "missing.mp3"}
}

func BenchmarkLyricsResolution(b *testing.B) {
	defer configtest.SetupConfig()()
	embedded, sidecar, empty := benchmarkMediaFiles(b)

	for _, fixture := range []struct {
		name     string
		priority string
		mf       model.MediaFile
		provider *benchmarkLyricsProvider
	}{
		{name: "Embedded", priority: "embedded", mf: embedded},
		{name: "Sidecar", priority: ".lrc", mf: sidecar},
		{name: "Empty", priority: "embedded,.lrc", mf: empty},
		{name: "Plugin50ms", priority: "benchmark-plugin", mf: empty, provider: &benchmarkLyricsProvider{lyrics: benchmarkLyricList(), delay: 50 * time.Millisecond}},
	} {
		b.Run(fixture.name, func(b *testing.B) {
			conf.Server.LyricsPriority = fixture.priority
			for _, mode := range []string{"Cold", "Repeated"} {
				b.Run(mode, func(b *testing.B) {
					var service lyrics.Lyrics
					if mode == "Repeated" {
						service = lyrics.NewLyrics(nil, benchmarkPluginLoader{provider: fixture.provider})
					}
					if fixture.provider != nil {
						fixture.provider.calls.Store(0)
					}
					ctx := context.Background()
					durations := benchmarkDurations{}
					b.ReportAllocs()
					b.ResetTimer()
					for i := 0; i < b.N; i++ {
						if mode == "Cold" {
							service = lyrics.NewLyrics(nil, benchmarkPluginLoader{provider: fixture.provider})
						}
						durations.measure(func() {
							if _, err := service.GetLyrics(ctx, &fixture.mf); err != nil {
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

func BenchmarkLyricsResolutionFanout(b *testing.B) {
	defer configtest.SetupConfig()()
	conf.Server.LyricsPriority = "benchmark-plugin"
	_, _, mf := benchmarkMediaFiles(b)

	for _, fanout := range []int{16, 32} {
		b.Run(fmt.Sprintf("Fanout%d", fanout), func(b *testing.B) {
			provider := &benchmarkLyricsProvider{lyrics: benchmarkLyricList(), delay: 50 * time.Millisecond}
			service := lyrics.NewLyrics(nil, benchmarkPluginLoader{provider: provider})
			durations := benchmarkDurations{}
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
							list, err := service.GetLyrics(context.Background(), &mf)
							if err != nil || len(list) == 0 {
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
				b.Fatalf("%d concurrent resolutions failed", failures.Load())
			}
			durations.report(b)
			b.ReportMetric(float64(provider.calls.Load())/float64(b.N), "provider-calls/op")
		})
	}
}

func BenchmarkSidecarFingerprint(b *testing.B) {
	dir := b.TempDir()
	path := filepath.Join(dir, "song.lrc")
	if err := os.WriteFile(path, []byte("[00:01.00]A deterministic lyric line\n"), 0o600); err != nil {
		b.Fatal(err)
	}

	durations := benchmarkDurations{}
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		durations.measure(func() {
			if _, err := os.Stat(path); err != nil {
				b.Fatal(err)
			}
		})
	}
	b.StopTimer()
	durations.report(b)
}
