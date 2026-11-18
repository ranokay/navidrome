package lyrics_test

import (
	"context"
	"sync/atomic"
	"testing"
	"time"

	"github.com/navidrome/navidrome/conf"
	"github.com/navidrome/navidrome/core/lyrics"
	"github.com/navidrome/navidrome/model"
	"github.com/onsi/gomega"
)

type refreshProvider struct {
	calls       atomic.Int32
	active      atomic.Int32
	maxActive   atomic.Int32
	started     chan struct{}
	release     chan struct{}
	refresh     atomic.Int32
	aborts      atomic.Int32
	unsupported bool
}

func (p *refreshProvider) GetLyrics(context.Context, *model.MediaFile) (model.LyricList, error) {
	return model.LyricList{{Lang: "eng", Line: []model.Line{{Value: "line"}}}}, nil
}

func (p *refreshProvider) GetLyricsDetailedResult(context.Context, *model.MediaFile) (model.LyricsResult, error) {
	return model.LyricsResult{Lyrics: model.LyricList{{Lang: "eng", Line: []model.Line{{Value: "line"}}}}}, nil
}

func (p *refreshProvider) PublicationGeneration() string { return "generation" }

func (p *refreshProvider) StartPublication(context.Context, *model.MediaFile, string) (model.LyricsPublication, bool, error) {
	return model.LyricsPublication{Generation: "generation", Token: "token", Kind: "refresh"}, true, nil
}

func (p *refreshProvider) GetLyricsWithPublication(ctx context.Context, mf *model.MediaFile, _ model.LyricsPublication) (model.LyricList, model.LyricsDiscovery, bool, error) {
	list, err := p.GetLyrics(ctx, mf)
	return list, model.LyricsDiscovery{}, true, err
}

func (p *refreshProvider) GetLyricsDetailedResultWithRefresh(ctx context.Context, mf *model.MediaFile, pub model.LyricsPublication, refresh bool) (model.LyricsResult, bool, error) {
	current := p.active.Add(1)
	for {
		max := p.maxActive.Load()
		if current <= max || p.maxActive.CompareAndSwap(max, current) {
			break
		}
	}
	if refresh {
		p.refresh.Add(1)
	}
	p.calls.Add(1)
	p.started <- struct{}{}
	<-p.release
	p.active.Add(-1)
	result, err := p.GetLyricsDetailedResult(ctx, mf)
	return result, !p.unsupported, err
}

func (p *refreshProvider) AbortPublication(context.Context, *model.MediaFile, model.LyricsPublication) error {
	p.aborts.Add(1)
	return nil
}

func (p *refreshProvider) GetOriginalWithPublication(context.Context, *model.MediaFile, model.LyricsVariantIdentity, model.LyricsPublication) (model.LyricsOriginal, bool, error) {
	return model.LyricsOriginal{}, false, nil
}

type refreshLoader struct{ provider *refreshProvider }

func (l refreshLoader) LoadLyricsProvider(string) (lyrics.Provider, bool) { return l.provider, true }

func TestDetailedRefreshWaitsForNormalAndNormalJoinsRefresh(t *testing.T) {
	conf.Update(func(c *conf.Options) { c.LyricsPriority = "plugin" })
	p := &refreshProvider{started: make(chan struct{}, 4), release: make(chan struct{}, 4)}
	svc := lyrics.NewLyrics(nil, refreshLoader{provider: p})
	mf := &model.MediaFile{ID: "track-1", Title: "Song", Artist: "Artist", Duration: 200}

	normalDone := make(chan error, 1)
	go func() {
		_, err := svc.GetLyricsVariantsResult(t.Context(), mf, false)
		normalDone <- err
	}()
	select {
	case err := <-normalDone:
		t.Fatalf("normal lookup finished before provider call: %v", err)
	case <-p.started:
	case <-time.After(2 * time.Second):
		t.Fatal("normal lookup never reached the provider")
	}

	refreshDone := make(chan error, 1)
	go func() {
		_, err := svc.RefreshLyricsVariantsResult(t.Context(), mf, false)
		refreshDone <- err
	}()
	time.Sleep(20 * time.Millisecond)
	if p.calls.Load() != 1 {
		t.Fatalf("refresh started overlapping normal call: calls=%d", p.calls.Load())
	}
	p.release <- struct{}{}
	if err := <-normalDone; err != nil {
		t.Fatal(err)
	}
	<-p.started
	if p.refresh.Load() != 1 {
		t.Fatal("refresh did not run after the normal call")
	}
	p.release <- struct{}{}
	if err := <-refreshDone; err != nil {
		t.Fatal(err)
	}

	// A normal caller during an active refresh joins the refresh instead of
	// starting a second provider call.
	refreshDone = make(chan error, 1)
	go func() {
		_, err := svc.RefreshLyricsVariantsResult(t.Context(), mf, false)
		refreshDone <- err
	}()
	<-p.started
	normalDone = make(chan error, 1)
	go func() {
		_, err := svc.GetLyricsVariantsResult(t.Context(), mf, false)
		normalDone <- err
	}()
	time.Sleep(20 * time.Millisecond)
	if p.calls.Load() != 3 {
		t.Fatalf("normal caller started overlapping refresh: calls=%d", p.calls.Load())
	}
	p.release <- struct{}{}
	if err := <-refreshDone; err != nil {
		t.Fatal(err)
	}
	if err := <-normalDone; err != nil {
		t.Fatal(err)
	}
	gomega.NewWithT(t).Expect(p.maxActive.Load()).To(gomega.Equal(int32(1)))
}

func TestUnsupportedRefreshReleasesAdmission(t *testing.T) {
	conf.Update(func(c *conf.Options) { c.LyricsPriority = "plugin" })
	p := &refreshProvider{
		started: make(chan struct{}, 1), release: make(chan struct{}, 1),
		unsupported: true,
	}
	svc := lyrics.NewLyrics(nil, refreshLoader{provider: p})
	mf := &model.MediaFile{ID: "track-1", Title: "Song", Artist: "Artist", Duration: 200}
	go func() {
		<-p.started
		p.release <- struct{}{}
	}()
	_, err := svc.RefreshLyricsVariantsResult(t.Context(), mf, false)
	if err != nil {
		t.Fatal(err)
	}
	if p.aborts.Load() != 1 {
		t.Fatalf("aborts = %d, want the unsupported refresh admission released", p.aborts.Load())
	}
}
