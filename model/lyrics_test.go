package model

import (
	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"
)

var _ = Describe("Lyrics.EffectiveKind", func() {
	It("defaults a blank kind to main", func() {
		Expect(Lyrics{}.EffectiveKind()).To(Equal(LyricKindMain))
		Expect(Lyrics{Kind: "  "}.EffectiveKind()).To(Equal(LyricKindMain))
	})

	It("returns the kind as-is when set", func() {
		Expect(Lyrics{Kind: LyricKindTranslation}.EffectiveKind()).To(Equal(LyricKindTranslation))
	})
})

var _ = Describe("Lyrics.IsMainKind", func() {
	It("is true for a blank (untyped) kind", func() {
		Expect(Lyrics{}.IsMainKind()).To(BeTrue())
	})

	It("is true for the main kind", func() {
		Expect(Lyrics{Kind: LyricKindMain}.IsMainKind()).To(BeTrue())
	})

	It("is false for translation and pronunciation kinds", func() {
		Expect(Lyrics{Kind: LyricKindTranslation}.IsMainKind()).To(BeFalse())
		Expect(Lyrics{Kind: LyricKindPronunciation}.IsMainKind()).To(BeFalse())
	})
})

var _ = Describe("LyricList.Main", func() {
	It("returns false when the list is empty", func() {
		_, ok := LyricList{}.Main()
		Expect(ok).To(BeFalse())
	})

	It("returns the main-kind entry when present", func() {
		list := LyricList{
			{Kind: LyricKindTranslation, Lang: "en"},
			{Kind: LyricKindMain, Lang: "xxx"},
		}
		main, ok := list.Main()
		Expect(ok).To(BeTrue())
		Expect(main.Kind).To(Equal(LyricKindMain))
	})

	It("falls back to the first entry when no main kind exists", func() {
		list := LyricList{
			{Kind: LyricKindTranslation, Lang: "en"},
			{Kind: LyricKindPronunciation, Lang: "ja"},
		}
		main, ok := list.Main()
		Expect(ok).To(BeTrue())
		Expect(main.Lang).To(Equal("en"))
	})

	It("treats a blank kind as main", func() {
		list := LyricList{
			{Kind: LyricKindTranslation, Lang: "en"},
			{Lang: "xxx"},
		}
		main, ok := list.Main()
		Expect(ok).To(BeTrue())
		Expect(main.Lang).To(Equal("xxx"))
	})

	It("should parse Enhanced LRC with word-level timing", func() {
		lyrics, err := ToLyrics("xxx", "[00:01.00]<00:01.00>Some <00:01.50>lyrics <00:02.00>here\n[00:03.00]<00:03.00>More <00:03.50>words")
		Expect(err).ToNot(HaveOccurred())
		Expect(lyrics.Synced).To(BeTrue())
		Expect(lyrics.Line).To(HaveLen(2))

		t1000, t1500, t2000, t3000, t3500 := int64(1000), int64(1500), int64(2000), int64(3000), int64(3500)

		line0 := lyrics.Line[0]
		Expect(line0.Start).To(Equal(&t1000))
		Expect(line0.End).To(Equal(&t3000))
		Expect(line0.Value).To(Equal("Some lyrics here"))
		Expect(line0.Cue).To(Equal([]Cue{
			{Start: &t1000, End: &t1500, Value: "Some ", ByteStart: 0, ByteEnd: 4},
			{Start: &t1500, End: &t2000, Value: "lyrics ", ByteStart: 5, ByteEnd: 11},
			{Start: &t2000, End: &t3000, Value: "here", ByteStart: 12, ByteEnd: 15},
		}))

		line1 := lyrics.Line[1]
		Expect(line1.Start).To(Equal(&t3000))
		Expect(line1.End).To(Equal(&t3500))
		Expect(line1.Value).To(Equal("More words"))
		Expect(line1.Cue).To(Equal([]Cue{
			{Start: &t3000, Value: "More ", ByteStart: 0, ByteEnd: 4},
			{Start: &t3500, Value: "words", ByteStart: 5, ByteEnd: 9},
		}))

		Expect(line1.Cue[1].End).To(BeNil())
	})

	It("should ignore Enhanced LRC markers and return plain lines when no markers present", func() {
		a, b := int64(1000), int64(3000)
		lyrics, err := ToLyrics("xxx", "[00:01.00]Plain line\n[00:03.00]Another plain line")
		Expect(err).ToNot(HaveOccurred())
		Expect(lyrics.Line).To(Equal([]Line{
			{Start: &a, Value: "Plain line"},
			{Start: &b, Value: "Another plain line"},
		}))
	})

	It("should handle mixed Enhanced and plain LRC lines", func() {
		lyrics, err := ToLyrics("xxx", "[00:01.00]<00:01.00>Some <00:01.50>lyrics\n[00:03.00]Plain line\n[00:05.00]<00:05.00>More <00:05.50>words")
		Expect(err).ToNot(HaveOccurred())
		Expect(lyrics.Line).To(HaveLen(3))

		t1000, t1500, t5000, t5500 := int64(1000), int64(1500), int64(5000), int64(5500)
		t3000 := int64(3000)

		Expect(lyrics.Line[0].Cue).To(Equal([]Cue{
			{Start: &t1000, End: &t1500, Value: "Some ", ByteStart: 0, ByteEnd: 4},
			{Start: &t1500, End: &t3000, Value: "lyrics", ByteStart: 5, ByteEnd: 10},
		}))
		Expect(lyrics.Line[0].Value).To(Equal("Some lyrics"))
		Expect(lyrics.Line[0].End).To(Equal(&t3000))

		Expect(lyrics.Line[1].Cue).To(BeNil())
		Expect(lyrics.Line[1].Value).To(Equal("Plain line"))

		Expect(lyrics.Line[2].Cue).To(Equal([]Cue{
			{Start: &t5000, Value: "More ", ByteStart: 0, ByteEnd: 4},
			{Start: &t5500, Value: "words", ByteStart: 5, ByteEnd: 9},
		}))
		Expect(lyrics.Line[2].Value).To(Equal("More words"))
	})

	It("should preserve byte offsets for Enhanced LRC cues", func() {
		lyrics, err := ToLyrics("xxx", "[00:00.00]<00:00.00>Oh <00:00.90>love<00:01.30> me <00:01.60>tonight")
		Expect(err).ToNot(HaveOccurred())
		Expect(lyrics.Line).To(HaveLen(1))

		t0, t900, t1300, t1600 := int64(0), int64(900), int64(1300), int64(1600)
		line := lyrics.Line[0]
		Expect(line.Value).To(Equal("Oh love me tonight"))
		Expect(line.Cue).To(Equal([]Cue{
			{Start: &t0, Value: "Oh ", ByteStart: 0, ByteEnd: 2},
			{Start: &t900, Value: "love", ByteStart: 3, ByteEnd: 6},
			{Start: &t1300, Value: " me ", ByteStart: 7, ByteEnd: 10},
			{Start: &t1600, Value: "tonight", ByteStart: 11, ByteEnd: 17},
		}))
	})
})

var _ = Describe("NormalizeLyrics", func() {
	It("returns lyrics unchanged when there are no agents", func() {
		t1 := int64(1000)
		input := Lyrics{
			Lang:   "eng",
			Synced: true,
			Line: []Line{
				{Start: &t1, Value: "Hello"},
			},
		}
		result := NormalizeLyrics(input)
		Expect(result.Lang).To(Equal("eng"))
		Expect(result.Synced).To(BeTrue())
		Expect(result.Agents).To(BeNil())
		Expect(result.Line).To(HaveLen(1))
	})

	It("preserves non-empty agents", func() {
		t1 := int64(1000)
		input := Lyrics{
			Lang:   "eng",
			Agents: []Agent{{ID: "v1", Role: "main", Name: "Artist"}},
			Synced: true,
			Line: []Line{
				{Start: &t1, Value: "Hello"},
			},
		}
		result := NormalizeLyrics(input)
		Expect(result.Agents).To(HaveLen(1))
		Expect(result.Agents[0].ID).To(Equal("v1"))
	})

	It("clears empty agents slice to nil", func() {
		t1 := int64(1000)
		input := Lyrics{
			Lang:   "eng",
			Agents: []Agent{},
			Line: []Line{
				{Start: &t1, Value: "Hello"},
			},
		}
		result := NormalizeLyrics(input)
		Expect(result.Agents).To(BeNil())
	})

	It("calls NormalizeCueLines on line cues", func() {
		t1, t2 := int64(1000), int64(2000)
		input := Lyrics{
			Lang:   "eng",
			Synced: true,
			Line: []Line{
				{
					Start: &t1,
					Cue: []Cue{
						{Start: &t1, Value: "word", ByteStart: 0, ByteEnd: 3},
					},
				},
				{
					Start: &t2,
					Value: "next line",
				},
			},
		}
		result := NormalizeLyrics(input)
		// NormalizeCueLines should fill in cue end using next line's start
		Expect(result.Line[0].Cue[0].End).To(Equal(&t2))
	})
})

var _ = Describe("NormalizeCueLines", func() {
	It("returns unchanged lines when input is empty", func() {
		result := NormalizeCueLines(nil)
		Expect(result).To(BeNil())

		result = NormalizeCueLines([]Line{})
		Expect(result).To(BeEmpty())
	})

	It("leaves lines with no cues unchanged", func() {
		t1 := int64(1000)
		lines := []Line{{Start: &t1, Value: "No cues"}}
		result := NormalizeCueLines(lines)
		Expect(result).To(HaveLen(1))
		Expect(result[0].Cue).To(BeNil())
	})

	It("fills cue end using next cue's start within same line", func() {
		t1, t2 := int64(1000), int64(1500)
		lines := []Line{
			{
				Start: &t1,
				Cue: []Cue{
					{Start: &t1, Value: "first", ByteStart: 0, ByteEnd: 4},
					{Start: &t2, Value: "second", ByteStart: 6, ByteEnd: 11},
				},
			},
		}
		result := NormalizeCueLines(lines)
		Expect(result[0].Cue[0].End).To(Equal(&t2))
	})

	It("fills last cue end from line's own End field", func() {
		t1, t2, t3 := int64(1000), int64(1500), int64(2000)
		lines := []Line{
			{
				Start: &t1,
				End:   &t3,
				Cue: []Cue{
					{Start: &t1, Value: "w1", ByteStart: 0, ByteEnd: 1},
					{Start: &t2, Value: "w2", ByteStart: 3, ByteEnd: 4},
				},
			},
		}
		result := NormalizeCueLines(lines)
		Expect(result[0].Cue[1].End).To(Equal(&t3))
	})

	It("fills last cue end from next line's Start when line has no End", func() {
		t1, t2, t3 := int64(1000), int64(1500), int64(2000)
		lines := []Line{
			{
				Start: &t1,
				Cue: []Cue{
					{Start: &t1, Value: "w1", ByteStart: 0, ByteEnd: 1},
					{Start: &t2, Value: "w2", ByteStart: 3, ByteEnd: 4},
				},
			},
			{Start: &t3, Value: "next line"},
		}
		result := NormalizeCueLines(lines)
		Expect(result[0].Cue[1].End).To(Equal(&t3))
	})

	It("leaves cue ends nil when no fallback is available", func() {
		t1, t2 := int64(1000), int64(1500)
		lines := []Line{
			{
				Start: &t1,
				Cue: []Cue{
					{Start: &t1, Value: "w1", ByteStart: 0, ByteEnd: 1},
					{Start: &t2, Value: "w2", ByteStart: 3, ByteEnd: 4},
				},
			},
		}
		result := NormalizeCueLines(lines)
		// Last cue has no end, no next line, no line.End → nil
		Expect(result[0].Cue[1].End).To(BeNil())
		// When last cue has no End, all cue ends are cleared
		Expect(result[0].Cue[0].End).To(BeNil())
	})

	It("does not mutate the original input slice", func() {
		t1, t2 := int64(1000), int64(2000)
		original := []Line{
			{Start: &t1, Cue: []Cue{{Start: &t1, Value: "word", ByteStart: 0, ByteEnd: 3}}},
			{Start: &t2, Value: "next"},
		}
		_ = NormalizeCueLines(original)
		// original line's cue End should not be modified in place
		Expect(original[0].Cue[0].End).To(BeNil())
	})
})

var _ = Describe("NormalizeLineTiming", func() {
	It("returns line unchanged when no cues", func() {
		t1 := int64(1000)
		line := Line{Start: &t1, Value: "No cues"}
		result := NormalizeLineTiming(line)
		Expect(result.Start).To(Equal(&t1))
		Expect(result.End).To(BeNil())
	})

	It("hydrates line Start from earliest cue Start", func() {
		t1, t2 := int64(1000), int64(1500)
		line := Line{
			Value: "test",
			Cue: []Cue{
				{Start: &t1, End: &t2, Value: "w1"},
			},
		}
		result := NormalizeLineTiming(line)
		Expect(result.Start).To(Equal(&t1))
	})

	It("hydrates line End from latest cue End", func() {
		t1, t2, t3 := int64(1000), int64(1500), int64(2000)
		line := Line{
			Start: &t1,
			Value: "test",
			Cue: []Cue{
				{Start: &t1, End: &t2, Value: "w1"},
				{Start: &t2, End: &t3, Value: "w2"},
			},
		}
		result := NormalizeLineTiming(line)
		Expect(result.End).To(Equal(&t3))
	})

	It("does not overwrite existing line Start", func() {
		early, t1, t2 := int64(500), int64(1000), int64(1500)
		line := Line{
			Start: &early,
			Value: "test",
			Cue: []Cue{
				{Start: &t1, End: &t2, Value: "w1"},
			},
		}
		result := NormalizeLineTiming(line)
		Expect(result.Start).To(Equal(&early))
	})

	It("does not overwrite existing line End", func() {
		t1, t2, late := int64(1000), int64(1500), int64(9999)
		line := Line{
			Start: &t1,
			End:   &late,
			Value: "test",
			Cue: []Cue{
				{Start: &t1, End: &t2, Value: "w1"},
			},
		}
		result := NormalizeLineTiming(line)
		Expect(result.End).To(Equal(&late))
	})

	It("uses cue Start as fallback End when cue has no End", func() {
		t1, t2 := int64(1000), int64(1500)
		line := Line{
			Start: &t1,
			Value: "test",
			Cue: []Cue{
				{Start: &t1, Value: "w1"},
				{Start: &t2, Value: "w2"},
			},
		}
		result := NormalizeLineTiming(line)
		// Latest of (t1, t2) used as End for line since no cue.End
		Expect(result.End).To(Equal(&t2))
	})
})
