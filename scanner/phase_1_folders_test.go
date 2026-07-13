package scanner

import (
	"context"
	"errors"

	"github.com/navidrome/navidrome/model"
	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"
)

type stubLyricsProvider struct {
	lyrics      model.LyricList
	err         error
	libraryPath string
}

func (s *stubLyricsProvider) GetLyrics(_ context.Context, track *model.MediaFile) (model.LyricList, error) {
	s.libraryPath = track.LibraryPath
	return s.lyrics, s.err
}

var _ = Describe("phaseFolders lyrics persistence", func() {
	It("persists the source selected by the lyrics provider", func() {
		provider := &stubLyricsProvider{lyrics: model.LyricList{{
			Format: model.LyricFormatLRC,
			Lang:   "eng",
			Line:   []model.Line{{Value: "Resolved sidecar"}},
		}}}
		phase := &phaseFolders{ctx: context.Background(), lyricsProvider: provider}
		track := model.MediaFile{Lyrics: `[{"line":[{"value":"Embedded"}]}]`}

		err := phase.persistResolvedLyrics("/music", &track)

		Expect(err).ToNot(HaveOccurred())
		Expect(provider.libraryPath).To(Equal("/music"))
		Expect(track.Lyrics).To(MatchJSON(`[{"format":"lrc","lang":"eng","line":[{"value":"Resolved sidecar"}],"synced":false}]`))
	})

	It("keeps embedded lyrics when no configured source resolves", func() {
		provider := &stubLyricsProvider{}
		phase := &phaseFolders{ctx: context.Background(), lyricsProvider: provider}
		track := model.MediaFile{Lyrics: `[{"line":[{"value":"Embedded"}]}]`}

		err := phase.persistResolvedLyrics("/music", &track)

		Expect(err).ToNot(HaveOccurred())
		Expect(track.Lyrics).To(Equal(`[{"line":[{"value":"Embedded"}]}]`))
	})

	It("keeps embedded lyrics when source resolution fails", func() {
		provider := &stubLyricsProvider{err: errors.New("source unavailable")}
		phase := &phaseFolders{ctx: context.Background(), lyricsProvider: provider}
		track := model.MediaFile{Lyrics: `[{"line":[{"value":"Embedded"}]}]`}

		err := phase.persistResolvedLyrics("/music", &track)

		Expect(err).To(MatchError("source unavailable"))
		Expect(track.Lyrics).To(Equal(`[{"line":[{"value":"Embedded"}]}]`))
	})
})
