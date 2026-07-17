import { ThemeProvider, createTheme } from '@material-ui/core/styles'
import { act, fireEvent, render, screen } from '@testing-library/react'
import React from 'react'
import { describe, expect, it, vi } from 'vitest'
import { normalizeSongLyrics } from './lyrics'
import LyricsPanel from './LyricsPanel'
import { KARAOKE_MANUAL_SCROLL_PAUSE_MS } from './lyricsKaraokeConstants'

const theme = createTheme({ palette: { primary: { main: '#35aa66' } } })
const audio = () => {
  const target = new EventTarget()
  target.currentTime = 0
  target.paused = true
  return target
}
const layers = (lines, synced = true) =>
  normalizeSongLyrics({
    id: Math.random().toString(),
    duration: 30,
    lyrics: JSON.stringify([{ synced, line: lines }]),
  })
const renderPanel = (props) =>
  render(
    <ThemeProvider theme={theme}>
      <LyricsPanel visible {...props} />
    </ThemeProvider>,
  )

describe('<LyricsPanel />', () => {
  it('renders untimed lyrics as static selectable text', () => {
    const lyricLayers = layers(
      [{ value: 'First' }, { value: '' }, { value: 'Second' }],
      false,
    )
    renderPanel({ mainLyric: lyricLayers.main })
    expect(screen.getAllByTestId('lyrics-line-group')).toHaveLength(3)
    expect(screen.queryByRole('button')).toBeNull()
  })

  it('mounts detailed markup only for active lines and two neighbors', () => {
    const lyricLayers = layers(
      Array.from({ length: 10 }, (_, index) => ({
        start: index * 1000,
        end: index * 1000 + 1000,
        value: `line ${index}`,
        cue: [
          {
            start: index * 1000,
            end: index * 1000 + 1000,
            value: `line ${index}`,
            byteStart: 0,
            byteEnd: `line ${index}`.length - 1,
          },
        ],
      })),
    )
    const player = audio()
    player.currentTime = 4.5
    renderPanel({ mainLyric: lyricLayers.main, audioInstance: player })

    const detailed = screen
      .getAllByTestId('lyrics-line-group')
      .filter((node) => node.dataset.detailed === 'true')
    expect(detailed).toHaveLength(5)
    expect(
      detailed.map(
        (node) =>
          node.querySelector('[data-testid="lyrics-base-text"]').textContent,
      ),
    ).toEqual(['line 2', 'line 3', 'line 4', 'line 5', 'line 6'])
  })

  it('performs one synchronous paused seek update and supports keyboard seeking', () => {
    const lyricLayers = layers([
      { start: 0, end: 1000, value: 'one' },
      { start: 1000, end: 2000, value: 'two' },
    ])
    const player = audio()
    renderPanel({ mainLyric: lyricLayers.main, audioInstance: player })
    player.currentTime = 1.5
    act(() => {
      player.dispatchEvent(new Event('seeked'))
    })
    expect(screen.getAllByTestId('lyrics-line-group')[1]).toHaveAttribute(
      'data-active',
      'true',
    )

    fireEvent.keyDown(screen.getAllByRole('button')[0], { key: 'Enter' })
    expect(player.currentTime).toBe(0)
  })

  it('positions direct lyric seeks immediately even during manual-scroll pause', () => {
    const lyricLayers = layers([
      { start: 0, end: 1000, value: 'one' },
      { start: 1000, end: 2000, value: 'two' },
    ])
    const player = audio()
    renderPanel({ mainLyric: lyricLayers.main, audioInstance: player })
    const body = screen.getByTestId('lyrics-scroll-body')
    const target = screen.getAllByRole('button')[1]
    Object.defineProperties(body, {
      clientHeight: { configurable: true, value: 100 },
      scrollHeight: { configurable: true, value: 1000 },
    })
    Object.defineProperties(target, {
      offsetHeight: { configurable: true, value: 40 },
      offsetTop: { configurable: true, value: 400 },
    })
    fireEvent.wheel(body)
    fireEvent.click(target)
    expect(player.currentTime).toBe(1)
    expect(body.scrollTop).toBe(382)
  })

  it('pauses auto-scroll during manual input and resumes from the active line', () => {
    vi.useFakeTimers()
    const lyricLayers = layers([
      { start: 0, end: 1000, value: 'one' },
      { start: 1000, end: 2000, value: 'two' },
    ])
    const player = audio()
    renderPanel({ mainLyric: lyricLayers.main, audioInstance: player })
    const body = screen.getByTestId('lyrics-scroll-body')
    const groups = screen.getAllByTestId('lyrics-line-group')
    Object.defineProperties(body, {
      clientHeight: { configurable: true, value: 100 },
      scrollHeight: { configurable: true, value: 1000 },
    })
    Object.defineProperties(groups[1], {
      offsetHeight: { configurable: true, value: 40 },
      offsetTop: { configurable: true, value: 400 },
    })

    fireEvent.wheel(body)
    player.currentTime = 1.5
    act(() => {
      player.dispatchEvent(new Event('seeked'))
    })
    expect(body.scrollTop).toBe(0)

    act(() => {
      vi.advanceTimersByTime(KARAOKE_MANUAL_SCROLL_PAUSE_MS + 300)
    })
    expect(body.scrollTop).toBeGreaterThan(0)
    vi.useRealTimers()
  })

  it('does not pause on a plain pointer press but pauses after a real touch drag', () => {
    vi.useFakeTimers()
    const lyricLayers = layers([
      { start: 0, end: 1000, value: 'one' },
      { start: 1000, end: 2000, value: 'two' },
      { start: 2000, end: 3000, value: 'three' },
    ])
    const player = audio()
    renderPanel({ mainLyric: lyricLayers.main, audioInstance: player })
    const body = screen.getByTestId('lyrics-scroll-body')
    const groups = screen.getAllByTestId('lyrics-line-group')
    Object.defineProperties(body, {
      clientHeight: { configurable: true, value: 100 },
      scrollHeight: { configurable: true, value: 1000 },
      getBoundingClientRect: {
        configurable: true,
        value: () => ({ left: 0, right: 300 }),
      },
    })
    Object.defineProperties(groups[1], {
      offsetHeight: { configurable: true, value: 40 },
      offsetTop: { configurable: true, value: 400 },
    })
    Object.defineProperties(groups[2], {
      offsetHeight: { configurable: true, value: 40 },
      offsetTop: { configurable: true, value: 700 },
    })

    fireEvent.pointerDown(body, { pointerType: 'mouse', clientX: 40 })
    player.currentTime = 1.5
    act(() => {
      player.dispatchEvent(new Event('seeked'))
    })
    act(() => {
      vi.advanceTimersByTime(300)
    })
    expect(body.scrollTop).toBe(382)

    body.scrollTop = 0
    fireEvent.touchStart(body, { touches: [{ clientY: 100 }] })
    fireEvent.touchMove(body, { touches: [{ clientY: 96 }] })
    player.currentTime = 2.5
    act(() => {
      player.dispatchEvent(new Event('seeked'))
    })
    act(() => {
      vi.advanceTimersByTime(300)
    })
    expect(body.scrollTop).toBe(682)

    body.scrollTop = 0
    fireEvent.touchStart(body, { touches: [{ clientY: 100 }] })
    fireEvent.touchMove(body, { touches: [{ clientY: 80 }] })
    player.currentTime = 1.5
    act(() => {
      player.dispatchEvent(new Event('seeked'))
    })
    act(() => {
      vi.advanceTimersByTime(300)
    })
    expect(body.scrollTop).toBe(0)

    act(() => {
      vi.advanceTimersByTime(KARAOKE_MANUAL_SCROLL_PAUSE_MS + 300)
    })
    expect(body.scrollTop).toBeGreaterThan(0)
    vi.useRealTimers()
  })

  it('renders overlapping voice lanes and matching auxiliary text', () => {
    const main = normalizeSongLyrics({
      id: 'lanes',
      duration: 10,
      lyrics: JSON.stringify([
        {
          kind: 'main',
          synced: true,
          agents: [{ id: 'bg', role: 'background' }],
          line: [
            {
              start: 0,
              end: 2000,
              value: 'main echo',
              cue: [
                {
                  start: 0,
                  end: 1000,
                  value: 'main',
                  byteStart: 0,
                  byteEnd: 3,
                },
                {
                  start: 500,
                  end: 1500,
                  value: 'echo',
                  byteStart: 5,
                  byteEnd: 8,
                  agentId: 'bg',
                },
              ],
            },
          ],
        },
        {
          kind: 'translation',
          synced: true,
          line: [{ start: 0, end: 2000, value: 'translation' }],
        },
      ]),
    })
    const player = audio()
    player.currentTime = 0.5
    renderPanel({
      mainLyric: main.main,
      translationLyric: main.translation,
      showTranslation: true,
      audioInstance: player,
    })
    expect(screen.getByText('translation')).toBeInTheDocument()
    expect(document.querySelector('.lyrics-lane-background')).toHaveTextContent(
      'echo',
    )
  })

  it('keeps one stable raw base node while detailed overlays activate', () => {
    const lyricLayers = layers([
      {
        start: 0,
        end: 1000,
        value: 'Hello, world!',
        cue: [
          {
            start: 0,
            end: 450,
            value: 'Hello',
            byteStart: 0,
            byteEnd: 4,
          },
          {
            start: 500,
            end: 900,
            value: 'world',
            byteStart: 7,
            byteEnd: 11,
          },
        ],
      },
      { start: 1000, end: 2000, value: 'two' },
      { start: 2000, end: 3000, value: 'three' },
      { start: 3000, end: 4000, value: 'four' },
    ])
    const player = audio()
    player.currentTime = 0.25
    renderPanel({ mainLyric: lyricLayers.main, audioInstance: player })
    const group = screen.getAllByTestId('lyrics-line-group')[0]
    const base = group.querySelector('[data-testid="lyrics-base-text"]')
    expect(base).toHaveTextContent('Hello, world!')
    expect(group.querySelector('.lyrics-presentation')).toHaveTextContent(
      'Hello, world!',
    )

    player.currentTime = 3.5
    act(() => {
      player.dispatchEvent(new Event('seeked'))
    })
    expect(group.querySelector('[data-testid="lyrics-base-text"]')).toBe(base)
    expect(base).toHaveTextContent('Hello, world!')
    expect(group).toHaveAttribute('data-active', 'false')
  })

  it('remounts keyed line state and resets scroll for a new document', () => {
    const player = audio()
    const first = layers([{ start: 0, end: 1000, value: 'first track' }])
    const view = renderPanel({ mainLyric: first.main, audioInstance: player })
    const body = screen.getByTestId('lyrics-scroll-body')
    const firstGroup = screen.getByTestId('lyrics-line-group')
    body.scrollTop = 300

    const second = layers([{ start: 0, end: 1000, value: 'second track' }])
    view.rerender(
      <ThemeProvider theme={theme}>
        <LyricsPanel visible audioInstance={player} mainLyric={second.main} />
      </ThemeProvider>,
    )
    expect(screen.getByTestId('lyrics-scroll-body').scrollTop).toBe(0)
    expect(screen.getByTestId('lyrics-line-group')).not.toBe(firstGroup)
    expect(screen.getByTestId('lyrics-base-text')).toHaveTextContent(
      'second track',
    )
  })

  it('renders matched pronunciation tokens and ambiguous line fallback', () => {
    const matched = normalizeSongLyrics({
      id: 'pronunciation-matched',
      duration: 3,
      lyrics: JSON.stringify([
        {
          kind: 'main',
          format: 'ttml',
          synced: true,
          line: [
            {
              start: 0,
              end: 2000,
              value: '안녕 세상',
              cue: [
                {
                  start: 0,
                  end: 900,
                  value: '안녕',
                  byteStart: 0,
                  byteEnd: 5,
                },
                {
                  start: 1000,
                  end: 1900,
                  value: '세상',
                  byteStart: 7,
                  byteEnd: 12,
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
              end: 2000,
              value: 'annyeong sesang',
              cue: [
                { start: 0, end: 900, value: 'annyeong' },
                { start: 1000, end: 1900, value: 'sesang' },
              ],
            },
          ],
        },
      ]),
    })
    const player = audio()
    player.currentTime = 0.5
    const view = renderPanel({
      mainLyric: matched.main,
      pronunciationLyric: matched.pronunciation,
      pronunciationTokens: matched.pronunciationTokensByMain,
      showPronunciation: true,
      audioInstance: player,
    })
    expect(
      Array.from(document.querySelectorAll('.lyrics-pronunciation-token')).map(
        (node) => node.textContent,
      ),
    ).toEqual(['annyeong', 'sesang'])

    const fallback = normalizeSongLyrics({
      id: 'pronunciation-fallback',
      duration: 3,
      lyrics: JSON.stringify([
        {
          kind: 'main',
          format: 'ttml',
          synced: true,
          line: [
            {
              start: 0,
              end: 2000,
              value: 'a b',
              cue: [
                {
                  start: 0,
                  end: 1000,
                  value: 'a',
                  byteStart: 0,
                  byteEnd: 0,
                },
                {
                  start: 0,
                  end: 1000,
                  value: 'b',
                  byteStart: 2,
                  byteEnd: 2,
                },
              ],
            },
          ],
        },
        {
          kind: 'pronunciation',
          synced: true,
          line: [
            {
              start: 0,
              end: 2000,
              value: 'ambiguous',
              cue: [{ start: 0, end: 1000, value: 'ambiguous' }],
            },
          ],
        },
      ]),
    })
    view.rerender(
      <ThemeProvider theme={theme}>
        <LyricsPanel
          visible
          audioInstance={player}
          mainLyric={fallback.main}
          pronunciationLyric={fallback.pronunciation}
          pronunciationTokens={fallback.pronunciationTokensByMain}
          showPronunciation
        />
      </ThemeProvider>,
    )
    expect(
      document.querySelector('.lyrics-pronunciation-fallback'),
    ).toHaveTextContent('ambiguous')
    expect(document.querySelector('.lyrics-pronunciation-token')).toBeNull()
  })
})
