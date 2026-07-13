import { act } from '@testing-library/react'
import { renderHook } from '@testing-library/react-hooks'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import useLyricsTimeline from './useLyricsTimeline'

const createAudio = ({
  currentTime = 0,
  duration = 10,
  paused = true,
  playbackRate = 1,
} = {}) => {
  const target = new EventTarget()
  target.currentTime = currentTime
  target.duration = duration
  target.paused = paused
  target.playbackRate = playbackRate
  target.seeking = false
  return target
}

const lines = [
  {
    start: 0,
    end: 1000,
    tokens: [
      { start: 0, end: 500, value: 'first' },
      { start: 500, end: 1000, value: 'second' },
    ],
  },
  { start: 1000, end: 2000, tokens: [] },
]

const presentation = {
  rgb: [255, 255, 255],
  futureAlpha: 0.34,
  activeAlpha: 1,
  futureColor: 'rgba(255, 255, 255, 0.34)',
  doneColor: 'rgba(255, 255, 255, 1)',
  gradient: 'linear-gradient(90deg, white, transparent)',
  useCrossfade: false,
}

describe('useLyricsTimeline', () => {
  beforeEach(() => {
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 1)
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('synchronizes paused media without starting an animation loop', () => {
    const audio = createAudio({ currentTime: 0.25, paused: true })
    const { result } = renderHook(() =>
      useLyricsTimeline({
        lines,
        audioInstance: audio,
        visible: true,
        reducedMotion: false,
      }),
    )
    const lineNode = document.createElement('div')
    const tokenNode = document.createElement('span')

    act(() => {
      result.current.registerLine(0, lineNode)
      result.current.registerToken(
        '0:main:0',
        {
          lineIndex: 0,
          window: { start: 0, end: 500 },
          presentation,
        },
        tokenNode,
      )
    })

    expect(result.current.activeIndexes).toEqual([0])
    expect(lineNode.dataset.active).toBe('true')
    expect(tokenNode.dataset.lyricsState).toBe('active')
    expect(
      Number(tokenNode.style.getPropertyValue('--lyrics-progress')),
    ).toBeCloseTo(0.74, 2)
    expect(window.requestAnimationFrame).not.toHaveBeenCalled()
  })

  it('recomputes token state immediately after seeking backward', () => {
    const audio = createAudio({ currentTime: 0.75, paused: true })
    const { result } = renderHook(() =>
      useLyricsTimeline({
        lines,
        audioInstance: audio,
        visible: true,
        reducedMotion: true,
      }),
    )
    const first = document.createElement('span')
    const second = document.createElement('span')

    act(() => {
      result.current.registerToken(
        '0:first',
        {
          lineIndex: 0,
          window: { start: 0, end: 500 },
          presentation,
        },
        first,
      )
      result.current.registerToken(
        '0:second',
        {
          lineIndex: 0,
          window: { start: 500, end: 1000 },
          presentation,
        },
        second,
      )
    })

    expect(first.dataset.lyricsState).toBe('completed')
    expect(second.dataset.lyricsState).toBe('active')

    act(() => {
      audio.currentTime = 0.1
      audio.dispatchEvent(new Event('seeking'))
    })

    expect(first.dataset.lyricsState).toBe('active')
    expect(second.dataset.lyricsState).toBe('future')
  })

  it('tracks overlapping line intervals as an active set', () => {
    const audio = createAudio({ currentTime: 2.5, paused: true })
    const overlappingLines = [
      { start: 1000, end: 4000, tokens: [] },
      { start: 2000, end: 3000, tokens: [] },
      { start: 5000, end: 6000, tokens: [] },
    ]
    const { result } = renderHook(() =>
      useLyricsTimeline({
        lines: overlappingLines,
        audioInstance: audio,
        visible: true,
        reducedMotion: false,
      }),
    )

    expect(result.current.activeIndexes).toEqual([0, 1])
    expect(result.current.primaryIndex).toBe(1)
  })

  it('starts and stops requestAnimationFrame with playback visibility', () => {
    const audio = createAudio({ currentTime: 0.25, paused: true })
    renderHook(() =>
      useLyricsTimeline({
        lines,
        audioInstance: audio,
        visible: true,
        reducedMotion: false,
      }),
    )

    expect(window.requestAnimationFrame).not.toHaveBeenCalled()

    act(() => {
      audio.paused = false
      audio.dispatchEvent(new Event('play'))
    })
    expect(window.requestAnimationFrame).toHaveBeenCalledTimes(1)

    act(() => {
      audio.paused = true
      audio.dispatchEvent(new Event('pause'))
    })
    expect(window.cancelAnimationFrame).toHaveBeenCalled()
  })
})
