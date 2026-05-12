package model_test

import (
	. "github.com/navidrome/navidrome/model"
	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"
)

var _ = Describe("ToLyrics", func() {
	It("should parse tags with spaces", func() {
		num := int64(1551)
		lyrics, err := ToLyrics("xxx", "[lang:  eng  ]\n[offset: 1551 ]\n[ti: A title ]\n[ar: An artist ]\n[00:00.00]Hi there")
		Expect(err).ToNot(HaveOccurred())
		Expect(lyrics.Lang).To(Equal("eng"))
		Expect(lyrics.Synced).To(BeTrue())
		Expect(lyrics.DisplayArtist).To(Equal("An artist"))
		Expect(lyrics.DisplayTitle).To(Equal("A title"))
		Expect(lyrics.Offset).To(Equal(&num))
	})

	It("Should ignore bad offset", func() {
		lyrics, err := ToLyrics("xxx", "[offset: NotANumber ]\n[00:00.00]Hi there")
		Expect(err).ToNot(HaveOccurred())
		Expect(lyrics.Offset).To(BeNil())
	})

	It("should accept lines with no text and weird times", func() {
		a, b, c, d := int64(0), int64(10040), int64(40000), int64(1000*60*60)
		lyrics, err := ToLyrics("xxx", "[00:00.00]Hi there\n\n\n[00:10.040]\n[00:40]Test\n[01:00:00]late")
		Expect(err).ToNot(HaveOccurred())
		Expect(lyrics.Synced).To(BeTrue())
		Expect(lyrics.Line).To(Equal([]Line{
			{Start: &a, Value: "Hi there"},
			{Start: &b, Value: ""},
			{Start: &c, Value: "Test"},
			{Start: &d, Value: "late"},
		}))
	})

	It("Should support multiple timestamps per line", func() {
		a, b, c, d := int64(0), int64(10000), int64(13*60*1000), int64(1000*60*60*51)
		lyrics, err := ToLyrics("xxx", "[00:00.00]  [00:10.00]Repeated\n[13:00][51:00:00.00]")
		Expect(err).ToNot(HaveOccurred())
		Expect(lyrics.Synced).To(BeTrue())
		Expect(lyrics.Line).To(Equal([]Line{
			{Start: &a, Value: "Repeated"},
			{Start: &b, Value: "Repeated"},
			{Start: &c, Value: ""},
			{Start: &d, Value: ""},
		}))
	})

	It("Should support parsing multiline string", func() {
		a, b := int64(0), int64(10*60*1000+1)
		lyrics, err := ToLyrics("xxx", "[00:00.00]This is\na multiline  \n\n  [:0] string\n[10:00.001]This is\nalso one")
		Expect(err).ToNot(HaveOccurred())
		Expect(lyrics.Synced).To(BeTrue())
		Expect(lyrics.Line).To(Equal([]Line{
			{Start: &a, Value: "This is\na multiline\n\n[:0] string"},
			{Start: &b, Value: "This is\nalso one"},
		}))
	})

	It("Does not match timestamp in middle of line", func() {
		lyrics, err := ToLyrics("xxx", "This could [00:00:00] be a synced file")
		Expect(err).ToNot(HaveOccurred())
		Expect(lyrics.Synced).To(BeFalse())
		Expect(lyrics.Line).To(Equal([]Line{
			{Value: "This could [00:00:00] be a synced file"},
		}))
	})

	It("Allows timestamp in middle of line if also at beginning", func() {
		a, b := int64(0), int64(1000)
		lyrics, err := ToLyrics("xxx", "  [00:00] This is [00:00:00] be a synced file\n		[00:01]Line 2")
		Expect(err).ToNot(HaveOccurred())
		Expect(lyrics.Synced).To(BeTrue())
		Expect(lyrics.Line).To(Equal([]Line{
			{Start: &a, Value: "This is [00:00:00] be a synced file"},
			{Start: &b, Value: "Line 2"},
		}))
	})

	It("Ignores lines in synchronized lyric prior to first timestamp", func() {
		a := int64(0)
		lyrics, err := ToLyrics("xxx", "This is some prelude\nThat doesn't\nmatter\n[00:00]Text")
		Expect(err).ToNot(HaveOccurred())
		Expect(lyrics.Synced).To(BeTrue())
		Expect(lyrics.Line).To(Equal([]Line{
			{Start: &a, Value: "Text"},
		}))
	})

	It("Handles all possible ms cases", func() {
		a, b, c := int64(1), int64(10), int64(100)
		lyrics, err := ToLyrics("xxx", "[00:00.001]a\n[00:00.01]b\n[00:00.1]c")
		Expect(err).ToNot(HaveOccurred())
		Expect(lyrics.Synced).To(BeTrue())
		Expect(lyrics.Line).To(Equal([]Line{
			{Start: &a, Value: "a"},
			{Start: &b, Value: "b"},
			{Start: &c, Value: "c"},
		}))
	})

	It("Properly sorts repeated lyrics out of order", func() {
		a, b, c, d, e := int64(0), int64(10000), int64(40000), int64(13*60*1000), int64(1000*60*60*51)
		lyrics, err := ToLyrics("xxx", "[00:00.00]  [13:00]Repeated\n[00:10.00][51:00:00.00]Test\n[00:40.00]Not repeated")
		Expect(err).ToNot(HaveOccurred())
		Expect(lyrics.Synced).To(BeTrue())
		Expect(lyrics.Line).To(Equal([]Line{
			{Start: &a, Value: "Repeated"},
			{Start: &b, Value: "Test"},
			{Start: &c, Value: "Not repeated"},
			{Start: &d, Value: "Repeated"},
			{Start: &e, Value: "Test"},
		}))
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
