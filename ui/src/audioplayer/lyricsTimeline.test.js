import { describe, expect, it } from 'vitest'
import {
  buildLyricsTimeline,
  getTimelineScrollTarget,
  LyricTimelineCursor,
  resolveKaraokeTokenWindows,
  tokenProgressAt,
} from './lyricsTimeline'
import { KARAOKE_SCROLL_PRE_ROLL_MS } from './lyricsKaraokeConstants'

describe('lyricsTimeline', () => {
  it('supports overlapping active lines and backward seeks', () => {
    const timeline = buildLyricsTimeline([
      { start: 1000, end: 3000, tokens: [] },
      { start: 2000, end: 4000, tokens: [] },
    ])
    const cursor = new LyricTimelineCursor(timeline)

    expect(cursor.update(1500, true).indexes).toEqual([0])
    expect(cursor.update(2500).indexes).toEqual([0, 1])
    expect(cursor.update(3500).indexes).toEqual([1])
    expect(cursor.update(1500).indexes).toEqual([0])
  })

  it('excludes zero and negative duration intervals', () => {
    const timeline = buildLyricsTimeline([
      { start: 1000, end: 1000, tokens: [] },
      { start: 2000, end: 1500, tokens: [] },
      { start: 3000, end: 4000, tokens: [] },
    ])

    expect(timeline.events).toEqual([
      { time: 3000, type: 'start', lineIndex: 2 },
      { time: 4000, type: 'end', lineIndex: 2 },
    ])
  })

  it('uses the next timed line across untimed display rows', () => {
    const timeline = buildLyricsTimeline([
      { start: 1000, tokens: [] },
      { value: 'untimed annotation', tokens: [] },
      { start: 5000, end: 6000, tokens: [] },
    ])

    expect(timeline.windows[0].end).toBe(5000)
    expect(timeline.windows[0].nextTimedStart).toBe(5000)
    expect(timeline.windows[1].valid).toBe(false)
  })

  it('ends line-timed lyrics before the next timestamp when no end exists', () => {
    const timeline = buildLyricsTimeline([
      {
        start: 1000,
        value: 'A short lyric line',
        timingMode: 'line',
        tokens: [],
      },
      { start: 5000, end: 6000, timingMode: 'line', tokens: [] },
    ])
    const cursor = new LyricTimelineCursor(timeline)

    expect(timeline.windows[0].end).toBeGreaterThan(1000)
    expect(timeline.windows[0].end).toBeLessThan(5000)
    expect(cursor.update(1500, true).indexes).toEqual([0])
    expect(cursor.update(timeline.windows[0].end + 1).indexes).toEqual([])
  })

  it('caps a final open line with track duration', () => {
    const timeline = buildLyricsTimeline([{ start: 7000, tokens: [] }], {
      durationMs: 10000,
    })

    expect(timeline.windows[0]).toMatchObject({
      start: 7000,
      end: 10000,
      valid: true,
    })
  })

  it('moves the scroll target at pre-roll without changing active state', () => {
    const timeline = buildLyricsTimeline([
      { start: 1000, end: 1500, tokens: [] },
      { start: 3000, end: 3500, tokens: [] },
    ])

    expect(getTimelineScrollTarget(timeline, 0)).toBe(-1)
    expect(
      getTimelineScrollTarget(timeline, 3000 - KARAOKE_SCROLL_PRE_ROLL_MS),
    ).toBe(1)
  })

  it('precomputes token windows once and keeps progress deterministic', () => {
    const line = {
      start: 1000,
      end: 3000,
      tokens: [
        { start: 1000, value: 'one' },
        { start: 2000, end: 3000, value: 'two' },
      ],
    }
    const windows = resolveKaraokeTokenWindows(line)

    expect(windows).toEqual([
      { start: 1000, end: 2000, sourceStart: 1000, sourceEnd: 2000 },
      { start: 2000, end: 3000, sourceStart: 2000, sourceEnd: 3000 },
    ])
    expect(tokenProgressAt(windows[0], 1500)).toBe(0.5)
    expect(tokenProgressAt(windows[0], 2500)).toBe(1)
  })
})
