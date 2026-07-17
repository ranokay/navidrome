package jellyfin

import (
	"context"
	"encoding/json"
	"fmt"
	"io/fs"
	"net/http"
	"net/http/httptest"
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
	"github.com/navidrome/navidrome/model/request"
	"github.com/navidrome/navidrome/server/jellyfin/dto"
	"github.com/navidrome/navidrome/server/subsonic"
	"github.com/navidrome/navidrome/tests"
	"github.com/navidrome/navidrome/utils/cache"
)

var jellyfinBenchmarkStorageOnce sync.Once

type jellyfinBenchmarkDurations []time.Duration

func (d *jellyfinBenchmarkDurations) measure(run func()) {
	started := time.Now()
	run()
	if len(*d) < 10_000 {
		*d = append(*d, time.Since(started))
	}
}

func (d jellyfinBenchmarkDurations) report(b *testing.B) {
	if len(d) == 0 {
		return
	}
	values := append([]time.Duration(nil), d...)
	sort.Slice(values, func(i, j int) bool { return values[i] < values[j] })
	index := (95*len(values)+99)/100 - 1
	b.ReportMetric(float64(values[index].Nanoseconds()), "p95-ns/op")
}

type jellyfinBenchmarkProvider struct {
	lyrics model.LyricList
	delay  time.Duration
	calls  atomic.Int64
}

func (p *jellyfinBenchmarkProvider) GetLyrics(ctx context.Context, _ *model.MediaFile) (model.LyricList, error) {
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

type jellyfinBenchmarkLoader struct {
	provider *jellyfinBenchmarkProvider
}

func (l jellyfinBenchmarkLoader) LoadLyricsProvider(string) (lyrics.Provider, bool) {
	return l.provider, l.provider != nil
}

type jellyfinBenchmarkExtractor struct{}

func (jellyfinBenchmarkExtractor) Parse(...string) (map[string]metadata.Info, error) { return nil, nil }
func (jellyfinBenchmarkExtractor) Version() string                                   { return "benchmark" }

func jellyfinBenchmarkLyrics() model.LyricList {
	start := int64(1000)
	end := int64(2500)
	return model.LyricList{{
		Kind:   model.LyricKindMain,
		Lang:   "eng",
		Synced: true,
		Line:   []model.Line{{Start: &start, End: &end, Value: "A deterministic lyric line"}},
	}}
}

func jellyfinBenchmarkMediaFiles(b *testing.B) (embedded, sidecar, empty model.MediaFile) {
	b.Helper()
	jellyfinBenchmarkStorageOnce.Do(func() {
		local.RegisterExtractor(consts.DefaultScannerExtractor, func(fs.FS, string) local.Extractor {
			return jellyfinBenchmarkExtractor{}
		})
	})

	dir := b.TempDir()
	if err := os.WriteFile(filepath.Join(dir, "sidecar.lrc"), []byte("[00:01.00]A deterministic lyric line\n"), 0o600); err != nil {
		b.Fatal(err)
	}
	embeddedJSON, err := json.Marshal(jellyfinBenchmarkLyrics())
	if err != nil {
		b.Fatal(err)
	}

	embedded = model.MediaFile{ID: "embedded", LibraryID: 1, LibraryPath: dir, Path: "embedded.mp3", Lyrics: string(embeddedJSON)}
	sidecar = model.MediaFile{ID: "sidecar", LibraryID: 1, LibraryPath: dir, Path: "sidecar.mp3"}
	empty = model.MediaFile{ID: "empty", LibraryID: 1, LibraryPath: dir, Path: "empty.mp3"}
	return embedded, sidecar, empty
}

func newJellyfinBenchmarkRouter(ds model.DataStore, service lyrics.Lyrics) *Router {
	return &Router{
		ds:     ds,
		lyrics: service,
		lyricsCache: cache.NewSimpleCache[string, model.LyricList](cache.Options{
			SizeLimit:  1000,
			DefaultTTL: 5 * time.Minute,
		}),
	}
}

func runJellyfinBenchmarkRequest(api *Router, id string) int {
	user := model.User{ID: "benchmark-user", Libraries: model.Libraries{{ID: 1}}}
	ctx := request.WithUser(context.Background(), user)
	encoded := dto.EncodeID(id)
	r := httptest.NewRequest(http.MethodGet, "/Audio/"+encoded+"/Lyrics", nil).WithContext(ctx)
	r = withChiURLParam(r, "itemId", encoded)
	w := httptest.NewRecorder()
	invoke(api.getLyrics, w, r)
	return w.Code
}

func BenchmarkLyricsHTTP(b *testing.B) {
	defer configtest.SetupConfig()()
	embedded, sidecar, empty := jellyfinBenchmarkMediaFiles(b)
	repo := &tests.MockMediaFileRepo{}
	repo.SetData(model.MediaFiles{embedded, sidecar, empty})
	ds := &tests.MockDataStore{MockedMediaFile: repo}

	for _, fixture := range []struct {
		name       string
		priority   string
		id         string
		wantStatus int
		provider   *jellyfinBenchmarkProvider
	}{
		{name: "Embedded", priority: "embedded", id: embedded.ID, wantStatus: http.StatusOK},
		{name: "Sidecar", priority: ".lrc", id: sidecar.ID, wantStatus: http.StatusOK},
		{name: "Empty", priority: "embedded,.lrc", id: empty.ID, wantStatus: http.StatusNotFound},
		{name: "Plugin50ms", priority: "benchmark-plugin", id: empty.ID, wantStatus: http.StatusOK, provider: &jellyfinBenchmarkProvider{lyrics: jellyfinBenchmarkLyrics(), delay: 50 * time.Millisecond}},
	} {
		b.Run(fixture.name, func(b *testing.B) {
			conf.Server.LyricsPriority = fixture.priority
			for _, mode := range []string{"Cold", "Repeated"} {
				b.Run(mode, func(b *testing.B) {
					loader := jellyfinBenchmarkLoader{provider: fixture.provider}
					service := lyrics.NewLyrics(ds, loader)
					var api *Router
					if mode == "Repeated" {
						api = newJellyfinBenchmarkRouter(ds, service)
					}
					if fixture.provider != nil {
						fixture.provider.calls.Store(0)
					}
					durations := jellyfinBenchmarkDurations{}
					b.ReportAllocs()
					b.ResetTimer()
					for i := 0; i < b.N; i++ {
						if mode == "Cold" {
							api = newJellyfinBenchmarkRouter(ds, service)
						}
						durations.measure(func() {
							if status := runJellyfinBenchmarkRequest(api, fixture.id); status != fixture.wantStatus {
								b.Fatalf("status=%d, want %d", status, fixture.wantStatus)
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
	_, _, mf := jellyfinBenchmarkMediaFiles(b)
	repo := &tests.MockMediaFileRepo{}
	repo.SetData(model.MediaFiles{mf})
	ds := &tests.MockDataStore{MockedMediaFile: repo}

	for _, fanout := range []int{16, 32} {
		b.Run(fmt.Sprintf("Fanout%d", fanout), func(b *testing.B) {
			provider := &jellyfinBenchmarkProvider{lyrics: jellyfinBenchmarkLyrics(), delay: 50 * time.Millisecond}
			service := lyrics.NewLyrics(ds, jellyfinBenchmarkLoader{provider: provider})
			durations := jellyfinBenchmarkDurations{}
			var failures atomic.Int64
			b.ReportAllocs()
			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				api := newJellyfinBenchmarkRouter(ds, service)
				durations.measure(func() {
					start := make(chan struct{})
					var wg sync.WaitGroup
					wg.Add(fanout)
					for range fanout {
						go func() {
							defer wg.Done()
							<-start
							if runJellyfinBenchmarkRequest(api, mf.ID) != http.StatusOK {
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

func BenchmarkLyricsCrossProtocol(b *testing.B) {
	defer configtest.SetupConfig()()
	conf.Server.LyricsPriority = "benchmark-plugin"
	_, _, mf := jellyfinBenchmarkMediaFiles(b)
	repo := &tests.MockMediaFileRepo{}
	repo.SetData(model.MediaFiles{mf})
	ds := &tests.MockDataStore{MockedMediaFile: repo}

	for _, mode := range []string{"Cold", "Repeated"} {
		b.Run(mode, func(b *testing.B) {
			provider := &jellyfinBenchmarkProvider{lyrics: jellyfinBenchmarkLyrics(), delay: 50 * time.Millisecond}
			service := lyrics.NewLyrics(ds, jellyfinBenchmarkLoader{provider: provider})
			var jellyfinAPI *Router
			var subsonicAPI *subsonic.Router
			if mode == "Repeated" {
				jellyfinAPI = newJellyfinBenchmarkRouter(ds, service)
				subsonicAPI = subsonic.New(ds, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, service, nil, nil)
			}
			durations := jellyfinBenchmarkDurations{}
			b.ReportAllocs()
			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				if mode == "Cold" {
					jellyfinAPI = newJellyfinBenchmarkRouter(ds, service)
					subsonicAPI = subsonic.New(ds, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, nil, service, nil, nil)
				}
				durations.measure(func() {
					r := httptest.NewRequest(http.MethodGet, "/getLyricsBySongId?id="+mf.ID, nil)
					if _, err := subsonicAPI.GetLyricsBySongId(r); err != nil {
						b.Fatal(err)
					}
					if status := runJellyfinBenchmarkRequest(jellyfinAPI, mf.ID); status != http.StatusOK {
						b.Fatalf("status=%d, want %d", status, http.StatusOK)
					}
				})
			}
			b.StopTimer()
			durations.report(b)
			b.ReportMetric(float64(provider.calls.Load())/float64(b.N), "provider-calls/op")
		})
	}
}
