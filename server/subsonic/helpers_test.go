package subsonic

import (
	"context"
	"net/http/httptest"
	"time"

	"github.com/go-chi/jwtauth/v5"
	"github.com/navidrome/navidrome/conf"
	"github.com/navidrome/navidrome/conf/configtest"
	"github.com/navidrome/navidrome/core/auth"
	"github.com/navidrome/navidrome/model"
	"github.com/navidrome/navidrome/model/request"
	"github.com/navidrome/navidrome/server/subsonic/responses"
	"github.com/navidrome/navidrome/utils/req"
	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"
)

var _ = Describe("helpers", func() {
	BeforeEach(func() {
		DeferCleanup(configtest.SetupConfig())
		auth.TokenAuth = jwtauth.New("HS256", []byte("test secret"), nil)
	})

	Describe("fakePath", func() {
		var mf model.MediaFile
		BeforeEach(func() {
			mf.AlbumArtist = "Brock Berrigan"
			mf.Album = "Point Pleasant"
			mf.Title = "Split Decision"
			mf.Suffix = "flac"
		})
		When("TrackNumber is not available", func() {
			It("does not add any number to the filename", func() {
				Expect(fakePath(mf)).To(Equal("Brock Berrigan/Point Pleasant/Split Decision.flac"))
			})
		})
		When("TrackNumber is available", func() {
			It("adds the trackNumber to the path", func() {
				mf.TrackNumber = 4
				Expect(fakePath(mf)).To(Equal("Brock Berrigan/Point Pleasant/04 - Split Decision.flac"))
			})
		})
		When("TrackNumber and DiscNumber are available", func() {
			It("adds the trackNumber to the path", func() {
				mf.TrackNumber = 4
				mf.DiscNumber = 1
				Expect(fakePath(mf)).To(Equal("Brock Berrigan/Point Pleasant/01-04 - Split Decision.flac"))
			})
		})
	})

	Describe("sanitizeSlashes", func() {
		It("maps / to _", func() {
			Expect(sanitizeSlashes("AC/DC")).To(Equal("AC_DC"))
		})
	})

	Describe("sortName", func() {
		BeforeEach(func() {
			DeferCleanup(configtest.SetupConfig())
		})
		When("PreferSortTags is false", func() {
			BeforeEach(func() {
				conf.Server.PreferSortTags = false
			})
			It("returns the order name even if sort name is provided", func() {
				Expect(sortName("Sort Album Name", "Order Album Name")).To(Equal("Order Album Name"))
			})
			It("returns the order name if sort name is empty", func() {
				Expect(sortName("", "Order Album Name")).To(Equal("Order Album Name"))
			})
		})
		When("PreferSortTags is true", func() {
			BeforeEach(func() {
				conf.Server.PreferSortTags = true
			})
			It("returns the sort name if provided", func() {
				Expect(sortName("Sort Album Name", "Order Album Name")).To(Equal("Sort Album Name"))
			})

			It("returns the order name if sort name is empty", func() {
				Expect(sortName("", "Order Album Name")).To(Equal("Order Album Name"))
			})
		})
		It("returns an empty string if both sort name and order name are empty", func() {
			Expect(sortName("", "")).To(Equal(""))
		})
	})

	Describe("buildDiscTitles", func() {
		It("should return nil when album has no discs", func() {
			album := model.Album{}
			Expect(buildDiscSubtitles(album)).To(BeNil())
		})

		It("should return nil when album has only one disc without title", func() {
			album := model.Album{
				Discs: map[int]string{
					1: "",
				},
			}
			Expect(buildDiscSubtitles(album)).To(BeNil())
		})

		It("should return the disc title with cover art for a single disc", func() {
			updatedAt := time.Now().Truncate(time.Second)
			album := model.Album{
				ID:        "album1",
				UpdatedAt: updatedAt,
				Discs: map[int]string{
					1: "Special Edition",
				},
			}
			result := buildDiscSubtitles(album)
			Expect(result).To(HaveLen(1))
			Expect(result[0].Disc).To(Equal(int32(1)))
			Expect(result[0].Title).To(Equal("Special Edition"))
			expectedArtID := model.NewArtworkID(model.KindDiscArtwork, "album1:1", &updatedAt)
			Expect(result[0].CoverArt).To(Equal(expectedArtID.String()))
		})

		It("should return correct disc titles with cover art when album has multiple discs", func() {
			updatedAt := time.Now().Truncate(time.Second)
			album := model.Album{
				ID:        "album1",
				UpdatedAt: updatedAt,
				Discs: map[int]string{
					1: "Disc 1",
					2: "Disc 2",
				},
			}
			result := buildDiscSubtitles(album)
			Expect(result).To(HaveLen(2))
			Expect(result[0].Disc).To(Equal(int32(1)))
			Expect(result[0].Title).To(Equal("Disc 1"))
			expectedArtID1 := model.NewArtworkID(model.KindDiscArtwork, "album1:1", &updatedAt)
			Expect(result[0].CoverArt).To(Equal(expectedArtID1.String()))
			Expect(result[1].Disc).To(Equal(int32(2)))
			Expect(result[1].Title).To(Equal("Disc 2"))
			expectedArtID2 := model.NewArtworkID(model.KindDiscArtwork, "album1:2", &updatedAt)
			Expect(result[1].CoverArt).To(Equal(expectedArtID2.String()))
		})
	})

	DescribeTable("toItemDate",
		func(date string, expected responses.ItemDate) {
			Expect(toItemDate(date)).To(Equal(expected))
		},
		Entry("1994-02-04", "1994-02-04", responses.ItemDate{Year: 1994, Month: 2, Day: 4}),
		Entry("1994-02", "1994-02", responses.ItemDate{Year: 1994, Month: 2}),
		Entry("1994", "1994", responses.ItemDate{Year: 1994}),
		Entry("19940201", "", responses.ItemDate{}),
		Entry("", "", responses.ItemDate{}),
	)

	DescribeTable("mapExplicitStatus",
		func(explicitStatus string, expected string) {
			Expect(mapExplicitStatus(explicitStatus)).To(Equal(expected))
		},
		Entry("returns \"clean\" when the db value is \"c\"", "c", "clean"),
		Entry("returns \"explicit\" when the db value is \"e\"", "e", "explicit"),
		Entry("returns an empty string when the db value is \"\"", "", ""),
		Entry("returns an empty string when there are unexpected values on the db", "abc", ""))

	Describe("getArtistAlbumCount", func() {
		artist := model.Artist{
			Stats: map[model.Role]model.ArtistStats{
				model.RoleAlbumArtist: {
					AlbumCount: 3,
				},
				model.RoleMainCredit: {
					AlbumCount: 4,
				},
			},
		}

		It("Handles album count without artist participations", func() {
			conf.Server.Subsonic.ArtistParticipations = false
			result := getArtistAlbumCount(&artist)
			Expect(result).To(Equal(int32(3)))
		})

		It("Handles album count without with participations", func() {
			conf.Server.Subsonic.ArtistParticipations = true
			result := getArtistAlbumCount(&artist)
			Expect(result).To(Equal(int32(4)))
		})
	})

	DescribeTable("isClientInList",
		func(list, client string, expected bool) {
			Expect(isClientInList(list, client)).To(Equal(expected))
		},
		Entry("returns false when clientList is empty", "", "some-client", false),
		Entry("returns false when client is empty", "client1,client2", "", false),
		Entry("returns false when both are empty", "", "", false),
		Entry("returns true when client matches single entry", "my-client", "my-client", true),
		Entry("returns true when client matches first in list", "client1,client2,client3", "client1", true),
		Entry("returns true when client matches middle in list", "client1,client2,client3", "client2", true),
		Entry("returns true when client matches last in list", "client1,client2,client3", "client3", true),
		Entry("returns false when client does not match", "client1,client2", "client3", false),
		Entry("trims whitespace from client list entries", "client1, client2 , client3", "client2", true),
		Entry("does not trim the client parameter", "client1,client2", " client1", false),
	)

	Describe("childFromMediaFile", func() {
		var mf model.MediaFile
		var ctx context.Context

		BeforeEach(func() {
			mf = model.MediaFile{
				ID:          "mf-1",
				Title:       "Test Song",
				Album:       "Test Album",
				AlbumID:     "album-1",
				Artist:      "Test Artist",
				ArtistID:    "artist-1",
				Year:        2023,
				Genre:       "Rock",
				TrackNumber: 5,
				Duration:    180.5,
				Size:        5000000,
				Suffix:      "mp3",
				BitRate:     320,
			}
			ctx = context.Background()
		})

		Context("with minimal client", func() {
			BeforeEach(func() {
				conf.Server.Subsonic.MinimalClients = "minimal-client"
				player := model.Player{Client: "minimal-client"}
				ctx = request.WithPlayer(ctx, player)
			})

			It("returns only basic fields", func() {
				child := childFromMediaFile(ctx, mf)
				Expect(child.Id).To(Equal("mf-1"))
				Expect(child.Title).To(Equal("Test Song"))
				Expect(child.IsDir).To(BeFalse())

				// These should not be set
				Expect(child.Album).To(BeEmpty())
				Expect(child.Artist).To(BeEmpty())
				Expect(child.Parent).To(BeEmpty())
				Expect(child.Year).To(BeZero())
				Expect(child.Genre).To(BeEmpty())
				Expect(child.Track).To(BeZero())
				Expect(child.Duration).To(BeZero())
				Expect(child.Size).To(BeZero())
				Expect(child.Suffix).To(BeEmpty())
				Expect(child.BitRate).To(BeZero())
				Expect(child.CoverArt).To(BeEmpty())
				Expect(child.ContentType).To(BeEmpty())
				Expect(child.Path).To(BeEmpty())
			})

			It("does not include OpenSubsonic extension", func() {
				child := childFromMediaFile(ctx, mf)
				Expect(child.OpenSubsonicChild).To(BeNil())
			})
		})

		Context("with non-minimal client", func() {
			BeforeEach(func() {
				conf.Server.Subsonic.MinimalClients = "minimal-client"
				player := model.Player{Client: "regular-client"}
				ctx = request.WithPlayer(ctx, player)
			})

			It("returns all fields", func() {
				child := childFromMediaFile(ctx, mf)
				Expect(child.Id).To(Equal("mf-1"))
				Expect(child.Title).To(Equal("Test Song"))
				Expect(child.IsDir).To(BeFalse())
				Expect(child.Album).To(Equal("Test Album"))
				Expect(child.Artist).To(Equal("Test Artist"))
				Expect(child.Parent).To(Equal("album-1"))
				Expect(child.Year).To(Equal(int32(2023)))
				Expect(child.Genre).To(Equal("Rock"))
				Expect(child.Track).To(Equal(int32(5)))
				Expect(child.Duration).To(Equal(int32(180)))
				Expect(child.Size).To(Equal(int64(5000000)))
				Expect(child.Suffix).To(Equal("mp3"))
				Expect(child.BitRate).To(Equal(int32(320)))
			})
		})

		Context("when minimal clients list is empty", func() {
			BeforeEach(func() {
				conf.Server.Subsonic.MinimalClients = ""
				player := model.Player{Client: "any-client"}
				ctx = request.WithPlayer(ctx, player)
			})

			It("returns all fields", func() {
				child := childFromMediaFile(ctx, mf)
				Expect(child.Album).To(Equal("Test Album"))
				Expect(child.Artist).To(Equal("Test Artist"))
			})
		})

		Context("when no player in context", func() {
			It("returns all fields", func() {
				child := childFromMediaFile(ctx, mf)
				Expect(child.Album).To(Equal("Test Album"))
				Expect(child.Artist).To(Equal("Test Artist"))
			})
		})

		Context("when MediaFile has an empty title", func() {
			It("still includes the title field in the response", func() {
				mf.Title = ""
				child := childFromMediaFile(ctx, mf)
				Expect(child.Title).To(Equal(""))
			})
		})
	})

	Describe("osChildFromMediaFile", func() {
		var mf model.MediaFile
		var ctx context.Context

		BeforeEach(func() {
			mf = model.MediaFile{
				ID:      "mf-1",
				Title:   "Test Song",
				Artist:  "Test Artist",
				Comment: "Test Comment",
			}
			ctx = context.Background()
		})

		Context("with legacy client", func() {
			BeforeEach(func() {
				conf.Server.Subsonic.LegacyClients = "legacy-client"
				player := model.Player{Client: "legacy-client"}
				ctx = request.WithPlayer(ctx, player)
			})

			It("returns nil", func() {
				osChild := osChildFromMediaFile(ctx, mf)
				Expect(osChild).To(BeNil())
			})
		})

		Context("with non-legacy client", func() {
			BeforeEach(func() {
				conf.Server.Subsonic.LegacyClients = "legacy-client"
				player := model.Player{Client: "regular-client"}
				ctx = request.WithPlayer(ctx, player)
			})

			It("returns OpenSubsonic child fields", func() {
				osChild := osChildFromMediaFile(ctx, mf)
				Expect(osChild).ToNot(BeNil())
				Expect(osChild.Comment).To(Equal("Test Comment"))
			})
		})

		Context("when legacy clients list is empty", func() {
			BeforeEach(func() {
				conf.Server.Subsonic.LegacyClients = ""
				player := model.Player{Client: "any-client"}
				ctx = request.WithPlayer(ctx, player)
			})

			It("returns OpenSubsonic child fields", func() {
				osChild := osChildFromMediaFile(ctx, mf)
				Expect(osChild).ToNot(BeNil())
			})
		})

		Context("when no player in context", func() {
			It("returns OpenSubsonic child fields", func() {
				osChild := osChildFromMediaFile(ctx, mf)
				Expect(osChild).ToNot(BeNil())
			})
		})
	})

	Describe("selectedMusicFolderIds", func() {
		var user model.User
		var ctx context.Context

		BeforeEach(func() {
			user = model.User{
				ID: "test-user",
				Libraries: []model.Library{
					{ID: 1, Name: "Library 1"},
					{ID: 2, Name: "Library 2"},
					{ID: 3, Name: "Library 3"},
				},
			}
			ctx = request.WithUser(context.Background(), user)
		})

		Context("when musicFolderId parameter is provided", func() {
			It("should return the specified musicFolderId values", func() {
				r := httptest.NewRequest("GET", "/test?musicFolderId=1&musicFolderId=3", nil)
				r = r.WithContext(ctx)

				ids, err := selectedMusicFolderIds(r, false)
				Expect(err).ToNot(HaveOccurred())
				Expect(ids).To(Equal([]int{1, 3}))
			})

			It("should ignore invalid musicFolderId parameter values", func() {
				r := httptest.NewRequest("GET", "/test?musicFolderId=invalid&musicFolderId=2", nil)
				r = r.WithContext(ctx)

				ids, err := selectedMusicFolderIds(r, false)
				Expect(err).ToNot(HaveOccurred())
				Expect(ids).To(Equal([]int{2})) // Only valid ID is returned
			})

			It("should return error when any library ID is not accessible", func() {
				r := httptest.NewRequest("GET", "/test?musicFolderId=1&musicFolderId=5&musicFolderId=2&musicFolderId=99", nil)
				r = r.WithContext(ctx)

				ids, err := selectedMusicFolderIds(r, false)
				Expect(err).To(HaveOccurred())
				Expect(err.Error()).To(ContainSubstring("Library 5 not found or not accessible"))
				Expect(ids).To(BeNil())
			})
		})

		Context("when musicFolderId parameter is not provided", func() {
			Context("and required is false", func() {
				It("should return all user's library IDs", func() {
					r := httptest.NewRequest("GET", "/test", nil)
					r = r.WithContext(ctx)

					ids, err := selectedMusicFolderIds(r, false)
					Expect(err).ToNot(HaveOccurred())
					Expect(ids).To(Equal([]int{1, 2, 3}))
				})

				It("should return empty slice when user has no libraries", func() {
					userWithoutLibs := model.User{ID: "no-libs-user", Libraries: []model.Library{}}
					ctxWithoutLibs := request.WithUser(context.Background(), userWithoutLibs)
					r := httptest.NewRequest("GET", "/test", nil)
					r = r.WithContext(ctxWithoutLibs)

					ids, err := selectedMusicFolderIds(r, false)
					Expect(err).ToNot(HaveOccurred())
					Expect(ids).To(Equal([]int{}))
				})
			})

			Context("and required is true", func() {
				It("should return ErrMissingParam error", func() {
					r := httptest.NewRequest("GET", "/test", nil)
					r = r.WithContext(ctx)

					ids, err := selectedMusicFolderIds(r, true)
					Expect(err).To(MatchError(req.ErrMissingParam))
					Expect(ids).To(BeNil())
				})
			})
		})

		Context("when musicFolderId parameter is empty", func() {
			It("should return all user's library IDs even when empty parameter is provided", func() {
				r := httptest.NewRequest("GET", "/test?musicFolderId=", nil)
				r = r.WithContext(ctx)

				ids, err := selectedMusicFolderIds(r, false)
				Expect(err).ToNot(HaveOccurred())
				Expect(ids).To(Equal([]int{1, 2, 3}))
			})
		})

		Context("when all musicFolderId parameters are invalid", func() {
			It("should return all user libraries when all musicFolderId parameters are invalid", func() {
				r := httptest.NewRequest("GET", "/test?musicFolderId=invalid&musicFolderId=notanumber", nil)
				r = r.WithContext(ctx)

				ids, err := selectedMusicFolderIds(r, false)
				Expect(err).ToNot(HaveOccurred())
				Expect(ids).To(Equal([]int{1, 2, 3})) // Falls back to all user libraries
			})
		})
	})

	Describe("AverageRating in responses", func() {
		var ctx context.Context

		BeforeEach(func() {
			ctx = context.Background()
			conf.Server.Subsonic.EnableAverageRating = true
		})

		Describe("childFromMediaFile", func() {
			It("includes averageRating when set", func() {
				mf := model.MediaFile{
					ID:    "mf-avg-1",
					Title: "Test Song",
					Annotations: model.Annotations{
						AverageRating: 4.5,
					},
				}
				child := childFromMediaFile(ctx, mf)
				Expect(child.AverageRating).To(Equal(4.5))
			})

			It("returns 0 for averageRating when not set", func() {
				mf := model.MediaFile{
					ID:    "mf-avg-2",
					Title: "Test Song No Rating",
				}
				child := childFromMediaFile(ctx, mf)
				Expect(child.AverageRating).To(Equal(0.0))
			})
		})

		Describe("childFromAlbum", func() {
			It("includes averageRating when set", func() {
				al := model.Album{
					ID:   "al-avg-1",
					Name: "Test Album",
					Annotations: model.Annotations{
						AverageRating: 3.75,
					},
				}
				child := childFromAlbum(ctx, al)
				Expect(child.AverageRating).To(Equal(3.75))
			})

			It("returns 0 for averageRating when not set", func() {
				al := model.Album{
					ID:   "al-avg-2",
					Name: "Test Album No Rating",
				}
				child := childFromAlbum(ctx, al)
				Expect(child.AverageRating).To(Equal(0.0))
			})
		})

		Describe("toArtist", func() {
			It("includes averageRating when set", func() {
				conf.Server.Subsonic.EnableAverageRating = true
				r := httptest.NewRequest("GET", "/test", nil)
				a := model.Artist{
					ID:   "ar-avg-1",
					Name: "Test Artist",
					Annotations: model.Annotations{
						AverageRating: 5.0,
					},
				}
				artist := toArtist(r, a)
				Expect(artist.AverageRating).To(Equal(5.0))
			})
		})

		Describe("toArtistID3", func() {
			It("includes averageRating when set", func() {
				conf.Server.Subsonic.EnableAverageRating = true
				r := httptest.NewRequest("GET", "/test", nil)
				a := model.Artist{
					ID:   "ar-avg-2",
					Name: "Test Artist ID3",
					Annotations: model.Annotations{
						AverageRating: 2.5,
					},
				}
				artist := toArtistID3(r, a)
				Expect(artist.AverageRating).To(Equal(2.5))
			})
		})

		Describe("buildAlbumID3 Created field", func() {
			It("uses CreatedAt when set", func() {
				t := time.Date(2020, 1, 2, 3, 4, 5, 0, time.UTC)
				al := model.Album{ID: "a1", Name: "A", CreatedAt: t}
				dir := buildAlbumID3(ctx, al)
				Expect(dir.Created).ToNot(BeNil())
				Expect(*dir.Created).To(Equal(t))
			})

			It("falls back to UpdatedAt when CreatedAt is zero", func() {
				updated := time.Date(2019, 5, 6, 7, 8, 9, 0, time.UTC)
				al := model.Album{ID: "a2", Name: "A", UpdatedAt: updated}
				dir := buildAlbumID3(ctx, al)
				Expect(dir.Created).ToNot(BeNil())
				Expect(*dir.Created).To(Equal(updated))
			})

			It("falls back to ImportedAt when CreatedAt and UpdatedAt are zero", func() {
				imported := time.Date(2021, 8, 9, 10, 11, 12, 0, time.UTC)
				al := model.Album{ID: "a3", Name: "A", ImportedAt: imported}
				dir := buildAlbumID3(ctx, al)
				Expect(dir.Created).ToNot(BeNil())
				Expect(*dir.Created).To(Equal(imported))
			})

			It("never leaves Created nil even when all timestamps are zero", func() {
				al := model.Album{ID: "a4", Name: "A"}
				dir := buildAlbumID3(ctx, al)
				Expect(dir.Created).ToNot(BeNil())
			})
		})

		Describe("EnableAverageRating config", func() {
			It("excludes averageRating when disabled", func() {
				conf.Server.Subsonic.EnableAverageRating = false

				mf := model.MediaFile{
					ID:    "mf-cfg-1",
					Title: "Test Song",
					Annotations: model.Annotations{
						AverageRating: 4.5,
					},
				}
				child := childFromMediaFile(ctx, mf)
				Expect(child.AverageRating).To(Equal(0.0))

				al := model.Album{
					ID:   "al-cfg-1",
					Name: "Test Album",
					Annotations: model.Annotations{
						AverageRating: 3.75,
					},
				}
				albumChild := childFromAlbum(ctx, al)
				Expect(albumChild.AverageRating).To(Equal(0.0))

				r := httptest.NewRequest("GET", "/test", nil)
				a := model.Artist{
					ID:   "ar-cfg-1",
					Name: "Test Artist",
					Annotations: model.Annotations{
						AverageRating: 5.0,
					},
				}
				artist := toArtist(r, a)
				Expect(artist.AverageRating).To(Equal(0.0))

				artistID3 := toArtistID3(r, a)
				Expect(artistID3.AverageRating).To(Equal(0.0))
			})
		})
	})
})

var _ = Describe("buildLyricCues", func() {
	It("returns nil for empty cue slice", func() {
		Expect(buildLyricCues(nil, nil)).To(BeNil())
		Expect(buildLyricCues([]model.Cue{}, nil)).To(BeNil())
	})

	It("skips cues without a Start", func() {
		cues := []model.Cue{
			{Value: "no start", ByteStart: 0, ByteEnd: 7},
		}
		result := buildLyricCues(cues, nil)
		Expect(result).To(BeEmpty())
	})

	It("returns cues with correct Start, Value, ByteStart, ByteEnd", func() {
		t1 := int64(1000)
		cues := []model.Cue{
			{Start: &t1, Value: "Hello", ByteStart: 0, ByteEnd: 4},
		}
		result := buildLyricCues(cues, nil)
		Expect(result).To(HaveLen(1))
		Expect(result[0].Start).To(Equal(t1))
		Expect(result[0].Value).To(Equal("Hello"))
		Expect(result[0].ByteStart).To(Equal(0))
		Expect(result[0].ByteEnd).To(Equal(4))
	})

	It("does not set End when no cue has an End (hasAnyEnd=false)", func() {
		t1, t2 := int64(1000), int64(1500)
		cues := []model.Cue{
			{Start: &t1, Value: "word1", ByteStart: 0, ByteEnd: 4},
			{Start: &t2, Value: "word2", ByteStart: 6, ByteEnd: 10},
		}
		result := buildLyricCues(cues, nil)
		Expect(result).To(HaveLen(2))
		Expect(result[0].End).To(BeNil())
		Expect(result[1].End).To(BeNil())
	})

	It("sets End from next cue Start when hasAnyEnd=true and cue has no End", func() {
		t1, t2, t3 := int64(1000), int64(1500), int64(2000)
		cues := []model.Cue{
			{Start: &t1, End: &t2, Value: "w1", ByteStart: 0, ByteEnd: 1},
			{Start: &t2, Value: "w2", ByteStart: 3, ByteEnd: 4},
			{Start: &t3, Value: "w3", ByteStart: 6, ByteEnd: 7},
		}
		result := buildLyricCues(cues, nil)
		Expect(*result[1].End).To(Equal(t3))
	})

	It("uses lineEnd as fallback for last cue when no next cue exists", func() {
		t1, t2, lineEnd := int64(1000), int64(1500), int64(3000)
		cues := []model.Cue{
			{Start: &t1, End: &t2, Value: "w1", ByteStart: 0, ByteEnd: 1},
			{Start: &t2, Value: "w2 last", ByteStart: 3, ByteEnd: 9},
		}
		result := buildLyricCues(cues, &lineEnd)
		Expect(*result[1].End).To(Equal(lineEnd))
	})

	It("caps cue End at next cue Start when End is later", func() {
		t1, t2, bigEnd := int64(1000), int64(1500), int64(9999)
		cues := []model.Cue{
			{Start: &t1, End: &bigEnd, Value: "w1", ByteStart: 0, ByteEnd: 1},
			{Start: &t2, End: &bigEnd, Value: "w2", ByteStart: 3, ByteEnd: 4},
		}
		result := buildLyricCues(cues, nil)
		// First cue's End should be clamped to t2 (next cue Start)
		Expect(*result[0].End).To(Equal(t2))
	})

	It("clears all Ends when last cue has no End and no fallback", func() {
		t1, t2, t3 := int64(1000), int64(1500), int64(2000)
		cues := []model.Cue{
			{Start: &t1, End: &t2, Value: "w1", ByteStart: 0, ByteEnd: 1},
			{Start: &t2, End: &t3, Value: "w2", ByteStart: 3, ByteEnd: 4},
			{Start: &t3, Value: "w3 no end", ByteStart: 6, ByteEnd: 14},
		}
		// No lineEnd and last cue has no End → all ends cleared
		result := buildLyricCues(cues, nil)
		for _, r := range result {
			Expect(r.End).To(BeNil())
		}
	})
})

var _ = Describe("buildStructuredLyric", func() {
	var mf *model.MediaFile

	BeforeEach(func() {
		mf = &model.MediaFile{
			Artist: "Test Artist",
			Title:  "Test Title",
		}
	})

	It("returns correct Lang, Synced, DisplayArtist, DisplayTitle with enhanced=false", func() {
		t1 := int64(1000)
		lyrics := model.Lyrics{
			Lang:   "eng",
			Synced: true,
			Line: []model.Line{
				{Start: &t1, Value: "Hello"},
			},
		}
		result := buildStructuredLyric(mf, lyrics, false)
		Expect(result.Lang).To(Equal("eng"))
		Expect(result.Synced).To(BeTrue())
		Expect(result.DisplayArtist).To(Equal("Test Artist"))
		Expect(result.DisplayTitle).To(Equal("Test Title"))
	})

	It("falls back to mf Artist/Title when DisplayArtist/DisplayTitle are empty", func() {
		t1 := int64(1000)
		lyrics := model.Lyrics{
			Lang: "eng",
			Line: []model.Line{{Start: &t1, Value: "test"}},
		}
		result := buildStructuredLyric(mf, lyrics, false)
		Expect(result.DisplayArtist).To(Equal("Test Artist"))
		Expect(result.DisplayTitle).To(Equal("Test Title"))
	})

	It("uses lyrics DisplayArtist/DisplayTitle when set", func() {
		t1 := int64(1000)
		lyrics := model.Lyrics{
			DisplayArtist: "Lyric Artist",
			DisplayTitle:  "Lyric Title",
			Lang:          "eng",
			Line:          []model.Line{{Start: &t1, Value: "test"}},
		}
		result := buildStructuredLyric(mf, lyrics, false)
		Expect(result.DisplayArtist).To(Equal("Lyric Artist"))
		Expect(result.DisplayTitle).To(Equal("Lyric Title"))
	})

	It("does not set Kind when enhanced=false", func() {
		t1 := int64(1000)
		lyrics := model.Lyrics{
			Kind: "main",
			Lang: "eng",
			Line: []model.Line{{Start: &t1, Value: "test"}},
		}
		result := buildStructuredLyric(mf, lyrics, false)
		Expect(result.Kind).To(BeEmpty())
	})

	It("sets Kind to 'main' by default when enhanced=true and Kind is empty", func() {
		t1 := int64(1000)
		lyrics := model.Lyrics{
			Lang: "eng",
			Line: []model.Line{{Start: &t1, Value: "test"}},
		}
		result := buildStructuredLyric(mf, lyrics, true)
		Expect(result.Kind).To(Equal("main"))
	})

	It("uses lyrics Kind when enhanced=true and Kind is set", func() {
		t1 := int64(1000)
		lyrics := model.Lyrics{
			Kind: "translation",
			Lang: "es",
			Line: []model.Line{{Start: &t1, Value: "Hola"}},
		}
		result := buildStructuredLyric(mf, lyrics, true)
		Expect(result.Kind).To(Equal("translation"))
	})

	It("does not produce CueLine entries when enhanced=false even with cues", func() {
		t1, t2 := int64(1000), int64(1500)
		lyrics := model.Lyrics{
			Lang:   "eng",
			Synced: true,
			Line: []model.Line{
				{
					Start: &t1,
					End:   &t2,
					Value: "Hello",
					Cue: []model.Cue{
						{Start: &t1, End: &t2, Value: "Hello", ByteStart: 0, ByteEnd: 4},
					},
				},
			},
		}
		result := buildStructuredLyric(mf, lyrics, false)
		Expect(result.CueLine).To(BeNil())
	})

	It("produces CueLine entries when enhanced=true and line has cues", func() {
		t1, t2 := int64(1000), int64(1500)
		lyrics := model.Lyrics{
			Lang:   "eng",
			Synced: true,
			Line: []model.Line{
				{
					Start: &t1,
					End:   &t2,
					Value: "Hello",
					Cue: []model.Cue{
						{Start: &t1, End: &t2, Value: "Hello", ByteStart: 0, ByteEnd: 4},
					},
				},
			},
		}
		result := buildStructuredLyric(mf, lyrics, true)
		Expect(result.CueLine).To(HaveLen(1))
		Expect(result.CueLine[0].Index).To(Equal(int32(0)))
		Expect(result.CueLine[0].Value).To(Equal("Hello"))
		Expect(*result.CueLine[0].Start).To(Equal(t1))
		Expect(*result.CueLine[0].End).To(Equal(t2))
	})

	It("sets Agents in response only when enhanced=true and cue lines exist", func() {
		t1, t2 := int64(1000), int64(1500)
		lyrics := model.Lyrics{
			Lang:   "eng",
			Agents: []model.Agent{{ID: "lead", Role: "main", Name: "Lead"}},
			Synced: true,
			Line: []model.Line{
				{
					Start: &t1,
					End:   &t2,
					Value: "Hello",
					Cue: []model.Cue{
						{Start: &t1, End: &t2, Value: "Hello", ByteStart: 0, ByteEnd: 4, AgentID: "lead"},
					},
				},
			},
		}
		result := buildStructuredLyric(mf, lyrics, true)
		Expect(result.Agents).To(HaveLen(1))
		Expect(result.Agents[0].ID).To(Equal("lead"))
		Expect(result.Agents[0].Role).To(Equal("main"))
	})

	It("does not set Agents when enhanced=true but no cue lines", func() {
		t1 := int64(1000)
		lyrics := model.Lyrics{
			Lang:   "eng",
			Agents: []model.Agent{{ID: "lead", Role: "main"}},
			Synced: true,
			Line: []model.Line{
				{Start: &t1, Value: "Plain line"},
			},
		}
		result := buildStructuredLyric(mf, lyrics, true)
		Expect(result.Agents).To(BeNil())
	})

	It("produces multiple CueLines when cues belong to different agents", func() {
		t1, t2, t3 := int64(1000), int64(1400), int64(2000)
		lyrics := model.Lyrics{
			Lang:   "eng",
			Synced: true,
			Agents: []model.Agent{
				{ID: "main", Role: "main"},
				{ID: "__nd_bg__|main", Role: "bg"},
			},
			Line: []model.Line{
				{
					Start: &t1,
					End:   &t3,
					Value: "Hello echo",
					Cue: []model.Cue{
						{Start: &t1, End: &t2, Value: "Hello", ByteStart: 0, ByteEnd: 4, AgentID: "main"},
						{Start: &t2, End: &t3, Value: "echo", ByteStart: 6, ByteEnd: 9, AgentID: "__nd_bg__|main"},
					},
				},
			},
		}
		result := buildStructuredLyric(mf, lyrics, true)
		Expect(result.CueLine).To(HaveLen(2))
		Expect(result.CueLine[0].AgentID).To(Equal("main"))
		Expect(result.CueLine[1].AgentID).To(Equal("__nd_bg__|main"))
	})
})

var _ = Describe("buildLyricsList", func() {
	var mf *model.MediaFile

	BeforeEach(func() {
		mf = &model.MediaFile{
			Artist: "Test Artist",
			Title:  "Test Title",
		}
	})

	It("returns all entries when enhanced=true regardless of Kind", func() {
		t1 := int64(1000)
		list := model.LyricList{
			{Kind: "main", Lang: "eng", Synced: true, Line: []model.Line{{Start: &t1, Value: "main"}}},
			{Kind: "translation", Lang: "es", Synced: true, Line: []model.Line{{Start: &t1, Value: "trans"}}},
			{Kind: "pronunciation", Lang: "ja-latn", Synced: true, Line: []model.Line{{Start: &t1, Value: "pron"}}},
		}
		result := buildLyricsList(mf, list, true)
		Expect(result.StructuredLyrics).To(HaveLen(3))
	})

	It("filters to only main/empty-kind entries when enhanced=false", func() {
		t1 := int64(1000)
		list := model.LyricList{
			{Kind: "main", Lang: "eng", Synced: true, Line: []model.Line{{Start: &t1, Value: "main"}}},
			{Kind: "translation", Lang: "es", Synced: true, Line: []model.Line{{Start: &t1, Value: "trans"}}},
			{Kind: "pronunciation", Lang: "ja-latn", Synced: true, Line: []model.Line{{Start: &t1, Value: "pron"}}},
			{Kind: "", Lang: "por", Synced: true, Line: []model.Line{{Start: &t1, Value: "no kind"}}},
		}
		result := buildLyricsList(mf, list, false)
		Expect(result.StructuredLyrics).To(HaveLen(2))
		Expect(result.StructuredLyrics[0].Lang).To(Equal("eng"))
		Expect(result.StructuredLyrics[1].Lang).To(Equal("por"))
	})

	It("returns empty list when input is empty", func() {
		result := buildLyricsList(mf, model.LyricList{}, false)
		Expect(result.StructuredLyrics).To(HaveLen(0))
	})

	It("sets Kind in response entries when enhanced=true", func() {
		t1 := int64(1000)
		list := model.LyricList{
			{Kind: "translation", Lang: "es", Synced: true, Line: []model.Line{{Start: &t1, Value: "trans"}}},
		}
		result := buildLyricsList(mf, list, true)
		Expect(result.StructuredLyrics[0].Kind).To(Equal("translation"))
	})

	It("does not set Kind in response entries when enhanced=false", func() {
		t1 := int64(1000)
		list := model.LyricList{
			{Kind: "main", Lang: "eng", Synced: true, Line: []model.Line{{Start: &t1, Value: "main"}}},
		}
		result := buildLyricsList(mf, list, false)
		Expect(result.StructuredLyrics[0].Kind).To(BeEmpty())
	})
})
