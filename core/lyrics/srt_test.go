package lyrics

import (
	"github.com/navidrome/navidrome/utils/gg"
	. "github.com/onsi/ginkgo/v2"
	. "github.com/onsi/gomega"
)

var _ = Describe("parseSRT", func() {
	Describe("digitsOnly", func() {
		It("returns false for empty string", func() {
			Expect(digitsOnly("")).To(BeFalse())
		})
		It("returns true when all characters are digits", func() {
			Expect(digitsOnly("0")).To(BeTrue())
			Expect(digitsOnly("123")).To(BeTrue())
			Expect(digitsOnly("007")).To(BeTrue())
		})
		It("returns false when any character is not a digit", func() {
			Expect(digitsOnly("1a")).To(BeFalse())
			Expect(digitsOnly("abc")).To(BeFalse())
			Expect(digitsOnly(" 1")).To(BeFalse())
			Expect(digitsOnly("1 ")).To(BeFalse())
		})
	})

	Describe("parseSRTTime", func() {
		It("parses standard SRT timestamp with comma separator", func() {
			ms, err := parseSRTTime("00:00:18,800")
			Expect(err).ToNot(HaveOccurred())
			Expect(ms).To(Equal(int64(18800)))
		})

		It("parses SRT timestamp with dot separator", func() {
			ms, err := parseSRTTime("00:00:18.800")
			Expect(err).ToNot(HaveOccurred())
			Expect(ms).To(Equal(int64(18800)))
		})

		It("handles hours correctly", func() {
			ms, err := parseSRTTime("01:00:00,000")
			Expect(err).ToNot(HaveOccurred())
			Expect(ms).To(Equal(int64(3600000)))
		})

		It("handles non-zero hours, minutes, seconds, and milliseconds", func() {
			ms, err := parseSRTTime("01:02:03,456")
			Expect(err).ToNot(HaveOccurred())
			// (1*3600 + 2*60 + 3)*1000 + 456 = 3723456
			Expect(ms).To(Equal(int64(3723456)))
		})

		It("scales 1-digit milliseconds by 100", func() {
			ms, err := parseSRTTime("00:00:01,5")
			Expect(err).ToNot(HaveOccurred())
			Expect(ms).To(Equal(int64(1500)))
		})

		It("scales 2-digit milliseconds by 10", func() {
			ms, err := parseSRTTime("00:00:01,05")
			Expect(err).ToNot(HaveOccurred())
			Expect(ms).To(Equal(int64(1050)))
		})

		It("does not scale 3-digit milliseconds", func() {
			ms, err := parseSRTTime("00:00:01,005")
			Expect(err).ToNot(HaveOccurred())
			Expect(ms).To(Equal(int64(1005)))
		})

		It("trims surrounding whitespace", func() {
			ms, err := parseSRTTime("  00:00:22,801  ")
			Expect(err).ToNot(HaveOccurred())
			Expect(ms).To(Equal(int64(22801)))
		})

		It("returns error for invalid format", func() {
			_, err := parseSRTTime("not-a-time")
			Expect(err).To(HaveOccurred())
		})

		It("returns error for empty string", func() {
			_, err := parseSRTTime("")
			Expect(err).To(HaveOccurred())
		})
	})

	Describe("splitSRTBlocks", func() {
		It("returns nil for empty input", func() {
			Expect(splitSRTBlocks("")).To(BeNil())
			Expect(splitSRTBlocks("   ")).To(BeNil())
		})

		It("returns a single block for input with no blank lines", func() {
			blocks := splitSRTBlocks("1\n00:00:01,000 --> 00:00:02,000\nHello")
			Expect(blocks).To(HaveLen(1))
		})

		It("splits on double newline", func() {
			input := "1\n00:00:01,000 --> 00:00:02,000\nHello\n\n2\n00:00:03,000 --> 00:00:04,000\nWorld"
			blocks := splitSRTBlocks(input)
			Expect(blocks).To(HaveLen(2))
		})

		It("ignores blank parts between extra blank lines", func() {
			input := "1\n00:00:01,000 --> 00:00:02,000\nHello\n\n\n\n2\n00:00:03,000 --> 00:00:04,000\nWorld"
			blocks := splitSRTBlocks(input)
			Expect(blocks).To(HaveLen(2))
		})

		It("trims leading/trailing whitespace from input before splitting", func() {
			input := "\n\n1\n00:00:01,000 --> 00:00:02,000\nHello\n\n"
			blocks := splitSRTBlocks(input)
			Expect(blocks).To(HaveLen(1))
		})
	})

	Describe("parseSRT", func() {
		It("returns nil for empty input", func() {
			list, err := parseSRT([]byte(""))
			Expect(err).ToNot(HaveOccurred())
			Expect(list).To(BeNil())
		})

		It("returns nil for whitespace-only input", func() {
			list, err := parseSRT([]byte("   \n  \n  "))
			Expect(err).ToNot(HaveOccurred())
			Expect(list).To(BeNil())
		})

		It("parses a single subtitle block with sequence number", func() {
			input := []byte("1\n00:00:18,800 --> 00:00:22,800\nWe're from subtitles\n")
			list, err := parseSRT(input)
			Expect(err).ToNot(HaveOccurred())
			Expect(list).To(HaveLen(1))
			Expect(list[0].Lang).To(Equal("xxx"))
			Expect(list[0].Synced).To(BeTrue())
			Expect(list[0].Line).To(HaveLen(1))
			Expect(list[0].Line[0].Start).To(Equal(gg.P(int64(18800))))
			Expect(list[0].Line[0].End).To(Equal(gg.P(int64(22800))))
			Expect(list[0].Line[0].Value).To(Equal("We're from subtitles"))
		})

		It("parses a block without a sequence number", func() {
			input := []byte("00:00:18,800 --> 00:00:22,800\nNo sequence number\n")
			list, err := parseSRT(input)
			Expect(err).ToNot(HaveOccurred())
			Expect(list).To(HaveLen(1))
			Expect(list[0].Line[0].Value).To(Equal("No sequence number"))
		})

		It("parses multiple blocks in order", func() {
			input := []byte(
				"1\n00:00:18,800 --> 00:00:22,800\nWe're from subtitles\n\n" +
					"2\n00:00:22,801 --> 00:00:26,000\nAnother subtitle line\n",
			)
			list, err := parseSRT(input)
			Expect(err).ToNot(HaveOccurred())
			Expect(list).To(HaveLen(1))
			Expect(list[0].Line).To(HaveLen(2))
			Expect(list[0].Line[0].Start).To(Equal(gg.P(int64(18800))))
			Expect(list[0].Line[0].End).To(Equal(gg.P(int64(22800))))
			Expect(list[0].Line[0].Value).To(Equal("We're from subtitles"))
			Expect(list[0].Line[1].Start).To(Equal(gg.P(int64(22801))))
			Expect(list[0].Line[1].End).To(Equal(gg.P(int64(26000))))
			Expect(list[0].Line[1].Value).To(Equal("Another subtitle line"))
		})

		It("handles CRLF line endings", func() {
			input := []byte("1\r\n00:00:01,000 --> 00:00:02,000\r\nCRLF test\r\n")
			list, err := parseSRT(input)
			Expect(err).ToNot(HaveOccurred())
			Expect(list).To(HaveLen(1))
			Expect(list[0].Line[0].Value).To(Equal("CRLF test"))
		})

		It("handles CR-only line endings", func() {
			input := []byte("1\r00:00:01,000 --> 00:00:02,000\rCR test\r")
			list, err := parseSRT(input)
			Expect(err).ToNot(HaveOccurred())
			Expect(list).To(HaveLen(1))
			Expect(list[0].Line[0].Value).To(Equal("CR test"))
		})

		It("joins multi-line text within a block with newline", func() {
			input := []byte("1\n00:00:01,000 --> 00:00:02,000\nLine one\nLine two\n")
			list, err := parseSRT(input)
			Expect(err).ToNot(HaveOccurred())
			Expect(list[0].Line[0].Value).To(Equal("Line one\nLine two"))
		})

		It("skips blocks with no text content", func() {
			input := []byte("1\n00:00:01,000 --> 00:00:02,000\n\n\n2\n00:00:03,000 --> 00:00:04,000\nActual text\n")
			list, err := parseSRT(input)
			Expect(err).ToNot(HaveOccurred())
			Expect(list[0].Line).To(HaveLen(1))
			Expect(list[0].Line[0].Value).To(Equal("Actual text"))
		})

		It("skips blocks where timing line has no -->'", func() {
			input := []byte("1\nThis is not a timing line\nSome text\n\n2\n00:00:03,000 --> 00:00:04,000\nValid text\n")
			list, err := parseSRT(input)
			Expect(err).ToNot(HaveOccurred())
			Expect(list[0].Line).To(HaveLen(1))
			Expect(list[0].Line[0].Value).To(Equal("Valid text"))
		})

		It("returns error for invalid start time format", func() {
			input := []byte("1\nnotatime --> 00:00:02,000\nText\n")
			_, err := parseSRT(input)
			Expect(err).To(HaveOccurred())
		})

		It("returns error for invalid end time format", func() {
			input := []byte("1\n00:00:01,000 --> badtime\nText\n")
			_, err := parseSRT(input)
			Expect(err).To(HaveOccurred())
		})

		It("uses dot as millisecond separator", func() {
			input := []byte("1\n00:00:01.500 --> 00:00:02.750\nDot separator\n")
			list, err := parseSRT(input)
			Expect(err).ToNot(HaveOccurred())
			Expect(list[0].Line[0].Start).To(Equal(gg.P(int64(1500))))
			Expect(list[0].Line[0].End).To(Equal(gg.P(int64(2750))))
		})

		It("sets lang to 'xxx' and synced to true", func() {
			input := []byte("1\n00:00:01,000 --> 00:00:02,000\nTest\n")
			list, err := parseSRT(input)
			Expect(err).ToNot(HaveOccurred())
			Expect(list[0].Lang).To(Equal("xxx"))
			Expect(list[0].Synced).To(BeTrue())
		})
	})
})