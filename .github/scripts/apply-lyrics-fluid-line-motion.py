from pathlib import Path


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f'{label}: expected one match, found {count}')
    return text.replace(old, new, 1)


constants_path = Path('ui/src/audioplayer/lyricsKaraokeConstants.js')
constants = constants_path.read_text()
constants = replace_once(
    constants,
    'export const KARAOKE_LINE_ENTER_MS = 100\nexport const KARAOKE_LINE_RELEASE_MS = 220',
    """export const KARAOKE_LINE_ENTER_MS = 180
export const KARAOKE_LINE_LIFT_PX = 1.5
export const KARAOKE_LINE_MOTION_RELEASE_MS = 280
export const KARAOKE_LINE_MOTION_EASING = 'cubic-bezier(0.25, 0.1, 0.25, 1)'
export const KARAOKE_LINE_RELEASE_MS = 220""",
    'line motion constants',
)
constants_path.write_text(constants)


panel_path = Path('ui/src/audioplayer/LyricsPanel.jsx')
panel = panel_path.read_text()
panel = replace_once(
    panel,
    """  KARAOKE_INLINE_ACTIVE_LINE_ANCHOR_RATIO,
  KARAOKE_LINE_ENTER_MS,
  KARAOKE_MANUAL_SCROLL_PAUSE_MS,
""",
    """  KARAOKE_INLINE_ACTIVE_LINE_ANCHOR_RATIO,
  KARAOKE_LINE_ENTER_MS,
  KARAOKE_LINE_LIFT_PX,
  KARAOKE_LINE_MOTION_EASING,
  KARAOKE_LINE_MOTION_RELEASE_MS,
  KARAOKE_MANUAL_SCROLL_PAUSE_MS,
""",
    'line motion imports',
)
panel = replace_once(
    panel,
    """    transform: 'translateY(0)',
    transition: `transform ${KARAOKE_ANIMATION_MS}ms ${KARAOKE_EASING}`,
    '&[data-highlight-active="true"]': {
      transform: 'translateY(-2px)',
      transitionDuration: `${KARAOKE_LINE_ENTER_MS}ms`,
    },
""",
    """    transform: 'translateY(0)',
    transition: `transform ${KARAOKE_LINE_MOTION_RELEASE_MS}ms ${KARAOKE_LINE_MOTION_EASING}`,
    '&[data-highlight-active="true"]': {
      transform: `translateY(-${KARAOKE_LINE_LIFT_PX}px)`,
      transitionDuration: `${KARAOKE_LINE_ENTER_MS}ms`,
    },
""",
    'fluid line transform',
)
panel_path.write_text(panel)


panel_test_path = Path('ui/src/audioplayer/LyricsPanel.test.jsx')
panel_tests = panel_test_path.read_text()
panel_tests = replace_once(
    panel_tests,
    """import {
  KARAOKE_ANIMATION_MS,
  KARAOKE_DESKTOP_ACTIVE_LINE_ANCHOR_RATIO,
  KARAOKE_LINE_ENTER_MS,
  KARAOKE_MANUAL_SCROLL_PAUSE_MS,
} from './lyricsKaraokeConstants'
""",
    """import {
  KARAOKE_DESKTOP_ACTIVE_LINE_ANCHOR_RATIO,
  KARAOKE_LINE_ENTER_MS,
  KARAOKE_LINE_LIFT_PX,
  KARAOKE_LINE_MOTION_RELEASE_MS,
  KARAOKE_MANUAL_SCROLL_PAUSE_MS,
} from './lyricsKaraokeConstants'
""",
    'panel test motion imports',
)
panel_tests = replace_once(
    panel_tests,
    """  it('uses a quick line enter and the shared release duration', () => {
    const { rerender } = renderPanel({
      mainLyric,
      audioInstance: { currentTime: 0.5, paused: true },
    })

    const group = screen.getByTestId('lyrics-line-group')
    expect(group).toHaveAttribute('data-highlight-active', 'true')
    expect(window.getComputedStyle(group).transitionDuration).toBe(
      `${KARAOKE_LINE_ENTER_MS}ms`,
    )

    rerender(
      <ThemeProvider theme={theme}>
        <LyricsPanel
          visible
          mainLyric={mainLyric}
          audioInstance={{ currentTime: 1.1, paused: true }}
        />
      </ThemeProvider>,
    )

    expect(group).toHaveAttribute('data-highlight-active', 'false')
    expect(window.getComputedStyle(group).transitionDuration).toBe(
      `${KARAOKE_ANIMATION_MS}ms`,
    )
  })
""",
    """  it('uses a subtle fluid lift and a slower settled return', () => {
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
""",
    'panel line motion regression test',
)
panel_test_path.write_text(panel_tests)


scroll_test_path = Path('ui/src/audioplayer/lyricsScroll.test.js')
scroll_tests = scroll_test_path.read_text()
scroll_tests = replace_once(
    scroll_tests,
    """  KARAOKE_HIGHLIGHT_LEAD_MS,
  KARAOKE_LINE_ENTER_MS,
  KARAOKE_SCROLL_ANIMATION_MS,
""",
    """  KARAOKE_HIGHLIGHT_LEAD_MS,
  KARAOKE_LINE_ENTER_MS,
  KARAOKE_LINE_LIFT_PX,
  KARAOKE_LINE_MOTION_RELEASE_MS,
  KARAOKE_SCROLL_ANIMATION_MS,
""",
    'scroll test motion imports',
)
scroll_tests = replace_once(
    scroll_tests,
    """    expect(KARAOKE_SCROLL_ANIMATION_MS).toBe(300)
    expect(KARAOKE_LINE_ENTER_MS).toBe(100)
""",
    """    expect(KARAOKE_SCROLL_ANIMATION_MS).toBe(300)
    expect(KARAOKE_LINE_ENTER_MS).toBe(180)
    expect(KARAOKE_LINE_MOTION_RELEASE_MS).toBe(280)
    expect(KARAOKE_LINE_LIFT_PX).toBe(1.5)
""",
    'motion profile expectations',
)
scroll_test_path.write_text(scroll_tests)
