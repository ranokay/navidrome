import { describe, expect, it } from 'vitest'
import { normalizeSongLyrics } from './lyrics'
import {
  LyricQualityMonitor,
  LyricTimelineCursor,
  graphemeLiftAt,
  tokenLiftAt,
  waveTimingFor,
} from './lyricsTimeline'

const documentFor = (lines) =>
  normalizeSongLyrics({
    id: Math.random().toString(),
    duration: 200,
    lyrics: JSON.stringify([{ synced: true, line: lines }]),
  }).main

describe('LyricTimelineCursor', () => {
  it('retains its event index forward and binary-reconstructs backward seeks', () => {
    const document = documentFor([
      { start: 0, end: 2000, value: 'one' },
      { start: 1000, end: 3000, value: 'overlap' },
      { start: 4000, end: 5000, value: 'after gap' },
    ])
    const cursor = new LyricTimelineCursor(document)

    expect(cursor.update(1500).indexes).toEqual([0, 1])
    const operations = cursor.operations
    const indexes = cursor.lastIndexes
    const stableResult = cursor.update(1600)
    expect(stableResult.indexes).toBe(indexes)
    expect(stableResult.indexes).toEqual([0, 1])
    expect(cursor.operations).toBe(operations)
    expect(cursor.update(4500).indexes).toEqual([2])
    expect(cursor.update(500, true).indexes).toEqual([0])
  })

  it('bounds seek reconstruction to fewer than one checkpoint stride', () => {
    const lines = Array.from({ length: 1000 }, (_, index) => ({
      start: index * 100,
      end: index * 100 + 50,
      value: String(index),
    }))
    const cursor = new LyricTimelineCursor(documentFor(lines))
    cursor.update(75678, true)
    expect(cursor.seekOperations).toBeLessThan(64)
  })

  it('handles repeated timestamps deterministically', () => {
    const cursor = new LyricTimelineCursor(
      documentFor([
        { start: 0, end: 1000, value: 'first' },
        { start: 1000, end: 2000, value: 'second' },
      ]),
    )
    expect(cursor.update(1000).indexes).toEqual([1])
  })
})

describe('adaptive lyric quality', () => {
  it('degrades after sustained slow frames and recovers conservatively', () => {
    const monitor = new LyricQualityMonitor(false)
    for (let index = 0; index < 60; index += 1) monitor.record(16)
    for (let index = 0; index < 120; index += 1) monitor.record(30)
    expect(monitor.level).toBe('reduced')
    for (let index = 0; index < 120; index += 1) monitor.record(30)
    expect(monitor.level).toBe('minimal')
    for (let index = 0; index < 600; index += 1) monitor.record(16)
    expect(monitor.level).toBe('reduced')
    for (let index = 0; index < 600; index += 1) monitor.record(16)
    expect(monitor.level).toBe('full')
  })

  it('uses a dedicated reduced-motion level', () => {
    expect(new LyricQualityMonitor(true).record(100)).toBe('reduced-motion')
  })

  it('bounds visual waves and disables them for long segments', () => {
    const cue = {
      start: 0,
      end: 1000,
      graphemes: Array.from({ length: 20 }, (_, index) => ({
        value: String(index),
        visible: true,
      })),
    }
    const wave = waveTimingFor(cue)
    expect(wave.stagger).toBeGreaterThanOrEqual(12)
    expect(wave.stagger).toBeLessThanOrEqual(45)
    expect(wave.stagger * 19).toBeLessThanOrEqual(350)
    expect(wave.crestDuration).toBe(240)
    expect(wave.offsetWindow + wave.crestDuration).toBeLessThanOrEqual(1000)
    expect(
      waveTimingFor({
        ...cue,
        graphemes: Array.from({ length: 41 }, () => ({ visible: true })),
      }),
    ).toBeNull()
  })

  it('uses only positive lifts and settles every grapheme by the cue end', () => {
    const cue = {
      start: 100,
      end: 1100,
      graphemes: Array.from({ length: 20 }, () => ({ visible: true })),
    }
    for (let time = 0; time <= 1200; time += 5) {
      expect(tokenLiftAt(cue, time)).toBeGreaterThanOrEqual(0)
      expect(tokenLiftAt(cue, time)).toBeLessThanOrEqual(1)
      for (let index = 0; index < 20; index += 1) {
        expect(graphemeLiftAt(cue, index, time)).toBeGreaterThanOrEqual(0)
        expect(graphemeLiftAt(cue, index, time)).toBeLessThanOrEqual(1)
      }
    }
    expect(graphemeLiftAt(cue, 19, cue.end)).toBe(0)
  })
})
