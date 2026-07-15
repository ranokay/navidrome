import { act } from '@testing-library/react'
import { renderHook } from '@testing-library/react-hooks'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  KARAOKE_CHARACTER_LIFT_PX,
  KARAOKE_CHARACTER_PHASE_SPREAD,
  KARAOKE_CHARACTER_WAVE_DURATION_MS,
} from './lyricsKaraokeConstants'
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

  it('keeps the same gradient paint when an active word completes', () => {
    const audio = createAudio({ currentTime: 0.25, paused: true })
    const { result } = renderHook(() =>
      useLyricsTimeline({
        lines,
        audioInstance: audio,
        visible: true,
        reducedMotion: false,
      }),
    )
    const tokenNode = document.createElement('span')
    Array.from('first').forEach((character) => {
      const node = document.createElement('span')
      node.dataset.lyricsCharacter = 'true'
      node.textContent = character
      tokenNode.appendChild(node)
    })

    act(() => {
      result.current.registerToken(
        '0:stable-completion',
        {
          lineIndex: 0,
          window: { start: 0, end: 500 },
          presentation,
        },
        tokenNode,
      )
    })

    const activeBackground = tokenNode.style.backgroundImage
    expect(tokenNode.dataset.lyricsState).toBe('active')
    expect(tokenNode.style.color).toBe('transparent')

    act(() => result.current.syncNow(600, true))

    expect(tokenNode.dataset.lyricsState).toBe('completed')
    expect(tokenNode.style.backgroundImage).toBe(activeBackground)
    expect(tokenNode.style.color).toBe('transparent')
    expect(tokenNode.style.webkitTextFillColor).toBe('transparent')
    tokenNode
      .querySelectorAll('[data-lyrics-character="true"]')
      .forEach((character) =>
        expect(character.style.transform).toBe('translateY(-1.5000px)'),
      )
  })

  it('keeps gradient paint and opacity continuous when release becomes past', () => {
    const audio = createAudio({ currentTime: 0.25, paused: true })
    const { result } = renderHook(() =>
      useLyricsTimeline({
        lines,
        audioInstance: audio,
        visible: true,
        reducedMotion: false,
      }),
    )
    const tokenNode = document.createElement('span')
    Array.from('first').forEach((character) => {
      const node = document.createElement('span')
      node.dataset.lyricsCharacter = 'true'
      node.textContent = character
      tokenNode.appendChild(node)
    })

    act(() => {
      result.current.registerToken(
        '0:no-release-blink',
        {
          lineIndex: 0,
          window: { start: 0, end: 500 },
          presentation,
        },
        tokenNode,
      )
    })

    act(() => result.current.syncNow(1219, true))
    const gradient = tokenNode.style.backgroundImage
    const releaseAlpha = Number(
      tokenNode.style.getPropertyValue('--lyrics-token-active-alpha'),
    )
    expect(tokenNode.dataset.lyricsState).toBe('release')
    expect(tokenNode.style.color).toBe('transparent')
    expect(tokenNode.style.opacity).toBe('1')

    act(() => result.current.syncNow(1220, true))

    const pastAlpha = Number(
      tokenNode.style.getPropertyValue('--lyrics-token-active-alpha'),
    )
    expect(tokenNode.dataset.lyricsState).toBe('inactive-past')
    expect(tokenNode.style.backgroundImage).toBe(gradient)
    expect(tokenNode.style.color).toBe('transparent')
    expect(tokenNode.style.webkitTextFillColor).toBe('transparent')
    expect(tokenNode.style.opacity).toBe('1')
    expect(Math.abs(pastAlpha - releaseAlpha)).toBeLessThan(0.01)
    expect(pastAlpha).toBeCloseTo(presentation.futureAlpha, 5)
    expect(tokenNode.style.getPropertyValue('--lyrics-progress')).toBe('1')
  })

  it('starts every character at rest and only moves it upward', () => {
    const audio = createAudio({ currentTime: 0.879, duration: 5, paused: true })
    const delayedLines = [
      {
        start: 0,
        end: 4000,
        tokens: [{ start: 1000, end: 4000, value: 'super' }],
      },
    ]
    const { result } = renderHook(() =>
      useLyricsTimeline({
        lines: delayedLines,
        audioInstance: audio,
        visible: true,
        reducedMotion: false,
      }),
    )
    const tokenNode = document.createElement('span')
    Array.from('super').forEach((character) => {
      const node = document.createElement('span')
      node.dataset.lyricsCharacter = 'true'
      node.textContent = character
      tokenNode.appendChild(node)
    })

    act(() => {
      result.current.registerToken(
        '0:one-way-rise',
        {
          lineIndex: 0,
          window: { start: 1000, end: 4000 },
          presentation,
        },
        tokenNode,
      )
    })

    const characters = Array.from(
      tokenNode.querySelectorAll('[data-lyrics-character="true"]'),
    )
    characters.forEach((character) =>
      expect(character.style.transform).toBe(''),
    )

    act(() => result.current.syncNow(900, true))

    expect(characters[0].style.transform).toMatch(
      /^translateY\(-\d+\.\d{4}px\)$/,
    )
    characters
      .slice(1)
      .forEach((character) => expect(character.style.transform).toBe(''))
    characters.forEach((character) => {
      const offset = Number.parseFloat(
        character.style.transform.match(/-?\d+\.\d+/)?.[0] || '0',
      )
      expect(offset).toBeLessThanOrEqual(0)
    })
  })

  it('uses a bounded concurrent phase wave for long token durations', () => {
    const audio = createAudio({ currentTime: 0, duration: 5, paused: true })
    const longLines = [
      {
        start: 0,
        end: 4000,
        tokens: [{ start: 0, end: 4000, value: 'super' }],
      },
    ]
    const { result } = renderHook(() =>
      useLyricsTimeline({
        lines: longLines,
        audioInstance: audio,
        visible: true,
        reducedMotion: false,
      }),
    )
    const tokenNode = document.createElement('span')
    Array.from('super').forEach((character) => {
      const node = document.createElement('span')
      node.dataset.lyricsCharacter = 'true'
      node.textContent = character
      tokenNode.appendChild(node)
    })

    act(() => {
      result.current.registerToken(
        '0:long-word',
        {
          lineIndex: 0,
          window: { start: 0, end: 4000 },
          presentation,
        },
        tokenNode,
      )
    })

    const characters = Array.from(
      tokenNode.querySelectorAll('[data-lyrics-character="true"]'),
    )
    const firstTransforms = []
    ;[0, 16, 32, 48].forEach((time) => {
      act(() => result.current.syncNow(time, true))
      firstTransforms.push(characters[0].style.transform)
    })

    expect(new Set(firstTransforms).size).toBe(firstTransforms.length)
    firstTransforms.forEach((transform) =>
      expect(transform).toMatch(/^translateY\(-\d+\.\d{4}px\)$/),
    )

    act(() => result.current.syncNow(120, true))
    const offsets = characters.map((character) =>
      Math.abs(
        Number.parseFloat(
          character.style.transform.match(/-?\d+\.\d+/)?.[0] || '0',
        ),
      ),
    )
    expect(offsets.filter((offset) => offset > 0)).toHaveLength(5)
    expect(offsets[0]).toBeGreaterThan(offsets[1])
    expect(offsets[1]).toBeGreaterThan(offsets[2])
    expect(offsets[2]).toBeGreaterThan(offsets[3])
    expect(offsets[3]).toBeGreaterThan(offsets[4])

    act(() => result.current.syncNow(KARAOKE_CHARACTER_WAVE_DURATION_MS, true))
    characters.forEach((character) =>
      expect(character.style.transform).toBe(
        `translateY(-${KARAOKE_CHARACTER_LIFT_PX.toFixed(4)}px)`,
      ),
    )
    expect(KARAOKE_CHARACTER_PHASE_SPREAD).toBeGreaterThan(0)
    expect(KARAOKE_CHARACTER_PHASE_SPREAD).toBeLessThan(0.5)
  })

  it('keeps interpolated playback time monotonic between coarse media updates', () => {
    let frameCallback = null
    let now = 0
    window.requestAnimationFrame.mockImplementation((callback) => {
      frameCallback = callback
      return 1
    })
    vi.spyOn(performance, 'now').mockImplementation(() => now)

    const audio = createAudio({ currentTime: 0.2, paused: false })
    const { result } = renderHook(() =>
      useLyricsTimeline({
        lines,
        audioInstance: audio,
        visible: true,
        reducedMotion: false,
      }),
    )
    const tokenNode = document.createElement('span')
    act(() => {
      result.current.registerToken(
        '0:monotonic',
        {
          lineIndex: 0,
          window: { start: 0, end: 1000 },
          presentation,
        },
        tokenNode,
      )
    })

    now = 100
    act(() => frameCallback())
    const firstProgress = Number(
      tokenNode.style.getPropertyValue('--lyrics-progress'),
    )
    now = 180
    act(() => frameCallback())
    const secondProgress = Number(
      tokenNode.style.getPropertyValue('--lyrics-progress'),
    )

    expect(secondProgress).toBeGreaterThanOrEqual(firstProgress)
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
