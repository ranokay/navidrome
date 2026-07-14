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
    "const KARAOKE_LAYER_COLOR_TRANSITION = `color ${KARAOKE_ANIMATION_MS}ms ${KARAOKE_EASING}, -webkit-text-fill-color ${KARAOKE_ANIMATION_MS}ms ${KARAOKE_EASING}`\n",
    "const KARAOKE_LAYER_OPACITY_TRANSITION = `opacity ${KARAOKE_ANIMATION_MS}ms ${KARAOKE_EASING}`\n",
    'shared transition constant',
)
panel = replace_once(
    panel,
    """    '--lyrics-translation-current-color':
      'var(--lyrics-translation-idle-color, currentColor)',
    transform: 'translateY(0)',
""",
    """    '--lyrics-translation-current-color':
      'var(--lyrics-translation-idle-color, currentColor)',
    '--lyrics-layer-opacity': 0.49,
    transform: 'translateY(0)',
""",
    'idle shared opacity',
)
panel = replace_once(
    panel,
    """      '--lyrics-translation-current-color':
        'var(--lyrics-translation-active-color, var(--lyrics-translation-idle-color, currentColor))',
    },
""",
    """      '--lyrics-translation-current-color':
        'var(--lyrics-translation-active-color, var(--lyrics-translation-idle-color, currentColor))',
      '--lyrics-layer-opacity': 1,
    },
""",
    'active shared opacity',
)
panel = replace_once(
    panel,
    """    color: 'var(--lyrics-main-current-color, currentColor)',
    WebkitTextFillColor: 'var(--lyrics-main-current-color, currentColor)',
    transition: KARAOKE_LAYER_COLOR_TRANSITION,
    '@media (prefers-reduced-motion: reduce)': {
      transition: 'none',
    },
""",
    """    color: 'var(--lyrics-main-current-color, currentColor)',
    WebkitTextFillColor: 'var(--lyrics-main-current-color, currentColor)',
    '&[data-tokenized="false"]': {
      opacity: 'var(--lyrics-layer-opacity)',
      color: 'var(--lyrics-main-active-color, currentColor)',
      WebkitTextFillColor: 'var(--lyrics-main-active-color, currentColor)',
      transition: KARAOKE_LAYER_OPACITY_TRANSITION,
    },
    '@media (prefers-reduced-motion: reduce)': {
      transition: 'none',
    },
""",
    'main shared opacity style',
)
panel = replace_once(
    panel,
    """    color: 'var(--lyrics-translation-current-color, currentColor)',
    WebkitTextFillColor:
      'var(--lyrics-translation-current-color, currentColor)',
    transition: KARAOKE_LAYER_COLOR_TRANSITION,
    '@media (prefers-reduced-motion: reduce)': {
      transition: 'none',
    },
""",
    """    opacity: 'var(--lyrics-layer-opacity)',
    color: 'var(--lyrics-translation-active-color, currentColor)',
    WebkitTextFillColor:
      'var(--lyrics-translation-active-color, currentColor)',
    transition: KARAOKE_LAYER_OPACITY_TRANSITION,
    '@media (prefers-reduced-motion: reduce)': {
      transition: 'none',
    },
""",
    'translation shared opacity style',
)
panel = replace_once(
    panel,
    """    color: 'var(--lyrics-pronunciation-current-color, currentColor)',
    WebkitTextFillColor:
      'var(--lyrics-pronunciation-current-color, currentColor)',
    transition: KARAOKE_LAYER_COLOR_TRANSITION,
    '&[data-timed="true"]': {
      transition: 'none',
    },
""",
    """    color: 'var(--lyrics-pronunciation-current-color, currentColor)',
    WebkitTextFillColor:
      'var(--lyrics-pronunciation-current-color, currentColor)',
    '&[data-timed="false"]': {
      color: 'var(--lyrics-pronunciation-active-color, currentColor)',
      WebkitTextFillColor:
        'var(--lyrics-pronunciation-active-color, currentColor)',
    },
    '&[data-timed="true"]': {
      transition: 'none',
    },
""",
    'pronunciation shared parent opacity style',
)
panel_path.write_text(panel)


rows_path = Path('ui/src/audioplayer/LyricsLineRows.jsx')
rows = rows_path.read_text()
rows = replace_once(
    rows,
    """    const tokenRGB = useMemo(
      () => (style?.color ? parseColorRGB(style.color) : [255, 255, 255]),
      [style?.color],
    )
    const lineStyle = useMemo(() => buildLineStyle(line, style), [line, style])
""",
    """    const tokenRGB = useMemo(
      () => (style?.color ? parseColorRGB(style.color) : [255, 255, 255]),
      [style?.color],
    )
    const hasTimedTokens = windows.some(
      (window) => window?.start != null && window?.end != null,
    )
    const lineStyle = useMemo(() => buildLineStyle(line, style), [line, style])
""",
    'plain row token state',
)
rows = replace_once(
    rows,
    """        data-testid={testId}
        style={lineStyle}
""",
    """        data-testid={testId}
        data-tokenized={hasTimedTokens ? 'true' : 'false'}
        data-layer-animation={
          hasTimedTokens ? 'token-gradient' : 'shared-opacity'
        }
        style={lineStyle}
""",
    'plain row animation attributes',
)
rows = replace_once(
    rows,
    """    const pronunciationRGB = useMemo(
      () =>
        pronunciationStyle?.color
          ? parseColorRGB(pronunciationStyle.color)
          : [255, 255, 255],
      [pronunciationStyle?.color],
    )
    const lineStyle = useMemo(() => buildLineStyle(line, style), [line, style])
""",
    """    const pronunciationRGB = useMemo(
      () =>
        pronunciationStyle?.color
          ? parseColorRGB(pronunciationStyle.color)
          : [255, 255, 255],
      [pronunciationStyle?.color],
    )
    const hasTimedTokens = mainWindows.some(
      (window) => window?.start != null && window?.end != null,
    )
    const lineStyle = useMemo(() => buildLineStyle(line, style), [line, style])
""",
    'stacked row token state',
)
rows = replace_once(
    rows,
    """        data-wrapped={isWrapped ? 'true' : 'false'}
        data-testid={testId}
        ref={rowRef}
""",
    """        data-wrapped={isWrapped ? 'true' : 'false'}
        data-testid={testId}
        data-tokenized={hasTimedTokens ? 'true' : 'false'}
        data-layer-animation={
          hasTimedTokens ? 'token-gradient' : 'shared-opacity'
        }
        ref={rowRef}
""",
    'stacked row animation attributes',
)
rows_path.write_text(rows)


test_path = Path('ui/src/audioplayer/LyricsPanel.test.jsx')
tests = test_path.read_text()
marker = """  it('keeps timed translations on the main line lifecycle', () => {
"""
new_test = """  it('uses one shared opacity animation for every static line layer', () => {
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
  })

"""
tests = replace_once(
    tests,
    marker,
    new_test + marker,
    'shared opacity regression test',
)

tests = replace_once(
    tests,
    """    expect(translation).not.toHaveAttribute('data-lyrics-state')
    expect(translation.style.backgroundImage).toBe('')
""",
    """    expect(translation).not.toHaveAttribute('data-lyrics-state')
    expect(translation).toHaveAttribute(
      'data-layer-animation',
      'shared-opacity',
    )
    expect(translation.style.backgroundImage).toBe('')
""",
    'timed translation shared opacity assertion',
)
test_path.write_text(tests)
