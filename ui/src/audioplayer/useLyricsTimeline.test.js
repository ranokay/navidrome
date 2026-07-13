import { act, renderHook } from '@testing-library/react-hooks'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { normalizeSongLyrics } from './lyrics'
import useLyricsTimeline from './useLyricsTimeline'

const lyricDocument = () =>
  normalizeSongLyrics({
    id: Math.random().toString(),
    duration: 10,
    lyrics: JSON.stringify([
      {
        synced: true,
        line: [
          {
            start: 0,
            end: 5000,
            value: 'one',
            cue: [{ start: 0, end: 5000, value: 'one' }],
          },
          { start: 5000, end: 10000, value: 'two' },
        ],
      },
    ]),
  }).main

const makeAudio = () => {
  const audio = new EventTarget()
  audio.currentTime = 1
  audio.paused = true
  return audio
}

describe('useLyricsTimeline', () => {
  let callbacks
  let nextId
  let visibility

  beforeEach(() => {
    callbacks = new Map()
    nextId = 0
    visibility = 'visible'
    vi.stubGlobal('requestAnimationFrame', (callback) => {
      const id = ++nextId
      callbacks.set(id, callback)
      return id
    })
    vi.stubGlobal('cancelAnimationFrame', (id) => callbacks.delete(id))
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => visibility,
    })
  })

  afterEach(() => vi.unstubAllGlobals())

  const runFrame = (now) => {
    const [id, callback] = callbacks.entries().next().value || []
    if (!callback) return false
    callbacks.delete(id)
    callback(now)
    return true
  }

  it('updates DOM progress without React commits on stable frames', () => {
    const audio = makeAudio()
    const lyric = lyricDocument()
    const { result } = renderHook(() =>
      useLyricsTimeline({
        document: lyric,
        audioInstance: audio,
        visible: true,
        reducedMotion: false,
      }),
    )
    const node = window.document.createElement('div')
    act(() => {
      result.current.registerLine(0, node)
      result.current.syncNow(1000, true)
    })
    const rendersBeforeFrames = result.all.length
    audio.paused = false
    act(() => {
      audio.dispatchEvent(new Event('play'))
    })
    act(() => {
      audio.currentTime = 1.1
      runFrame(16)
      audio.currentTime = 1.2
      runFrame(32)
    })

    expect(result.all).toHaveLength(rendersBeforeFrames)
    expect(node.style.getPropertyValue('--lyrics-progress')).toBe('0.24')
  })

  it('stops within the same turn on pause, hide, close, and unmount', () => {
    const audio = makeAudio()
    const documentOne = lyricDocument()
    const { rerender, unmount } = renderHook(
      ({ visible, document }) =>
        useLyricsTimeline({
          document,
          audioInstance: audio,
          visible,
          reducedMotion: false,
        }),
      { initialProps: { visible: true, document: documentOne } },
    )
    audio.paused = false
    act(() => {
      audio.dispatchEvent(new Event('play'))
    })
    expect(callbacks.size).toBe(1)

    audio.paused = true
    act(() => {
      audio.dispatchEvent(new Event('pause'))
    })
    expect(callbacks.size).toBe(0)

    audio.paused = false
    act(() => {
      audio.dispatchEvent(new Event('play'))
    })
    visibility = 'hidden'
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(callbacks.size).toBe(0)

    visibility = 'visible'
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(callbacks.size).toBe(1)
    rerender({ visible: false, document: documentOne })
    expect(callbacks.size).toBe(0)

    rerender({ visible: true, document: lyricDocument() })
    expect(callbacks.size).toBe(1)
    unmount()
    expect(callbacks.size).toBe(0)
  })
})
