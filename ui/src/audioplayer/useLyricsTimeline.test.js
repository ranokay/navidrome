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
            cue: [
              {
                start: 0,
                end: 5000,
                value: 'one',
                byteStart: 0,
                byteEnd: 2,
              },
            ],
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

  it('clears stale cue presentation on forward and backward seeks', () => {
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
    const lineNode = window.document.createElement('div')
    const cueNode = window.document.createElement('span')
    cueNode.className = 'lyrics-cue'
    act(() => {
      result.current.registerLine(0, lineNode)
      result.current.registerCue(0, 0, cueNode)
      result.current.syncNow(2500, true)
    })
    expect(cueNode.dataset.lyricsState).toBe('active')
    expect(cueNode.style.getPropertyValue('--lyrics-progress')).toBe('0.5')

    act(() => {
      result.current.syncNow(6000, true)
    })
    expect(cueNode.dataset.lyricsState).toBe('inactive-past')
    expect(cueNode.dataset.lifting).toBe('false')
    expect(cueNode.style.getPropertyValue('--lyrics-progress')).toBe('0')
    expect(cueNode.style.getPropertyValue('--lyrics-token-lift')).toBe('0')

    act(() => {
      result.current.syncNow(1000, true)
    })
    expect(cueNode.dataset.lyricsState).toBe('active')
    expect(cueNode.style.getPropertyValue('--lyrics-progress')).toBe('0.2')

    act(() => {
      result.current.syncNow(100, true)
    })
    expect(cueNode.dataset.lifting).toBe('true')
  })

  it('updates overlapping cues independently without completing either early', () => {
    const audio = makeAudio()
    const lyric = normalizeSongLyrics({
      id: 'overlapping-cues',
      duration: 3,
      lyrics: JSON.stringify([
        {
          synced: true,
          line: [
            {
              start: 0,
              end: 2000,
              value: 'one two',
              cue: [
                {
                  start: 0,
                  end: 1000,
                  value: 'one',
                  byteStart: 0,
                  byteEnd: 2,
                },
                {
                  start: 500,
                  end: 1500,
                  value: 'two',
                  byteStart: 4,
                  byteEnd: 6,
                },
              ],
            },
          ],
        },
      ]),
    }).main
    const { result } = renderHook(() =>
      useLyricsTimeline({
        document: lyric,
        audioInstance: audio,
        visible: true,
        reducedMotion: false,
      }),
    )
    const lineNode = window.document.createElement('div')
    const first = window.document.createElement('span')
    const second = window.document.createElement('span')
    first.className = 'lyrics-cue'
    second.className = 'lyrics-cue'
    act(() => {
      result.current.registerLine(0, lineNode)
      result.current.registerCue(0, 0, first)
      result.current.registerCue(0, 1, second)
      result.current.syncNow(750, true)
    })
    expect(first.style.getPropertyValue('--lyrics-progress')).toBe('0.75')
    expect(second.style.getPropertyValue('--lyrics-progress')).toBe('0.25')

    act(() => {
      result.current.syncNow(1100)
    })
    expect(first.style.getPropertyValue('--lyrics-progress')).toBe('1')
    expect(second.style.getPropertyValue('--lyrics-progress')).toBe('0.6')
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
