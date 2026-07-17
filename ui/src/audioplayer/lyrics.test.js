import { describe, expect, it } from 'vitest'
import {
  LYRIC_SCHEMA_VERSION,
  buildPronunciationTokenIndex,
  clearLyricsCache,
  findLayerLineForMain,
  getLyricsCacheSize,
  normalizeSongLyrics,
  utf8ByteRangeToCodeUnitRange,
} from './lyrics'

const song = (lyrics, overrides = {}) => ({
  id: 'track-1',
  updatedAt: '2026-07-13T00:00:00Z',
  duration: 30,
  lyrics: JSON.stringify(lyrics),
  ...overrides,
})

describe('normalizeSongLyrics', () => {
  it('preserves untimed paragraph spacing and freezes the result', () => {
    const layers = normalizeSongLyrics(
      song([
        {
          format: 'plain',
          lang: 'en',
          synced: false,
          line: [
            { value: 'First paragraph' },
            { value: '' },
            { value: 'Second paragraph' },
          ],
        },
      ]),
      'en',
    )

    expect(layers.main.lines.map((line) => line.value)).toEqual([
      'First paragraph',
      '',
      'Second paragraph',
    ])
    expect(layers.main.timed).toBe(false)
    expect(Object.isFrozen(layers.main.lines)).toBe(true)
  })

  it('uses explicit, cue, next-line, then duration-bounded fallback ends', () => {
    const { main } = normalizeSongLyrics(
      song(
        [
          {
            format: 'ttml',
            synced: true,
            line: [
              { start: 0, end: 500, value: 'Explicit' },
              {
                start: 1000,
                value: 'Cue',
                cue: [{ start: 1000, end: 1800, value: 'Cue' }],
              },
              { start: 2000, value: 'Next' },
              { start: 4000, value: 'Final' },
            ],
          },
        ],
        { duration: 9 },
      ),
    )

    expect(main.lines.map((line) => [line.end, line.endProvenance])).toEqual([
      [500, 'explicit'],
      [1800, 'cue'],
      [4000, 'next-line'],
      [9000, 'fallback-cap'],
    ])
  })

  it('maps honest precision without guessing syllables', () => {
    const lyrics = [
      {
        kind: 'main',
        format: 'elrc',
        synced: true,
        line: [
          {
            start: 0,
            end: 1000,
            value: 'hello',
            cue: [
              {
                start: 0,
                end: 1000,
                value: 'hello',
                byteStart: 0,
                byteEnd: 4,
              },
            ],
          },
        ],
      },
      {
        kind: 'translation',
        format: 'lyricsfile',
        synced: true,
        line: [
          {
            start: 0,
            end: 1000,
            value: 'hola',
            cue: [
              {
                start: 0,
                end: 1000,
                value: 'hola',
                byteStart: 0,
                byteEnd: 3,
              },
            ],
          },
        ],
      },
      {
        kind: 'pronunciation',
        format: 'ttml',
        synced: true,
        line: [
          {
            start: 0,
            end: 1000,
            value: 'ab',
            cue: [
              {
                start: 0,
                end: 500,
                value: 'a',
                byteStart: 0,
                byteEnd: 0,
                precision: 'character',
              },
              {
                start: 500,
                end: 1000,
                value: 'b',
                byteStart: 1,
                byteEnd: 1,
                precision: 'character',
              },
            ],
          },
        ],
      },
    ]
    const layers = normalizeSongLyrics(song(lyrics), 'en')

    expect(layers.main.lines[0].precision).toBe('segment')
    expect(layers.translation.lines[0].precision).toBe('word')
    expect(layers.pronunciation.lines[0].precision).toBe('character')
    expect(layers.main.lines[0].cues[0].precision).not.toBe('syllable')
  })

  it('keeps instrumental blanks, offsets, repeated starts, and overlapping lines', () => {
    const { main } = normalizeSongLyrics(
      song([
        {
          format: 'lrc',
          offset: 250,
          synced: true,
          line: [
            { start: 0, instrumental: true, value: '' },
            { start: 1000, end: 3000, value: 'Lead' },
            { start: 1000, end: 2500, value: 'Background' },
          ],
        },
      ]),
    )

    expect(main.lines[0]).toMatchObject({ start: 250, instrumental: true })
    expect(
      main.timeline.events.filter(
        (event) => event.time === 1250 && event.type === 'start',
      ),
    ).toHaveLength(2)
  })

  it('retains voice lanes and matches auxiliary overlap', () => {
    const lyrics = [
      {
        kind: 'main',
        synced: true,
        agents: [
          { id: 'lead', role: 'main' },
          { id: 'bg', role: 'background' },
        ],
        line: [
          {
            start: 0,
            end: 2000,
            value: 'Duet',
            cue: [
              { start: 0, end: 1000, value: 'Du', agentId: 'lead' },
              { start: 500, end: 1500, value: 'et', agentId: 'bg' },
            ],
          },
        ],
      },
      {
        kind: 'translation',
        synced: true,
        line: [{ start: 300, end: 1700, value: 'Dúo' }],
      },
    ]
    const layers = normalizeSongLyrics(song(lyrics))

    expect(layers.main.lines[0].lanes.map((lane) => lane.role)).toEqual([
      'main',
      'background',
    ])
    expect(
      findLayerLineForMain(layers.main, layers.translation, 0)?.value,
    ).toBe('Dúo')
  })

  it('uses raw JSON equality and evicts cache entries beyond 75', () => {
    clearLyricsCache()
    const raw = [{ synced: false, line: [{ value: 'same' }] }]
    const first = normalizeSongLyrics(song(raw))
    expect(normalizeSongLyrics(song(raw))).toBe(first)
    for (let index = 0; index < 80; index += 1) {
      normalizeSongLyrics(song(raw, { id: `track-${index}` }))
    }
    expect(getLyricsCacheSize()).toBe(75)
  })

  it('keeps Unicode grapheme clusters and UTF-8 byte ranges intact', () => {
    const { main } = normalizeSongLyrics(
      song([
        {
          format: 'ttml',
          synced: true,
          line: [
            {
              start: 0,
              end: 1000,
              value: '👩‍👩‍👧‍👦 café',
              cue: [
                { start: 0, end: 500, value: '👩‍👩‍👧‍👦' },
                { start: 500, end: 1000, value: ' café' },
              ],
            },
          ],
        },
      ]),
    )
    expect(
      main.lines[0].cues[0].graphemes.filter((part) => part.visible),
    ).toHaveLength(1)
    expect(utf8ByteRangeToCodeUnitRange('aé🙂z', 1, 2)?.text).toBe('é')
  })

  it('preserves source gaps, punctuation, and Unicode outside cue ranges', () => {
    const value = '지금 e\u0301🙂, go!'
    const { main } = normalizeSongLyrics(
      song([
        {
          format: 'ttml',
          synced: true,
          line: [
            {
              start: 0,
              end: 1000,
              value,
              cue: [
                {
                  start: 0,
                  end: 400,
                  value: '지금',
                  byteStart: 0,
                  byteEnd: 5,
                },
                {
                  start: 400,
                  end: 700,
                  value: 'e\u0301🙂',
                  byteStart: 7,
                  byteEnd: 13,
                },
                {
                  start: 700,
                  end: 1000,
                  value: 'go',
                  byteStart: 16,
                  byteEnd: 17,
                },
              ],
            },
          ],
        },
      ]),
    )

    expect(main.schemaVersion).toBe(LYRIC_SCHEMA_VERSION)
    expect(main.schemaVersion).toBe(3)
    expect(main.lines[0].displaySegments.map((part) => part.value)).toEqual([
      '지금',
      ' ',
      'e\u0301🙂',
      ', ',
      'go',
      '!',
    ])
    expect(
      main.lines[0].displaySegments.map((part) => part.value).join(''),
    ).toBe(value)
  })

  it('downgrades malformed cue ranges without changing visible text', () => {
    const { main } = normalizeSongLyrics(
      song([
        {
          format: 'ttml',
          synced: true,
          line: [
            {
              start: 0,
              end: 1000,
              value: 'keep every space',
              cue: [
                {
                  start: 0,
                  end: 1000,
                  value: 'wrong',
                  byteStart: 0,
                  byteEnd: 4,
                },
              ],
            },
          ],
        },
      ]),
    )

    expect(main.lines[0]).toMatchObject({
      precision: 'line',
      hasValidCueRanges: false,
    })
    expect(main.lines[0].displaySegments).toEqual([
      { id: 'text-0', kind: 'text', value: 'keep every space' },
    ])
  })

  it('changes document identity when raw lyrics or locale changes', () => {
    clearLyricsCache()
    const original = normalizeSongLyrics(song([{ line: [{ value: 'one' }] }]))
    const changed = normalizeSongLyrics(song([{ line: [{ value: 'two' }] }]))
    const locale = normalizeSongLyrics(
      song([{ line: [{ value: 'one' }] }]),
      'ko',
    )

    expect(original.main.identity).not.toBe(changed.main.identity)
    expect(original.main.identity).not.toBe(locale.main.identity)
  })

  it('matches timed pronunciation cues to main cues and falls back safely', () => {
    const layers = normalizeSongLyrics(
      song([
        {
          kind: 'main',
          format: 'ttml',
          synced: true,
          line: [
            {
              start: 0,
              end: 1000,
              value: '지금 가',
              cue: [
                {
                  start: 0,
                  end: 500,
                  value: '지금',
                  byteStart: 0,
                  byteEnd: 5,
                },
                {
                  start: 500,
                  end: 1000,
                  value: '가',
                  byteStart: 7,
                  byteEnd: 9,
                },
              ],
            },
          ],
        },
        {
          kind: 'pronunciation',
          format: 'ttml',
          synced: true,
          line: [
            {
              start: 0,
              end: 1000,
              value: 'ji geum ga',
              cue: [
                { start: 0, end: 250, value: 'ji ' },
                { start: 250, end: 500, value: 'geum' },
                { start: 500, end: 1000, value: 'ga' },
              ],
            },
          ],
        },
      ]),
    )

    expect(layers.pronunciationTokensByMain[0]).toMatchObject({
      mode: 'tokens',
      tokens: [
        { mainCueIndex: 0, value: 'ji geum' },
        { mainCueIndex: 1, value: 'ga' },
      ],
    })

    const unmatchedLine = {
      ...layers.pronunciation.lines[0],
      cues: [{ start: 1500, end: 1600, value: 'unmatched' }],
    }
    const fallback = buildPronunciationTokenIndex(
      layers.main,
      { ...layers.pronunciation, lines: [unmatchedLine] },
      [unmatchedLine],
    )
    expect(fallback[0].mode).toBe('line')
  })
})
