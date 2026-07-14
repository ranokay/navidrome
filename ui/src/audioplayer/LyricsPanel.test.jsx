import React from 'react'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { ThemeProvider, createTheme } from '@material-ui/core/styles'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import LyricsPanel from './LyricsPanel'
import {
  KARAOKE_DESKTOP_ACTIVE_LINE_ANCHOR_RATIO,
  KARAOKE_LINE_ENTER_MS,
  KARAOKE_LINE_LIFT_PX,
  KARAOKE_LINE_MOTION_RELEASE_MS,
  KARAOKE_MANUAL_SCROLL_PAUSE_MS,
} from './lyricsKaraokeConstants'
import { buildSegmentsFromLine } from './lyricsSegments'

const theme = createTheme({
  palette: {
    primary: { main: '#2266aa' },
    text: { primary: '#111111', secondary: '#778899' },
  },
})

const renderPanel = (props) =>
  render(
    <ThemeProvider theme={theme}>
      <LyricsPanel visible {...props} />
    </ThemeProvider>,
  )

const mainLyric = {
  synced: true,
  line: [{ start: 0, end: 1000, value: 'Main line' }],
}

const tokenizedMainLyric = {
  synced: true,
  line: [{ start: 0, end: 1000, value: 'Main line' }],
  cueLine: [
    {
      index: 0,
      start: 0,
      end: 1000,
      value: 'Main line',
      cue: [
        { start: 0, end: 500, value: 'Main', byteStart: 0, byteEnd: 3 },
        { start: 500, end: 1000, value: 'line', byteStart: 5, byteEnd: 8 },
      ],
    },
  ],
}

const tokenizedPronunciationLyric = {
  synced: true,
  line: [{ start: 0, end: 1000, value: 'mein lain' }],
  cueLine: [
    {
      index: 0,
      start: 0,
      end: 1000,
      value: 'mein lain',
      cue: [
        { start: 0, end: 500, value: 'mein', byteStart: 0, byteEnd: 3 },
        { start: 500, end: 1000, value: 'lain', byteStart: 5, byteEnd: 8 },
      ],
    },
  ],
}

const multiAgentLyric = {
  synced: true,
  agents: [
    { id: 'lead', role: 'main' },
    { id: 'all', role: 'group' },
    { id: 'echo', role: 'bg' },
  ],
  line: [{ start: 1000, end: 4000, value: 'Lead all echo' }],
  cueLine: [
    {
      index: 0,
      start: 1000,
      end: 2000,
      value: 'Lead',
      agentId: 'lead',
      cue: [{ start: 1000, end: 2000, value: 'Lead' }],
    },
    {
      index: 0,
      start: 1500,
      end: 2600,
      value: 'all',
      agentId: 'all',
      cue: [{ start: 1500, end: 2600, value: 'all' }],
    },
    {
      index: 0,
      start: 2200,
      end: 3400,
      value: 'echo',
      agentId: 'echo',
      cue: [{ start: 2200, end: 3400, value: 'echo' }],
    },
  ],
}

describe('<LyricsPanel />', () => {
  const originalMatchMedia = window.matchMedia

  beforeEach(() => {
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(() => 0)
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    window.matchMedia = originalMatchMedia
  })

  it('does not render timed blank rows as empty lyric groups', () => {
    renderPanel({
      mainLyric: {
        synced: true,
        line: [
          { start: 0, value: 'Before pause' },
          { start: 1000, value: '' },
          { start: 2000, value: 'After pause' },
        ],
      },
      audioInstance: { currentTime: 1.5, paused: true },
    })

    expect(screen.getAllByTestId('lyrics-line-group')).toHaveLength(2)
    expect(screen.getByText('Before pause')).toBeInTheDocument()
    expect(screen.getByText('After pause')).toBeInTheDocument()
  })

  it('renders main, stacked pronunciation, and translation in layer order', () => {
    renderPanel({
      mainLyric: tokenizedMainLyric,
      pronunciationLyric: tokenizedPronunciationLyric,
      translationLyric: {
        synced: true,
        line: [{ start: 0, end: 1000, value: 'translation line' }],
      },
      showPronunciation: true,
      showTranslation: true,
    })

    const pronunciation = screen.getAllByTestId('lyrics-pronunciation-token')
    expect(pronunciation).toHaveLength(2)
    expect(pronunciation[0]).toHaveTextContent('mein')
    expect(pronunciation[1]).toHaveTextContent('lain')
    expect(screen.getByText('translation line')).toBeInTheDocument()
  })

  it('renders each translation line under only its closest main line', () => {
    renderPanel({
      mainLyric: {
        synced: true,
        line: [
          { start: 0, end: 1000, value: 'First main line' },
          { start: 1000, end: 2000, value: 'Closest main line' },
          { start: 2000, end: 3000, value: 'Later main line' },
        ],
      },
      translationLyric: {
        synced: true,
        line: [{ start: 1100, end: 2800, value: 'One translated line' }],
      },
      showTranslation: true,
    })

    const translations = screen.getAllByText('One translated line')
    expect(translations).toHaveLength(1)
    expect(
      translations[0].closest('[data-testid="lyrics-line-group"]'),
    ).toHaveTextContent('Closest main line')
  })

  it('renders line-level pronunciation without inventing word timing', () => {
    renderPanel({
      mainLyric: {
        synced: true,
        line: [{ start: 0, end: 1000, value: '我总要给一些别的' }],
      },
      pronunciationLyric: {
        synced: true,
        line: [{ start: 0, end: 1000, value: 'wo zong yao gei yi xie bie de' }],
      },
      showPronunciation: true,
      audioInstance: { currentTime: 0.2, paused: true },
    })

    expect(screen.getByText('我总要给一些别的')).toBeInTheDocument()
    const pronunciation = screen.getByText('wo zong yao gei yi xie bie de')
    const group = pronunciation.closest('[data-testid="lyrics-line-group"]')
    expect(group).toHaveAttribute('data-active', 'true')
    expect(
      group.style.getPropertyValue('--lyrics-pronunciation-active-color'),
    ).not.toBe('')
    expect(pronunciation.style.color).toBe('')
  })

  it('uses one shared opacity animation for every static line layer', () => {
    renderPanel({
      mainLyric,
      pronunciationLyric: {
        synced: true,
        line: [{ start: 0, end: 1000, value: 'main pronunciation' }],
      },
      translationLyric: {
        synced: true,
        line: [{ start: 0, end: 1000, value: 'translated line' }],
      },
      showPronunciation: true,
      showTranslation: true,
      audioInstance: { currentTime: 0.5, paused: true },
    })

    const mainRow = screen.getByText('Main line').closest('[data-tokenized]')
    const translationRow = screen
      .getByText('translated line')
      .closest('[data-tokenized]')
    const pronunciation = screen.getByText('main pronunciation')

    expect(mainRow).toHaveAttribute('data-layer-animation', 'shared-opacity')
    expect(translationRow).toHaveAttribute(
      'data-layer-animation',
      'shared-opacity',
    )
    expect(pronunciation).toHaveAttribute('data-timed', 'false')
    expect(mainRow).toHaveAttribute('data-tokenized', 'false')
    expect(translationRow).toHaveAttribute('data-tokenized', 'false')
    expect(mainRow.style.opacity).toBe('')
    expect(translationRow.style.opacity).toBe('')
  })

  it('keeps timed translations on the main line lifecycle', () => {
    const translationLyric = {
      synced: true,
      line: [{ start: 0, end: 1000, value: 'Translated phrase' }],
      cueLine: [
        {
          index: 0,
          start: 0,
          end: 700,
          value: 'Translated phrase',
          cue: [
            {
              start: 0,
              end: 150,
              value: 'Translated',
              byteStart: 0,
              byteEnd: 9,
            },
            {
              start: 150,
              end: 700,
              value: 'phrase',
              byteStart: 11,
              byteEnd: 16,
            },
          ],
        },
      ],
    }

    renderPanel({
      mainLyric: tokenizedMainLyric,
      pronunciationLyric: tokenizedPronunciationLyric,
      translationLyric,
      showPronunciation: true,
      showTranslation: true,
      audioInstance: { currentTime: 0.25, paused: true },
    })

    const group = screen.getByTestId('lyrics-line-group')
    const translation = screen.getByText('Translated phrase')
    expect(group).toHaveAttribute('data-active', 'true')
    expect(translation).not.toHaveAttribute('data-lyrics-state')
    expect(translation).toHaveAttribute(
      'data-layer-animation',
      'shared-opacity',
    )
    expect(translation.style.backgroundImage).toBe('')
    expect(
      group.style.getPropertyValue('--lyrics-translation-active-color'),
    ).not.toBe('')
  })

  it('uses a subtle fluid lift and a slower settled return', () => {
    const { rerender } = renderPanel({
      mainLyric,
      audioInstance: { currentTime: 0.5, paused: true },
    })

    const group = screen.getByTestId('lyrics-line-group')
    const activeStyle = window.getComputedStyle(group)
    expect(group).toHaveAttribute('data-highlight-active', 'true')
    expect(activeStyle.transform).toBe(`translateY(-${KARAOKE_LINE_LIFT_PX}px)`)
    expect(activeStyle.transitionDuration).toBe(`${KARAOKE_LINE_ENTER_MS}ms`)

    rerender(
      <ThemeProvider theme={theme}>
        <LyricsPanel
          visible
          mainLyric={mainLyric}
          audioInstance={{ currentTime: 1.1, paused: true }}
        />
      </ThemeProvider>,
    )

    const releasedStyle = window.getComputedStyle(group)
    expect(group).toHaveAttribute('data-highlight-active', 'false')
    expect(releasedStyle.transform).toBe('translateY(0)')
    expect(releasedStyle.transitionDuration).toBe(
      `${KARAOKE_LINE_MOTION_RELEASE_MS}ms`,
    )
  })

  it('uses the same active and release lifecycle for all line-level layers', () => {
    const lyric = {
      synced: true,
      line: [{ start: 0, end: 1000, value: 'Main line' }],
    }
    const pronunciationLyric = {
      synced: true,
      line: [{ start: 0, end: 1000, value: 'main pronunciation' }],
    }
    const translationLyric = {
      synced: true,
      line: [{ start: 0, end: 1000, value: 'translated line' }],
    }
    const { rerender } = renderPanel({
      mainLyric: lyric,
      pronunciationLyric,
      translationLyric,
      showPronunciation: true,
      showTranslation: true,
      audioInstance: { currentTime: 0.5, paused: true },
    })

    const group = screen.getByTestId('lyrics-line-group')
    const pronunciation = screen.getByText('main pronunciation')
    const translation = screen.getByText('translated line')
    expect(group).toHaveAttribute('data-active', 'true')
    expect(group).toHaveAttribute('data-highlight-active', 'true')
    expect(group.style.getPropertyValue('--lyrics-main-active-color')).not.toBe(
      '',
    )
    expect(
      group.style.getPropertyValue('--lyrics-pronunciation-active-color'),
    ).not.toBe('')
    expect(
      group.style.getPropertyValue('--lyrics-translation-active-color'),
    ).not.toBe('')
    expect(pronunciation.style.color).toBe('')
    expect(translation.style.color).toBe('')

    rerender(
      <ThemeProvider theme={theme}>
        <LyricsPanel
          visible
          mainLyric={lyric}
          pronunciationLyric={pronunciationLyric}
          translationLyric={translationLyric}
          showPronunciation
          showTranslation
          audioInstance={{ currentTime: 1.1, paused: true }}
        />
      </ThemeProvider>,
    )

    expect(group).toHaveAttribute('data-active', 'false')
    expect(group).toHaveAttribute('data-lifecycle', 'release')
    expect(group).toHaveAttribute('data-highlight-active', 'false')
  })

  it('keeps timed pronunciation on the stable gradient path', () => {
    renderPanel({
      mainLyric: tokenizedMainLyric,
      pronunciationLyric: tokenizedPronunciationLyric,
      showPronunciation: true,
      audioInstance: { currentTime: 0.25, paused: true },
    })

    const pronunciation = screen.getAllByTestId('lyrics-pronunciation-token')[0]
    expect(pronunciation).toHaveAttribute('data-lyrics-state', 'active')
    expect(pronunciation.style.backgroundImage).toContain('linear-gradient')
    expect(pronunciation.style.color).toBe('transparent')
    expect(pronunciation).toHaveAttribute('data-timed', 'true')
    expect(pronunciation.style.transition).toBe('')
  })

  it('renders unsynced lyrics as static selectable text', () => {
    renderPanel({
      mainLyric: {
        synced: false,
        line: [{ value: 'first plain line' }, { value: 'second plain line' }],
      },
    })

    const groups = screen.getAllByTestId('lyrics-line-group')
    expect(groups).toHaveLength(2)
    groups.forEach((group) => {
      expect(group).toHaveAttribute('data-active', 'false')
      expect(group).not.toHaveAttribute('aria-current')
      expect(group).toHaveAttribute('data-scroll-target', 'false')
    })
  })

  it('preserves explicit line breaks and exact cue gaps', () => {
    renderPanel({
      mainLyric: {
        synced: true,
        line: [{ start: 0, end: 1000, value: 'first line\nsecond line' }],
      },
    })
    expect(screen.getByText(/first line/).textContent).toBe(
      'first line\nsecond line',
    )

    const segments = buildSegmentsFromLine({
      value: 'café café',
      tokens: [
        { value: 'café', byteStart: 0, byteEnd: 4 },
        { value: 'café', byteStart: 6, byteEnd: 10 },
      ],
    })
    expect(segments.map((segment) => segment.text).join('')).toBe('café café')
    expect(segments[1]).toEqual(
      expect.objectContaining({ text: ' ', tokenIndex: -1 }),
    )
  })

  it('updates cue progress imperatively while future cues remain paint-free', () => {
    renderPanel({
      mainLyric: tokenizedMainLyric,
      audioInstance: { currentTime: 0.25, paused: true },
    })

    const first = screen.getByText('Main')
    const second = screen.getByText('line')
    expect(first).toHaveAttribute('data-lyrics-state', 'active')
    expect(first.style.backgroundImage).toContain('linear-gradient')
    expect(
      Number(first.style.getPropertyValue('--lyrics-progress')),
    ).toBeGreaterThan(0.5)
    expect(second).toHaveAttribute('data-lyrics-state', 'future')
    expect(second.style.backgroundImage).toBe('none')
  })

  it('uses a soft gradient wipe for short fast cues', () => {
    renderPanel({
      mainLyric: {
        synced: true,
        line: [{ start: 0, end: 180, value: 'go' }],
        cueLine: [
          {
            index: 0,
            start: 0,
            end: 180,
            value: 'go',
            cue: [{ start: 0, end: 180, value: 'go' }],
          },
        ],
      },
      audioInstance: { currentTime: 0.02, paused: true },
    })

    const token = screen.getByTestId('lyrics-token')
    expect(token).toHaveAttribute('data-lyrics-state', 'active')
    expect(token.style.backgroundImage).toContain('linear-gradient')
    expect(token.style.color).toBe('transparent')
    expect(token.style.transition).toBe('')
  })

  it('starts unhighlighting as soon as a line ends then clears stale state', () => {
    const { rerender } = renderPanel({
      mainLyric: tokenizedMainLyric,
      audioInstance: { currentTime: 1.1, paused: true },
    })

    const group = screen.getByTestId('lyrics-line-group')
    const token = screen.getByText('Main')
    expect(group).toHaveAttribute('data-active', 'false')
    expect(group).toHaveAttribute('data-lifecycle', 'release')
    expect(group).toHaveAttribute('data-highlight-active', 'false')
    expect(token).toHaveAttribute('data-lyrics-state', 'release')
    expect(token.style.backgroundImage).toBe('none')
    expect(Number(token.style.opacity)).toBeLessThan(1)
    expect(Number(token.style.opacity)).toBeGreaterThan(0.3)

    rerender(
      <ThemeProvider theme={theme}>
        <LyricsPanel
          visible
          mainLyric={tokenizedMainLyric}
          audioInstance={{ currentTime: 1.25, paused: true }}
        />
      </ThemeProvider>,
    )

    expect(group).toHaveAttribute('data-lifecycle', 'idle')
    expect(group).toHaveAttribute('data-highlight-active', 'false')
    expect(token).toHaveAttribute('data-lyrics-state', 'inactive-past')
    expect(token.style.opacity).toBe('1')
  })

  it('tracks overlapping lines while selecting one primary line', () => {
    renderPanel({
      mainLyric: {
        synced: true,
        line: [
          { start: 1000, end: 4000, value: 'Lead vocal' },
          { start: 2000, end: 3000, value: 'Answer vocal' },
          { start: 5000, end: 6000, value: 'Later vocal' },
        ],
      },
      audioInstance: { currentTime: 2.5, paused: true },
    })

    const groups = screen.getAllByTestId('lyrics-line-group')
    expect(groups[0]).toHaveAttribute('data-active', 'true')
    expect(groups[1]).toHaveAttribute('data-active', 'true')
    expect(groups[2]).toHaveAttribute('data-active', 'false')
    expect(groups[0]).not.toHaveAttribute('aria-current')
    expect(groups[1]).toHaveAttribute('aria-current', 'true')
    expect(groups[1]).toHaveAttribute('data-scroll-target', 'true')
  })

  it('keeps multi-agent cue lines in separate voice lanes', () => {
    renderPanel({
      mainLyric: multiAgentLyric,
      audioInstance: { currentTime: 2.5, paused: true },
    })

    const lanes = screen.getAllByTestId('lyrics-voice-lane')
    expect(lanes).toHaveLength(3)
    expect(lanes[0]).toHaveTextContent('Lead')
    expect(lanes[1]).toHaveTextContent('all')
    expect(lanes[1].style.fontStyle).toBe('italic')
    expect(lanes[2]).toHaveTextContent('echo')
    expect(lanes[2].style.fontStyle).toBe('italic')
  })

  it('seeks and synchronizes immediately when a line is activated', () => {
    const audioInstance = { currentTime: 0 }
    renderPanel({
      mainLyric: {
        synced: true,
        line: [{ start: 2300, end: 3200, value: 'Seek line' }],
      },
      audioInstance,
    })

    const group = screen
      .getByText('Seek line')
      .closest('[data-testid="lyrics-line-group"]')
    fireEvent.click(group)
    expect(audioInstance.currentTime).toBe(2.3)
    expect(group).toHaveAttribute('data-active', 'true')

    audioInstance.currentTime = 0
    fireEvent.keyDown(group, { key: 'Enter' })
    expect(audioInstance.currentTime).toBe(2.3)
  })

  it('adds bottom scroll room for desktop and inline anchors', () => {
    const originalClientHeight = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      'clientHeight',
    )
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
      configurable: true,
      get() {
        return this.getAttribute('data-testid') === 'lyrics-scroll-body'
          ? 500
          : 0
      },
    })

    try {
      const { unmount } = renderPanel({
        mainLyric,
        audioInstance: { currentTime: 0.2, paused: true },
      })
      let lines = screen
        .getByTestId('lyrics-scroll-body')
        .querySelector('[data-scroll-end-padding]')
      const expectedDesktop = Math.round(
        500 * (1 - KARAOKE_DESKTOP_ACTIVE_LINE_ANCHOR_RATIO),
      )
      expect(lines).toHaveAttribute(
        'data-scroll-end-padding',
        String(expectedDesktop),
      )
      unmount()

      renderPanel({
        inline: true,
        mainLyric,
        audioInstance: { currentTime: 0.2, paused: true },
      })
      lines = screen
        .getByTestId('lyrics-scroll-body')
        .querySelector('[data-scroll-end-padding]')
      expect(lines).toHaveAttribute('data-scroll-end-padding', '290')
    } finally {
      if (originalClientHeight) {
        Object.defineProperty(
          HTMLElement.prototype,
          'clientHeight',
          originalClientHeight,
        )
      } else {
        delete HTMLElement.prototype.clientHeight
      }
    }
  })

  it('pauses auto-scroll only for genuine manual scroll intent', async () => {
    vi.useFakeTimers()
    const requestAnimationFrameSpy = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation(() => 0)
    renderPanel({
      mainLyric,
      audioInstance: { currentTime: 0.5, paused: true },
    })

    const body = screen.getByTestId('lyrics-scroll-body')
    const initialFrames = requestAnimationFrameSpy.mock.calls.length
    fireEvent.wheel(body)
    expect(body).toHaveAttribute('data-scrollbar-visible', 'true')

    act(() => {
      vi.advanceTimersByTime(KARAOKE_MANUAL_SCROLL_PAUSE_MS)
    })
    await waitFor(() => {
      expect(requestAnimationFrameSpy.mock.calls.length).toBeGreaterThan(
        initialFrames,
      )
    })
  })

  it('resets scroll position when lyric content changes', () => {
    const { rerender } = renderPanel({ mainLyric })
    const body = screen.getByTestId('lyrics-scroll-body')
    body.scrollTop = 180

    rerender(
      <ThemeProvider theme={theme}>
        <LyricsPanel
          visible
          mainLyric={{
            synced: true,
            line: [{ start: 0, end: 1000, value: 'Different song' }],
          }}
        />
      </ThemeProvider>,
    )
    expect(body.scrollTop).toBe(0)
  })

  it('respects reduced motion and empty states', async () => {
    window.matchMedia = vi.fn().mockImplementation((query) => ({
      matches: query === '(prefers-reduced-motion: reduce)',
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }))
    const { unmount } = renderPanel({ mainLyric })
    await waitFor(() => {
      expect(screen.getByTestId('lyrics-scroll-body')).toHaveAttribute(
        'data-reduced-motion',
        'true',
      )
    })
    unmount()

    renderPanel({ mainLyric: null, loading: true })
    expect(screen.getByTestId('lyrics-empty-state')).toHaveTextContent(
      'Loading lyrics',
    )
  })

  it('does not render unrelated appearance controls or spacer rows', () => {
    const { container } = renderPanel({ mainLyric })
    expect(
      screen.queryByTestId('lyrics-settings-button'),
    ).not.toBeInTheDocument()
    expect(screen.queryByLabelText(/font size/i)).not.toBeInTheDocument()
    expect(container.querySelector('[aria-hidden="true"]')).toBeNull()
  })
})
