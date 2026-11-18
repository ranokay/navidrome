package lyrics_test

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sync"
	"sync/atomic"
	"testing"
	"testing/synctest"
	"time"

	"github.com/navidrome/navidrome/conf"
	"github.com/navidrome/navidrome/core/lyrics"
	"github.com/navidrome/navidrome/model"
	"github.com/navidrome/navidrome/tests"
	"github.com/navidrome/navidrome/utils"
	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"
)

var _ = Describe("Lyrics", func() {
	var mf model.MediaFile
	var ctx context.Context

	expectLyricsWithSource := func(actual, expected model.LyricList, source model.LyricsSource) {
		GinkgoHelper()
		withoutSource := make(model.LyricList, len(actual))
		copy(withoutSource, actual)
		for i := range withoutSource {
			Expect(withoutSource[i].Source).To(Equal(&source))
			withoutSource[i].Source = nil
		}
		Expect(withoutSource).To(Equal(expected))
	}

	embeddedLyrics := model.LyricList{
		model.Lyrics{
			Lang: "xxx",
			Line: []model.Line{
				{Value: "This is a set of lyrics"},
				{Value: "That is not good"},
			},
		},
	}

	syncedLyrics := model.LyricList{
		model.Lyrics{
			DisplayArtist: "Rick Astley",
			DisplayTitle:  "That one song",
			Lang:          "eng",
			Line: []model.Line{
				{
					Start: new(int64(18800)),
					Value: "We're no strangers to love",
				},
				{
					Start: new(int64(22801)),
					Value: "You know the rules and so do I",
				},
			},
			Offset: new(int64(-100)),
			Synced: true,
		},
	}

	elrcLyrics := model.LyricList{
		model.Lyrics{
			DisplayArtist: "ELRC Artist",
			DisplayTitle:  "ELRC Song",
			Lang:          "eng",
			Line: []model.Line{
				{
					Start: new(int64(1000)),
					End:   new(int64(3000)),
					Value: "Lead words",
					Cue: []model.Cue{
						{
							Start:     new(int64(1000)),
							End:       new(int64(1500)),
							Value:     "Lead ",
							ByteStart: 0,
							ByteEnd:   4,
						},
						{
							Start:     new(int64(1500)),
							End:       new(int64(3000)),
							Value:     "words",
							ByteStart: 5,
							ByteEnd:   9,
						},
					},
				},
				{
					Start: new(int64(3000)),
					Value: "Fallback line",
				},
			},
			Synced: true,
		},
	}

	ttmlLyrics := model.LyricList{
		model.Lyrics{
			Kind: "main",
			Lang: "eng",
			Line: []model.Line{
				{
					Start: new(int64(18800)),
					Value: "We're no strangers to love",
				},
				{
					Start: new(int64(22800)),
					Value: "You know the rules and so do I",
				},
			},
			Synced: true,
		},
		model.Lyrics{
			Kind: "main",
			Lang: "por",
			Line: []model.Line{
				{
					Start: new(int64(18800)),
					Value: "Nao somos estranhos ao amor",
				},
			},
			Synced: true,
		},
	}

	unsyncedLyrics := model.LyricList{
		model.Lyrics{
			Lang: "xxx",
			Line: []model.Line{
				{
					Value: "We're no strangers to love",
				},
				{
					Value: "You know the rules and so do I",
				},
			},
			Synced: false,
		},
	}

	srtLyrics := model.LyricList{
		model.Lyrics{
			Lang: "xxx",
			Line: []model.Line{
				{
					Start: new(int64(18800)),
					End:   new(int64(22800)),
					Value: "We're from subtitles",
				},
				{
					Start: new(int64(22801)),
					End:   new(int64(26000)),
					Value: "Another subtitle line",
				},
			},
			Synced: true,
		},
	}

	BeforeEach(func() {

		lyricsJson, _ := json.Marshal(embeddedLyrics)

		mf = model.MediaFile{
			Lyrics: string(lyricsJson),
			Path:   "tests/fixtures/test.mp3",
		}
		ctx = GinkgoT().Context()
	})

	DescribeTable("Lyrics Priority", func(priority string, expected model.LyricList, source model.LyricsSource) {
		conf.Update(func(c *conf.Options) { c.LyricsPriority = priority })
		svc := lyrics.NewLyrics(nil, nil)
		list, err := svc.GetLyrics(ctx, &mf)
		Expect(err).ToNot(HaveOccurred())
		expectLyricsWithSource(list, expected, source)
	},
		Entry("embedded > lrc > txt", "embedded,.lrc,.txt", embeddedLyrics, model.LyricsSource{Type: model.LyricsSourceEmbedded}),
		Entry("lrc > embedded > txt", ".lrc,embedded,.txt", syncedLyrics, model.LyricsSource{Type: model.LyricsSourceSidecar, Format: "lrc"}),
		Entry("elrc > lrc > embedded", ".elrc,.lrc,embedded", elrcLyrics, model.LyricsSource{Type: model.LyricsSourceSidecar, Format: "elrc"}),
		Entry("srt > txt > embedded", ".srt,.txt,embedded", srtLyrics, model.LyricsSource{Type: model.LyricsSourceSidecar, Format: "srt"}),
		Entry("txt > lrc > embedded", ".txt,.lrc,embedded", unsyncedLyrics, model.LyricsSource{Type: model.LyricsSourceSidecar, Format: "txt"}),
		Entry("ttml > elrc > lrc > srt > embedded", ".ttml,.elrc,.lrc,.srt,embedded", ttmlLyrics, model.LyricsSource{Type: model.LyricsSourceSidecar, Format: "ttml"}))

	It("resolves source priority across duplicate media files", func() {
		conf.Update(func(c *conf.Options) { c.LyricsPriority = ".ttml,embedded" })
		embeddedJSON, err := json.Marshal(embeddedLyrics)
		Expect(err).ToNot(HaveOccurred())

		repo := &tests.MockMediaFileRepo{}
		repo.SetData(model.MediaFiles{
			{
				Lyrics: string(embeddedJSON),
				Path:   "tests/fixtures/01 Invisible (RED) Edit Version.mp3",
			},
			{
				Lyrics: "[]",
				Path:   "tests/fixtures/test.mp3",
			},
		})
		svc := lyrics.NewLyrics(&tests.MockDataStore{MockedMediaFile: repo}, nil)

		list, err := svc.GetLyricsByArtistTitle(ctx, "Rick Astley", "Never Gonna Give You Up")
		Expect(err).ToNot(HaveOccurred())
		expectLyricsWithSource(list, ttmlLyrics, model.LyricsSource{
			Type:   model.LyricsSourceSidecar,
			Format: "ttml",
		})
	})

	It("preserves configured sidecar suffix casing on case-sensitive filesystems", func() {
		dir, err := os.MkdirTemp("", "lyrics-case-*")
		Expect(err).ToNot(HaveOccurred())
		DeferCleanup(func() {
			Expect(os.RemoveAll(dir)).To(Succeed())
		})

		probe := filepath.Join(dir, "CASECHECK")
		Expect(os.WriteFile(probe, []byte("probe"), 0600)).To(Succeed())
		_, err = os.Stat(filepath.Join(dir, "casecheck"))
		if err == nil {
			Skip("filesystem is case-insensitive")
		}
		Expect(os.IsNotExist(err)).To(BeTrue())

		conf.Update(func(c *conf.Options) { c.LyricsPriority = ".LRC" })
		Expect(os.WriteFile(filepath.Join(dir, "song.LRC"), []byte("[00:01.00]Upper suffix"), 0600)).To(Succeed())

		svc := lyrics.NewLyrics(nil, nil)
		list, err := svc.GetLyrics(ctx, &model.MediaFile{
			LibraryPath: dir,
			Path:        "song.mp3",
		})

		Expect(err).ToNot(HaveOccurred())
		Expect(list).To(HaveLen(1))
		Expect(list[0].Line).To(Equal([]model.Line{
			{Start: new(int64(1000)), Value: "Upper suffix"},
		}))
	})

	It("returns a non-Lyricsfile YAML sidecar as plain text, shadowing lower-priority sources", func() {
		dir, err := os.MkdirTemp("", "lyrics-yaml-fallback-*")
		Expect(err).ToNot(HaveOccurred())
		DeferCleanup(func() {
			Expect(os.RemoveAll(dir)).To(Succeed())
		})

		Expect(os.WriteFile(filepath.Join(dir, "song.yaml"), []byte("title: not lyricsfile\n"), 0600)).To(Succeed())
		Expect(os.WriteFile(filepath.Join(dir, "song.lrc"), []byte("[00:01.00]Fallback line"), 0600)).To(Succeed())

		conf.Update(func(c *conf.Options) { c.LyricsPriority = ".yaml,.lrc" })
		svc := lyrics.NewLyrics(nil, nil)
		list, err := svc.GetLyrics(ctx, &model.MediaFile{
			LibraryPath: dir,
			Path:        "song.mp3",
		})

		// ParseLyrics falls back to plain text for any suffix when the content
		// doesn't match the structured format, so the .yaml hit is non-empty and
		// shadows the lower-priority .lrc entirely.
		Expect(err).ToNot(HaveOccurred())
		Expect(list).To(HaveLen(1))
		Expect(list[0].Synced).To(BeFalse())
		Expect(list[0].Line).To(Equal([]model.Line{
			{Value: "title: not lyricsfile"},
		}))
	})

	Context("Errors", func() {
		var RegularUserContext = XContext
		var isRegularUser = os.Getuid() != 0
		if isRegularUser {
			RegularUserContext = Context
		}

		RegularUserContext("run without root permissions", func() {
			var accessForbiddenFile string

			BeforeEach(func() {
				tests.SkipOnWindows("uses Unix file permission bits")
				accessForbiddenFile = utils.TempFileName("access_forbidden-", ".mp3")

				f, err := os.OpenFile(accessForbiddenFile, os.O_WRONLY|os.O_CREATE, 0222)
				Expect(err).ToNot(HaveOccurred())

				mf.Path = accessForbiddenFile

				DeferCleanup(func() {
					Expect(f.Close()).To(Succeed())
					Expect(os.Remove(accessForbiddenFile)).To(Succeed())
				})
			})

			It("should fallback to embedded if an error happens when parsing file", func() {
				conf.Update(func(c *conf.Options) { c.LyricsPriority = ".mp3,embedded" })

				svc := lyrics.NewLyrics(nil, nil)
				list, err := svc.GetLyrics(ctx, &mf)
				Expect(err).ToNot(HaveOccurred())
				expectLyricsWithSource(list, embeddedLyrics, model.LyricsSource{
					Type: model.LyricsSourceEmbedded,
				})
			})

			It("should return nothing if error happens when trying to parse file", func() {
				conf.Update(func(c *conf.Options) { c.LyricsPriority = ".mp3" })

				svc := lyrics.NewLyrics(nil, nil)
				list, err := svc.GetLyrics(ctx, &mf)
				Expect(err).ToNot(HaveOccurred())
				Expect(list).To(BeEmpty())
			})
		})
	})

	Context("plugin sources", func() {
		var mockLoader *mockPluginLoader

		BeforeEach(func() {
			mockLoader = &mockPluginLoader{}
		})

		It("should return lyrics from a plugin", func() {
			conf.Update(func(c *conf.Options) { c.LyricsPriority = "test-lyrics-plugin" })
			mockLoader.lyrics = unsyncedLyrics
			svc := lyrics.NewLyrics(nil, mockLoader)
			list, err := svc.GetLyrics(ctx, &mf)
			Expect(err).ToNot(HaveOccurred())
			expectLyricsWithSource(list, unsyncedLyrics, model.LyricsSource{
				Type: model.LyricsSourcePlugin,
				Name: "test-lyrics-plugin",
			})
		})

		It("should try plugin after embedded returns nothing", func() {
			conf.Update(func(c *conf.Options) { c.LyricsPriority = "embedded,test-lyrics-plugin" })
			mf.Lyrics = "" // No embedded lyrics
			mockLoader.lyrics = unsyncedLyrics
			svc := lyrics.NewLyrics(nil, mockLoader)
			list, err := svc.GetLyrics(ctx, &mf)
			Expect(err).ToNot(HaveOccurred())
			expectLyricsWithSource(list, unsyncedLyrics, model.LyricsSource{
				Type: model.LyricsSourcePlugin,
				Name: "test-lyrics-plugin",
			})
		})

		It("should skip plugin if embedded has lyrics", func() {
			conf.Update(func(c *conf.Options) { c.LyricsPriority = "embedded,test-lyrics-plugin" })
			mockLoader.lyrics = unsyncedLyrics
			svc := lyrics.NewLyrics(nil, mockLoader)
			list, err := svc.GetLyrics(ctx, &mf)
			Expect(err).ToNot(HaveOccurred())
			expectLyricsWithSource(list, embeddedLyrics, model.LyricsSource{
				Type: model.LyricsSourceEmbedded,
			})
		})

		It("returns every source-tagged variant in order", func() {
			conf.Update(func(c *conf.Options) { c.LyricsPriority = "test-lyrics-plugin" })
			mockLoader.lyrics = model.LyricList{
				{
					Lang:   "eng",
					Synced: true,
					Line:   []model.Line{{Value: "first"}},
					Source: &model.LyricsSource{
						Type: model.LyricsSourcePlugin, Name: "test-lyrics-plugin",
						Provider: "NetEase", Format: "elrc",
					},
				},
				{
					Lang:   "eng",
					Synced: true,
					Line:   []model.Line{{Value: "second"}},
					Source: &model.LyricsSource{
						Type: model.LyricsSourcePlugin, Name: "test-lyrics-plugin",
						Provider: "LRCLib", Format: "lrc",
					},
				},
			}
			svc := lyrics.NewLyrics(nil, mockLoader)
			list, err := svc.GetLyrics(ctx, &mf)
			Expect(err).ToNot(HaveOccurred())
			Expect(list).To(HaveLen(2))
			Expect(*list[0].Source).To(Equal(model.LyricsSource{
				Type: model.LyricsSourcePlugin, Name: "test-lyrics-plugin",
				Provider: "NetEase", Format: "elrc",
			}))
			Expect(*list[1].Source).To(Equal(model.LyricsSource{
				Type: model.LyricsSourcePlugin, Name: "test-lyrics-plugin",
				Provider: "LRCLib", Format: "lrc",
			}))
			// Legacy single-lyric consumers keep serving the first variant.
			main, ok := list.Main()
			Expect(ok).To(BeTrue())
			Expect(main.Line[0].Value).To(Equal("first"))
		})

		It("should skip unknown plugin names gracefully", func() {
			conf.Update(func(c *conf.Options) { c.LyricsPriority = "nonexistent-plugin,embedded" })
			mockLoader.notFound = true
			svc := lyrics.NewLyrics(nil, mockLoader)
			list, err := svc.GetLyrics(ctx, &mf)
			Expect(err).ToNot(HaveOccurred())
			expectLyricsWithSource(list, embeddedLyrics, model.LyricsSource{
				Type: model.LyricsSourceEmbedded,
			})
		})

		It("should preserve plugin name case from config", func() {
			conf.Update(func(c *conf.Options) { c.LyricsPriority = "MyLyricsPlugin" })
			mockLoader.pluginName = "MyLyricsPlugin"
			mockLoader.lyrics = unsyncedLyrics
			svc := lyrics.NewLyrics(nil, mockLoader)
			list, err := svc.GetLyrics(ctx, &mf)
			Expect(err).ToNot(HaveOccurred())
			expectLyricsWithSource(list, unsyncedLyrics, model.LyricsSource{
				Type: model.LyricsSourcePlugin,
				Name: "MyLyricsPlugin",
			})
		})

		It("should handle plugin error gracefully", func() {
			conf.Update(func(c *conf.Options) { c.LyricsPriority = "test-lyrics-plugin,embedded" })
			mockLoader.err = errors.New("plugin error")
			svc := lyrics.NewLyrics(nil, mockLoader)
			list, err := svc.GetLyrics(ctx, &mf)
			Expect(err).ToNot(HaveOccurred())
			expectLyricsWithSource(list, embeddedLyrics, model.LyricsSource{
				Type: model.LyricsSourceEmbedded,
			})
		})

		It("should return a plugin error when no later source has lyrics", func() {
			conf.Update(func(c *conf.Options) { c.LyricsPriority = "test-lyrics-plugin,embedded" })
			mf.Lyrics = ""
			mockLoader.err = errors.New("remote lyrics cooldown active for 30s")
			svc := lyrics.NewLyrics(nil, mockLoader)

			list, err := svc.GetLyrics(ctx, &mf)

			Expect(list).To(BeEmpty())
			Expect(err).To(MatchError("remote lyrics cooldown active for 30s"))
		})
	})

	It("does not classify malformed mixed-case embedded lyrics as a plugin failure", func() {
		conf.Update(func(c *conf.Options) { c.LyricsPriority = "Embedded" })
		mf.Lyrics = "{malformed json"
		svc := lyrics.NewLyrics(nil, nil)
		list, err := svc.GetLyrics(ctx, &mf)
		Expect(err).NotTo(HaveOccurred())
		Expect(list).To(BeEmpty())
	})

	Context("caching", func() {
		var mockLoader *mockPluginLoader
		var svc lyrics.Lyrics

		BeforeEach(func() {
			conf.Update(func(c *conf.Options) { c.LyricsPriority = "test-lyrics-plugin" })
			mockLoader = &mockPluginLoader{}
			svc = lyrics.NewLyrics(nil, mockLoader)
			mf.ID = "mf-1"
		})

		It("serves a repeated request for the same track from the cache", func() {
			mockLoader.lyrics = unsyncedLyrics
			_, err := svc.GetLyrics(ctx, &mf)
			Expect(err).ToNot(HaveOccurred())

			list, err := svc.GetLyrics(ctx, &mf)
			Expect(err).ToNot(HaveOccurred())
			expectLyricsWithSource(list, unsyncedLyrics, model.LyricsSource{
				Type: model.LyricsSourcePlugin, Name: "test-lyrics-plugin",
			})
			Expect(mockLoader.calls).To(Equal(1))
		})

		It("caches a miss, so a track without lyrics does not reach the plugin again", func() {
			for range 2 {
				list, err := svc.GetLyrics(ctx, &mf)
				Expect(err).ToNot(HaveOccurred())
				Expect(list).To(BeEmpty())
			}
			Expect(mockLoader.calls).To(Equal(1))
		})

		It("does not retain a plugin error and retries it on the next request", func() {
			mockLoader.err = errors.New("no lyrics found from any provider")
			for range 2 {
				list, err := svc.GetLyrics(ctx, &mf)
				Expect(err).To(MatchError("no lyrics found from any provider"))
				Expect(list).To(BeEmpty())
			}
			Expect(mockLoader.calls).To(Equal(2))
		})

		It("looks up each track separately", func() {
			other := mf
			other.ID = "mf-2"
			_, _ = svc.GetLyrics(ctx, &mf)
			_, _ = svc.GetLyrics(ctx, &other)
			Expect(mockLoader.calls).To(Equal(2))
		})

		It("finishes and caches the lookup when the caller's request is cancelled", func() {
			mockLoader.lyrics = unsyncedLyrics
			cancelled, cancel := context.WithCancel(ctx)
			cancel()

			list, err := svc.GetLyrics(cancelled, &mf)
			Expect(err).ToNot(HaveOccurred())
			expectLyricsWithSource(list, unsyncedLyrics, model.LyricsSource{
				Type: model.LyricsSourcePlugin, Name: "test-lyrics-plugin",
			})

			list, err = svc.GetLyrics(ctx, &mf)
			Expect(err).ToNot(HaveOccurred())
			expectLyricsWithSource(list, unsyncedLyrics, model.LyricsSource{
				Type: model.LyricsSourcePlugin, Name: "test-lyrics-plugin",
			})
			Expect(mockLoader.calls).To(Equal(1))
		})

		It("bounds the lookup with a deadline", func() {
			_, err := svc.GetLyrics(ctx, &mf)
			Expect(err).ToNot(HaveOccurred())
			Expect(mockLoader.hadDeadline).To(BeTrue())
		})

		It("does not retain a detailed result, so a delayed provider upgrade is visible", func() {
			first, err := svc.GetLyricsVariantsResult(ctx, &mf, false)
			Expect(err).ToNot(HaveOccurred())
			Expect(first.Lyrics).To(BeEmpty())

			mockLoader.detailed = model.LyricsResult{Lyrics: unsyncedLyrics}
			second, err := svc.GetLyricsVariantsResult(ctx, &mf, false)
			Expect(err).ToNot(HaveOccurred())
			Expect(second.Lyrics).To(HaveLen(1))
			Expect(mockLoader.calls).To(Equal(2))
		})

		It("does not retain an existing detailed set when the provider adds another entry", func() {
			mockLoader.detailed = model.LyricsResult{Lyrics: unsyncedLyrics[:1]}
			first, err := svc.GetLyricsVariantsResult(ctx, &mf, false)
			Expect(err).ToNot(HaveOccurred())
			Expect(first.Lyrics).To(HaveLen(1))

			expanded := append(model.LyricList{}, unsyncedLyrics...)
			expanded = append(expanded, model.Lyrics{
				Lang: "eng", Line: []model.Line{{Value: "late provider variant"}},
			})
			mockLoader.detailed = model.LyricsResult{Lyrics: expanded}
			second, err := svc.GetLyricsVariantsResult(ctx, &mf, false)
			Expect(err).ToNot(HaveOccurred())
			Expect(second.Lyrics).To(HaveLen(2))
			Expect(mockLoader.calls).To(Equal(2))
		})

		It("keeps legacy and detailed result shapes disjoint", func() {
			mockLoader.lyrics = unsyncedLyrics
			legacy, err := svc.GetLyrics(ctx, &mf)
			Expect(err).ToNot(HaveOccurred())
			Expect(legacy).To(HaveLen(1))

			mockLoader.detailed = model.LyricsResult{
				Lyrics:   unsyncedLyrics,
				Evidence: []model.LyricsEvidence{{Kind: "match", Provider: "LRCLib"}},
			}
			detailed, err := svc.GetLyricsVariantsResult(ctx, &mf, false)
			Expect(err).ToNot(HaveOccurred())
			Expect(detailed.Lyrics).To(HaveLen(1))
			Expect(detailed.Evidence).To(HaveLen(1))
			Expect(mockLoader.calls).To(Equal(2))

			// The legacy cache hit must not be populated or consumed by the
			// detailed path.
			_, err = svc.GetLyrics(ctx, &mf)
			Expect(err).ToNot(HaveOccurred())
			Expect(mockLoader.calls).To(Equal(2))
		})

		It("stamps source on every read without mutating the cached result", func() {
			mockLoader.lyrics = unsyncedLyrics
			first, err := svc.GetLyrics(ctx, &mf)
			Expect(err).ToNot(HaveOccurred())
			first[0].Source.Name = "mutated"

			second, err := svc.GetLyrics(ctx, &mf)
			Expect(err).ToNot(HaveOccurred())
			Expect(second[0].Source.Name).To(Equal("test-lyrics-plugin"))
			Expect(mockLoader.calls).To(Equal(1))
		})

		It("preserves detailed evidence, variant identity, and source without retaining it", func() {
			identity := model.LyricsVariantIdentity{
				Version: 1, Instance: "plugin:track", Recording: "recording",
				Language: "eng", Role: model.LyricKindMain, Format: "lrc",
			}
			match := &model.LyricsMatch{Status: model.LyricsMatchValidated}
			mockLoader.detailed = model.LyricsResult{
				Lyrics: model.LyricList{{
					Lang: "eng", Variant: &identity, Match: match, Selection: "selection",
					Line: []model.Line{{Value: "detailed"}},
				}},
				Evidence: []model.LyricsEvidence{{
					PluginID: "test-lyrics-plugin", Kind: "match", Provider: "LRCLib", Match: match,
				}},
			}
			for range 2 {
				result, err := svc.GetLyricsVariantsResult(ctx, &mf, false)
				Expect(err).ToNot(HaveOccurred())
				Expect(result.Lyrics).To(HaveLen(1))
				Expect(result.Lyrics[0].Variant).To(Equal(&identity))
				Expect(result.Lyrics[0].Match).To(Equal(match))
				Expect(result.Lyrics[0].Source).To(Equal(&model.LyricsSource{
					Type: model.LyricsSourcePlugin, Name: "test-lyrics-plugin",
				}))
				Expect(result.Evidence).To(HaveLen(1))
				Expect(result.Evidence[0].Kind).To(Equal("match"))
			}
			Expect(mockLoader.calls).To(Equal(2))
		})

		It("does not retain or rewrite a detailed provider cooldown error", func() {
			mockLoader.err = errors.New("remote lyrics cooldown active for 30s")
			for range 2 {
				_, err := svc.GetLyricsVariantsResult(ctx, &mf, false)
				Expect(err).To(MatchError("remote lyrics cooldown active for 30s"))
			}
			Expect(mockLoader.calls).To(Equal(2))
		})
	})

	var _ = Describe("GetLyricsByArtistTitle", func() {
		var svc lyrics.Lyrics
		var repo *tests.MockMediaFileRepo
		var ds *tests.MockDataStore

		BeforeEach(func() {
			conf.Update(func(c *conf.Options) { c.LyricsPriority = "embedded" })
			repo = &tests.MockMediaFileRepo{}
			ds = &tests.MockDataStore{MockedMediaFile: repo}
			svc = lyrics.NewLyrics(ds, nil)
		})

		It("bounds the query to a duplicate window", func() {
			repo.SetData(model.MediaFiles{})
			_, err := svc.GetLyricsByArtistTitle(ctx, "Rick Astley", "Never Gonna Give You Up")
			Expect(err).ToNot(HaveOccurred())
			Expect(repo.Options.Max).To(Equal(10))
		})

		It("returns nil when no media file matches", func() {
			repo.SetData(model.MediaFiles{})
			list, err := svc.GetLyricsByArtistTitle(ctx, "Nobody", "No Song")
			Expect(err).ToNot(HaveOccurred())
			Expect(list).To(BeNil())
		})

		It("resolves lyrics from the matched media files", func() {
			embeddedList, err := model.ParseLyrics(ctx, ".lrc", "eng", []byte("Embedded lyrics line"))
			Expect(err).ToNot(HaveOccurred())
			embedded, _ := embeddedList.Main()
			embeddedJSON, err := json.Marshal(model.LyricList{embedded})
			Expect(err).ToNot(HaveOccurred())
			repo.SetData(model.MediaFiles{
				{ID: "1", Title: "Never Gonna Give You Up", Lyrics: string(embeddedJSON)},
			})

			list, err := svc.GetLyricsByArtistTitle(ctx, "Rick Astley", "Never Gonna Give You Up")
			Expect(err).ToNot(HaveOccurred())
			Expect(list).To(HaveLen(1))
			Expect(list[0].Line[0].Value).To(Equal("Embedded lyrics line"))
		})
	})
})

type mockPluginLoader struct {
	lyrics      model.LyricList
	detailed    model.LyricsResult
	err         error
	notFound    bool
	pluginName  string // expected plugin name (exact match, like real manager)
	calls       int
	hadDeadline bool
}

func (m *mockPluginLoader) PluginNames(_ string) []string {
	if m.notFound {
		return nil
	}
	return []string{"test-lyrics-plugin"}
}

func (m *mockPluginLoader) LoadLyricsProvider(name string) (lyrics.Provider, bool) {
	if m.notFound {
		return nil, false
	}
	// If pluginName is set, require exact match (like the real plugin manager)
	if m.pluginName != "" && name != m.pluginName {
		return nil, false
	}
	return &mockLyricsProvider{loader: m}, true
}

type mockLyricsProvider struct {
	loader *mockPluginLoader
}

func (m *mockLyricsProvider) GetLyrics(ctx context.Context, _ *model.MediaFile) (model.LyricList, error) {
	m.loader.calls++
	_, m.loader.hadDeadline = ctx.Deadline()
	if err := ctx.Err(); err != nil {
		return nil, err
	}
	return m.loader.lyrics, m.loader.err
}

func (m *mockLyricsProvider) GetLyricsDetailedResult(ctx context.Context, _ *model.MediaFile) (model.LyricsResult, error) {
	m.loader.calls++
	_, m.loader.hadDeadline = ctx.Deadline()
	if err := ctx.Err(); err != nil {
		return model.LyricsResult{}, err
	}
	if m.loader.detailed.Lyrics == nil && len(m.loader.detailed.Evidence) == 0 {
		return model.LyricsResult{Lyrics: m.loader.lyrics}, m.loader.err
	}
	return m.loader.detailed, m.loader.err
}

type variantPluginLoader map[string]lyrics.Provider

func (m variantPluginLoader) LoadLyricsProvider(name string) (lyrics.Provider, bool) {
	provider, ok := m[name]
	return provider, ok
}

type variantProvider func(context.Context, *model.MediaFile) (model.LyricList, error)

func (f variantProvider) GetLyrics(ctx context.Context, mf *model.MediaFile) (model.LyricList, error) {
	return f(ctx, mf)
}

func TestLyricsProviderErrors(t *testing.T) {
	for _, tt := range []struct {
		name       string
		enhanced   bool
		allSources bool
	}{
		{name: "legacy lookup"},
		{name: "initial variant lookup", enhanced: true},
		{name: "all-source discovery", enhanced: true, allSources: true},
	} {
		t.Run(tt.name, func(t *testing.T) {
			g := NewWithT(t)
			conf.Update(func(c *conf.Options) { c.LyricsPriority = "LongCooldown,ShortCooldown,embedded" })
			longErr := errors.New("first provider cooldown active for 120s")
			shortErr := errors.New("second provider retry after 5s")
			loader := variantPluginLoader{
				"LongCooldown": variantProvider(func(context.Context, *model.MediaFile) (model.LyricList, error) {
					return nil, longErr
				}),
				"ShortCooldown": variantProvider(func(context.Context, *model.MediaFile) (model.LyricList, error) {
					return nil, shortErr
				}),
			}
			svc := lyrics.NewLyrics(nil, loader)
			lookup := func(mf *model.MediaFile) (model.LyricList, error) {
				if tt.enhanced {
					return svc.GetLyricsVariants(t.Context(), mf, tt.allSources)
				}
				return svc.GetLyrics(t.Context(), mf)
			}
			list, err := lookup(&model.MediaFile{})
			g.Expect(list).To(BeEmpty())
			g.Expect(err).To(MatchError(longErr.Error() + "\n" + shortErr.Error()))
			g.Expect(errors.Is(err, longErr)).To(BeTrue())
			g.Expect(errors.Is(err, shortErr)).To(BeTrue())

			list, err = lookup(&model.MediaFile{Lyrics: `[{"lang":"eng","line":[{"value":"Local words"}]}]`})
			g.Expect(list).To(HaveLen(1))
			g.Expect(list[0].Source.Type).To(Equal(model.LyricsSourceEmbedded))
			if tt.enhanced {
				g.Expect(err).To(MatchError(longErr.Error() + "\n" + shortErr.Error()))
			} else {
				g.Expect(err).NotTo(HaveOccurred())
			}
		})
	}
}

func TestLyricsVariants(t *testing.T) {
	mf := &model.MediaFile{Lyrics: `[{"lang":"eng","line":[{"value":"Local words"}]}]`}
	remote := model.LyricList{{Lang: "eng", Line: []model.Line{{Value: "Remote words"}}}}

	t.Run("initial plugin winner includes local lyrics and skips later plugins", func(t *testing.T) {
		g := NewWithT(t)
		conf.Update(func(c *conf.Options) { c.LyricsPriority = "OtherPlugin,embedded,UnusedPlugin" })
		loader := variantPluginLoader{
			"OtherPlugin": variantProvider(func(context.Context, *model.MediaFile) (model.LyricList, error) {
				return remote, nil
			}),
			"UnusedPlugin": variantProvider(func(context.Context, *model.MediaFile) (model.LyricList, error) {
				t.Fatal("initial lookup must short-circuit remote sources")
				return nil, nil
			}),
		}
		list, err := lyrics.NewLyrics(nil, loader).GetLyricsVariants(t.Context(), mf, false)
		g.Expect(err).NotTo(HaveOccurred())
		g.Expect(list).To(HaveLen(2))
		g.Expect(list[0].Source.Name).To(Equal("OtherPlugin"))
		g.Expect(list[1].Source.Type).To(Equal(model.LyricsSourceEmbedded))
	})

	t.Run("concurrent detailed lookups share one call but do not retain it", func(t *testing.T) {
		g := NewWithT(t)
		conf.Update(func(c *conf.Options) { c.LyricsPriority = "Shared" })
		var calls atomic.Int32
		loader := variantPluginLoader{"Shared": variantProvider(func(context.Context, *model.MediaFile) (model.LyricList, error) {
			calls.Add(1)
			time.Sleep(25 * time.Millisecond)
			return remote, nil
		})}
		svc := lyrics.NewLyrics(nil, loader)
		start := make(chan struct{})
		var wg sync.WaitGroup
		for range 2 {
			wg.Go(func() {
				<-start
				list, err := svc.GetLyricsVariants(t.Context(), &model.MediaFile{}, false)
				g.Expect(err).NotTo(HaveOccurred())
				g.Expect(list).To(HaveLen(1))
			})
		}
		close(start)
		wg.Wait()
		g.Expect(calls.Load()).To(Equal(int32(1)))

		_, err := svc.GetLyricsVariants(t.Context(), &model.MediaFile{}, false)
		g.Expect(err).NotTo(HaveOccurred())
		g.Expect(calls.Load()).To(Equal(int32(2)))
	})

	t.Run("concurrent discovery preserves priority and isolates failures", func(t *testing.T) {
		synctest.Test(t, func(t *testing.T) {
			g := NewWithT(t)
			conf.Update(func(c *conf.Options) { c.LyricsPriority = "First,Failing,embedded,Second,First,Missing" })
			started := make(chan struct{}, 2)
			release := make(chan struct{})
			go func() {
				<-started
				<-started
				close(release)
			}()
			provider := func(context.Context, *model.MediaFile) (model.LyricList, error) {
				started <- struct{}{}
				// Both sources must start before either can finish.
				<-release
				return remote, nil
			}
			loader := variantPluginLoader{
				"First": variantProvider(provider), "Second": variantProvider(provider),
				"Failing": variantProvider(func(context.Context, *model.MediaFile) (model.LyricList, error) {
					return nil, errors.New("provider unavailable")
				}),
			}
			list, err := lyrics.NewLyrics(nil, loader).GetLyricsVariants(t.Context(), mf, true)
			g.Expect(err).To(MatchError("provider unavailable"))
			g.Expect(list).To(HaveLen(3))
			g.Expect(list[0].Source.Name).To(Equal("First"))
			g.Expect(list[1].Source.Type).To(Equal(model.LyricsSourceEmbedded))
			g.Expect(list[2].Source.Name).To(Equal("Second"))
		})
	})

	t.Run("ordinary slow plugins can finish without a background cache", func(t *testing.T) {
		synctest.Test(t, func(t *testing.T) {
			g := NewWithT(t)
			conf.Update(func(c *conf.Options) { c.LyricsPriority = "embedded,SlowPlugin" })
			loader := variantPluginLoader{"SlowPlugin": variantProvider(func(ctx context.Context, _ *model.MediaFile) (model.LyricList, error) {
				select {
				case <-time.After(3 * time.Second):
					return remote, nil
				case <-ctx.Done():
					return nil, ctx.Err()
				}
			})}
			svc := lyrics.NewLyrics(nil, loader)
			start := time.Now()
			initial, err := svc.GetLyricsVariants(t.Context(), mf, false)
			g.Expect(err).NotTo(HaveOccurred())
			g.Expect(initial).To(HaveLen(1))
			g.Expect(time.Since(start)).To(BeZero())
			all, err := svc.GetLyricsVariants(t.Context(), mf, true)
			g.Expect(err).NotTo(HaveOccurred())
			g.Expect(all).To(HaveLen(2))
			g.Expect(all[1].Source.Name).To(Equal("SlowPlugin"))
			g.Expect(time.Since(start)).To(Equal(3 * time.Second))
		})
	})

	t.Run("a stuck plugin cannot hide local lyrics or cache a false miss", func(t *testing.T) {
		synctest.Test(t, func(t *testing.T) {
			g := NewWithT(t)
			conf.Update(func(c *conf.Options) { c.LyricsPriority = "embedded,StuckPlugin" })
			release := make(chan struct{})
			loader := variantPluginLoader{"StuckPlugin": variantProvider(func(context.Context, *model.MediaFile) (model.LyricList, error) {
				<-release // Deliberately ignore cancellation, as a faulty provider might.
				return remote, nil
			})}
			svc := lyrics.NewLyrics(nil, loader)
			list, err := svc.GetLyricsVariants(t.Context(), mf, true)
			g.Expect(err).To(MatchError(context.DeadlineExceeded))
			g.Expect(list).To(HaveLen(1))
			_, err = svc.GetLyricsVariants(t.Context(), &model.MediaFile{}, true)
			g.Expect(err).To(MatchError(context.DeadlineExceeded))
			close(release)
		})
	})

	t.Run("caller cancellation is propagated", func(t *testing.T) {
		g := NewWithT(t)
		ctx, cancel := context.WithCancel(t.Context())
		cancel()
		_, err := lyrics.NewLyrics(nil, nil).GetLyricsVariants(ctx, mf, true)
		g.Expect(err).To(MatchError(context.Canceled))
	})
}
