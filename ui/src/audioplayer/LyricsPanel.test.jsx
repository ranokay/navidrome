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
    expect(detailed.map((node) => node.textContent)).toEqual([
      'line 2',
      'line 3',
      'line 4',
      'line 5',
      'line 6',
    ])
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

  it('pauses auto-scroll during manual input and resumes from the active line', () => {
    vi.useFakeTimers()
    const originalScrollTo = HTMLElement.prototype.scrollTo
    const scrollTo = vi.fn()
    HTMLElement.prototype.scrollTo = scrollTo
    const lyricLayers = layers([
      { start: 0, end: 1000, value: 'one' },
      { start: 1000, end: 2000, value: 'two' },
    ])
    const player = audio()
    renderPanel({ mainLyric: lyricLayers.main, audioInstance: player })
    const initialCalls = scrollTo.mock.calls.length

    fireEvent.wheel(screen.getByTestId('lyrics-scroll-body'))
    player.currentTime = 1.5
    act(() => {
      player.dispatchEvent(new Event('seeked'))
    })
    expect(scrollTo).toHaveBeenCalledTimes(initialCalls)

    act(() => {
      vi.advanceTimersByTime(KARAOKE_MANUAL_SCROLL_PAUSE_MS)
    })
    expect(scrollTo.mock.calls.length).toBeGreaterThan(initialCalls)
    HTMLElement.prototype.scrollTo = originalScrollTo
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
              value: 'main',
              cue: [
                { start: 0, end: 1000, value: 'main ' },
                { start: 500, end: 1500, value: 'echo', agentId: 'bg' },
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
})
