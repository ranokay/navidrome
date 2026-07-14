from pathlib import Path


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f'{label}: expected one match, found {count}')
    return text.replace(old, new, 1)


panel_path = Path('ui/src/audioplayer/LyricsPanel.jsx')
panel = panel_path.read_text()
panel = replace_once(
    panel,
    """  KARAOKE_INLINE_ACTIVE_LINE_ANCHOR_RATIO,
  KARAOKE_MANUAL_SCROLL_PAUSE_MS,
""",
    """  KARAOKE_INLINE_ACTIVE_LINE_ANCHOR_RATIO,
  KARAOKE_LINE_ENTER_MS,
  KARAOKE_MANUAL_SCROLL_PAUSE_MS,
""",
    'line enter import',
)
panel = replace_once(
    panel,
    """    '&[data-highlight-active="true"]': {
      transform: 'translateY(-2px)',
    },
""",
    """    '&[data-highlight-active="true"]': {
      transform: 'translateY(-2px)',
      transitionDuration: `${KARAOKE_LINE_ENTER_MS}ms`,
    },
""",
    'active line enter transition',
)
panel_path.write_text(panel)


test_path = Path('ui/src/audioplayer/LyricsPanel.test.jsx')
tests = test_path.read_text()
tests = replace_once(
    tests,
    """  KARAOKE_DESKTOP_ACTIVE_LINE_ANCHOR_RATIO,
  KARAOKE_MANUAL_SCROLL_PAUSE_MS,
""",
    """  KARAOKE_ANIMATION_MS,
  KARAOKE_DESKTOP_ACTIVE_LINE_ANCHOR_RATIO,
  KARAOKE_LINE_ENTER_MS,
  KARAOKE_MANUAL_SCROLL_PAUSE_MS,
""",
    'panel motion constants imports',
)
marker = """  it('uses the same active and release lifecycle for all line-level layers', () => {
"""
test = """  it('uses a quick line enter and the shared release duration', () => {
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

"""
tests = replace_once(tests, marker, test + marker, 'line enter regression test')
test_path.write_text(tests)
