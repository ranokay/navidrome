package model

import (
	"encoding/json"
	"strings"
)

type Cue struct {
	Start     *int64 `structs:"start,omitempty"   json:"start,omitempty"`
	End       *int64 `structs:"end,omitempty"     json:"end,omitempty"`
	Value     string `structs:"value"             json:"value"`
	ByteStart int    `structs:"byteStart"         json:"byteStart"`
	ByteEnd   int    `structs:"byteEnd"           json:"byteEnd"`
	AgentID   string `structs:"agentId,omitempty" json:"agentId,omitempty"`
	Precision string `structs:"precision,omitempty" json:"precision,omitempty"`
}

type Agent struct {
	ID   string `structs:"id"             json:"id"`
	Role string `structs:"role"           json:"role"`
	Name string `structs:"name,omitempty" json:"name,omitempty"`
}

type Line struct {
	Start        *int64 `structs:"start,omitempty"        json:"start,omitempty"`
	End          *int64 `structs:"end,omitempty"          json:"end,omitempty"`
	Value        string `structs:"value"                  json:"value"`
	Cue          []Cue  `structs:"cue,omitempty"          json:"cue,omitempty"`
	Instrumental bool   `structs:"instrumental,omitempty" json:"instrumental,omitempty"`
}

type Lyrics struct {
	DisplayArtist string  `structs:"displayArtist,omitempty" json:"displayArtist,omitempty"`
	DisplayTitle  string  `structs:"displayTitle,omitempty"  json:"displayTitle,omitempty"`
	Kind          string  `structs:"kind,omitempty"          json:"kind,omitempty"`
	Format        string  `structs:"format,omitempty"        json:"format,omitempty"`
	Lang          string  `structs:"lang"                    json:"lang"`
	Agents        []Agent `structs:"agents,omitempty"       json:"agents,omitempty"`
	Line          []Line  `structs:"line"                    json:"line"`
	Offset        *int64  `structs:"offset,omitempty"        json:"offset,omitempty"`
	Synced        bool    `structs:"synced"                  json:"synced"`
}

// Lyric kinds, as defined by the OpenSubsonic songLyrics v2 contract. These are
// the canonical wire values; keep them in sync with the spec.
const (
	LyricKindMain          = "main"
	LyricKindTranslation   = "translation"
	LyricKindPronunciation = "pronunciation"
)

// Lyric formats describe the source syntax parsed during scanning. They are
// persisted with the internal lyrics model so the web UI can select honest
// rendering behavior without reparsing the source text.
const (
	LyricFormatPlain      = "plain"
	LyricFormatLRC        = "lrc"
	LyricFormatELRC       = "elrc"
	LyricFormatSRT        = "srt"
	LyricFormatTTML       = "ttml"
	LyricFormatLyricsfile = "lyricsfile"
)

// Cue precision identifies what a cue actually times. Generic TTML spans and
// ELRC fragments stay segments unless their source explicitly says more.
const (
	LyricPrecisionWord      = "word"
	LyricPrecisionSyllable  = "syllable"
	LyricPrecisionSegment   = "segment"
	LyricPrecisionCharacter = "character"
)

func (l Lyrics) IsEmpty() bool {
	return len(l.Line) == 0
}

// IsMainKind reports whether the lyric is the main track. A blank kind is an
// untyped (single-track) lyric, which the contract treats as main.
func (l Lyrics) IsMainKind() bool {
	return l.EffectiveKind() == LyricKindMain
}

// EffectiveKind returns the lyric kind, defaulting to LyricKindMain when blank.
// A blank kind means an untyped (single-track) lyric, which the contract treats
// as main.
func (l Lyrics) EffectiveKind() string {
	if strings.TrimSpace(l.Kind) == "" {
		return LyricKindMain
	}
	return l.Kind
}

type LyricList []Lyrics

// MarshalJSON keeps the lyrics column invariant: empty/nil serializes to [], never null.
func (ll LyricList) MarshalJSON() ([]byte, error) {
	if len(ll) == 0 {
		return []byte("[]"), nil
	}
	return json.Marshal([]Lyrics(ll))
}

// Main returns the main-kind lyric, falling back to the first entry so untyped
// lyrics still resolve. The bool is false only when the list is empty. It is
// used to surface a single lyric through the plain-text legacy getLyrics
// endpoint, which has no notion of translation/pronunciation tracks.
func (ll LyricList) Main() (Lyrics, bool) {
	if len(ll) == 0 {
		return Lyrics{}, false
	}
	for _, l := range ll {
		if l.IsMainKind() {
			return l, true
		}
	}
	return ll[0], true
}
