from pathlib import Path


def replace_once(content: str, old: str, new: str, label: str) -> str:
    count = content.count(old)
    if count != 1:
        raise RuntimeError(f'{label}: expected one match, found {count}')
    return content.replace(old, new, 1)


def patch_panel() -> None:
    path = Path('ui/src/audioplayer/LyricsPanel.jsx')
    content = path.read_text()

    old_group = '''  lineGroup: {
    width: '100%',
    borderRadius: theme.shape.borderRadius,
    transform: 'translateY(0)',
    transition: `transform ${KARAOKE_ANIMATION_MS}ms ${KARAOKE_EASING}`,
    '&[data-highlight-active="true"]': {
      transform: 'translateY(-2px)',
    },
    '&[data-active="true"] $line': {
      color: 'var(--lyrics-active-color)',
    },
    '&[data-active="true"] $auxLine': {
      color: 'var(--lyrics-active-color)',
    },
    '&[data-active="true"] $stackedPronunciation': {
      color:
        'var(--lyrics-pronunciation-active-color, var(--lyrics-pronunciation-idle-color, currentColor))',
      WebkitTextFillColor:
        'var(--lyrics-pronunciation-active-color, var(--lyrics-pronunciation-idle-color, currentColor))',
    },
    '@media (prefers-reduced-motion: reduce)': {
      transition: 'none',
      transform: 'none',
    },
  },'''
    new_group = '''  lineGroup: {
    width: '100%',
    borderRadius: theme.shape.borderRadius,
    '--lyrics-main-current-color':
      'var(--lyrics-main-idle-color, currentColor)',
    '--lyrics-pronunciation-current-color':
      'var(--lyrics-pronunciation-idle-color, currentColor)',
    '--lyrics-translation-current-color':
      'var(--lyrics-translation-idle-color, currentColor)',
    transform: 'translateY(0)',
    transition: `transform ${KARAOKE_ANIMATION_MS}ms ${KARAOKE_EASING}`,
    '&[data-highlight-active="true"]': {
      transform: 'translateY(-2px)',
    },
    '&[data-active="true"]': {
      '--lyrics-main-current-color':
        'var(--lyrics-main-active-color, var(--lyrics-main-idle-color, currentColor))',
      '--lyrics-pronunciation-current-color':
        'var(--lyrics-pronunciation-active-color, var(--lyrics-pronunciation-idle-color, currentColor))',
      '--lyrics-translation-current-color':
        'var(--lyrics-translation-active-color, var(--lyrics-translation-idle-color, currentColor))',
    },
    '@media (prefers-reduced-motion: reduce)': {
      transition: 'none',
      transform: 'none',
    },
  },'''
    content = replace_once(content, old_group, new_group, 'line group style')

    content = replace_once(
        content,
        '''    letterSpacing: 0,
    transition: `opacity ${KARAOKE_ANIMATION_MS}ms ${KARAOKE_EASING}, color ${KARAOKE_ANIMATION_MS}ms ${KARAOKE_EASING}`,''',
        '''    letterSpacing: 0,
    color: 'var(--lyrics-main-current-color, currentColor)',
    WebkitTextFillColor: 'var(--lyrics-main-current-color, currentColor)',
    transition: `opacity ${KARAOKE_ANIMATION_MS}ms ${KARAOKE_EASING}, color ${KARAOKE_ANIMATION_MS}ms ${KARAOKE_EASING}, -webkit-text-fill-color ${KARAOKE_ANIMATION_MS}ms ${KARAOKE_EASING}`,''',
        'main line current color',
    )

    content = replace_once(
        content,
        '''    letterSpacing: 0,
    transition: `opacity ${KARAOKE_ANIMATION_MS}ms ${KARAOKE_EASING}, color ${KARAOKE_ANIMATION_MS}ms ${KARAOKE_EASING}`,
    '@media (prefers-reduced-motion: reduce)': {
      transition: 'none',
    },
  },
  stackedToken:''',
        '''    letterSpacing: 0,
    color: 'var(--lyrics-translation-current-color, currentColor)',
    WebkitTextFillColor:
      'var(--lyrics-translation-current-color, currentColor)',
    transition: `opacity ${KARAOKE_ANIMATION_MS}ms ${KARAOKE_EASING}, color ${KARAOKE_ANIMATION_MS}ms ${KARAOKE_EASING}, -webkit-text-fill-color ${KARAOKE_ANIMATION_MS}ms ${KARAOKE_EASING}`,
    '@media (prefers-reduced-motion: reduce)': {
      transition: 'none',
    },
  },
  stackedToken:''',
        'translation current color',
    )

    content = replace_once(
        content,
        '''    color: 'var(--lyrics-pronunciation-idle-color, currentColor)',
    WebkitTextFillColor: 'var(--lyrics-pronunciation-idle-color, currentColor)',
    transition: `color ${KARAOKE_ANIMATION_MS}ms ${KARAOKE_EASING}, -webkit-text-fill-color ${KARAOKE_ANIMATION_MS}ms ${KARAOKE_EASING}`,''',
        '''    color: 'var(--lyrics-pronunciation-current-color, currentColor)',
    WebkitTextFillColor:
      'var(--lyrics-pronunciation-current-color, currentColor)',
    transition: `color ${KARAOKE_ANIMATION_MS}ms ${KARAOKE_EASING}, -webkit-text-fill-color ${KARAOKE_ANIMATION_MS}ms ${KARAOKE_EASING}`,''',
        'pronunciation current color',
    )

    helper_marker = '''const getLineLanes = (line) =>
  Array.isArray(line?.lanes) && line.lanes.length > 0 ? line.lanes : [line]
'''
    helper = '''const getLineLanes = (line) =>
  Array.isArray(line?.lanes) && line.lanes.length > 0 ? line.lanes : [line]

const buildLineGroupStyle = (canSeekLine, layerStyles) => ({
  cursor: canSeekLine ? 'pointer' : undefined,
  '--lyrics-main-idle-color': layerStyles.main.color,
  '--lyrics-main-active-color':
    layerStyles.main['--lyrics-active-color'] || layerStyles.main.color,
  '--lyrics-pronunciation-idle-color': layerStyles.pronunciation.color,
  '--lyrics-pronunciation-active-color':
    layerStyles.pronunciation['--lyrics-active-color'] ||
    layerStyles.pronunciation.color,
  '--lyrics-translation-idle-color': layerStyles.translation.color,
  '--lyrics-translation-active-color':
    layerStyles.translation['--lyrics-active-color'] ||
    layerStyles.translation.color,
})
'''
    content = replace_once(content, helper_marker, helper, 'line group variables helper')

    content = replace_once(
        content,
        "                style={{ cursor: canSeekLine ? 'pointer' : undefined }}",
        '                style={buildLineGroupStyle(canSeekLine, layerStyles)}',
        'line group inline variables',
    )
    path.write_text(content)


def patch_rows() -> None:
    path = Path('ui/src/audioplayer/LyricsLineRows.jsx')
    content = path.read_text()
    old = '''const toneEmphasisColor = (color) => {
  const rgb = parseColorRGB(color)
  if (!rgb) return color

  const alpha = String(color).match(/rgba?\([^)]*?,\s*([\d.]+)\s*\)$/)?.[1]
  return tokenColor(toneEmphasisRGB(rgb), alpha == null ? 1 : Number(alpha))
}

const buildLineStyle = (line, style) => {
  const emphasisStyle = buildEmphasisStyle(line)
  if (!emphasisStyle) return style

  const emphasisColor = style?.color ? toneEmphasisColor(style.color) : null
  return {
    ...style,
    ...emphasisStyle,
    ...(emphasisColor
      ? {
          color: emphasisColor,
          WebkitTextFillColor: emphasisColor,
        }
      : {}),
  }
}

const buildStaticEmphasisStyle = (token, color) => {
  const emphasisStyle = buildEmphasisStyle(token)
  if (!emphasisStyle) return undefined

  const emphasisColor = color ? toneEmphasisColor(color) : null
  return {
    ...emphasisStyle,
    ...(emphasisColor
      ? {
          color: emphasisColor,
          WebkitTextFillColor: emphasisColor,
        }
      : {}),
  }
}
'''
    new = '''const stripLayerColors = (style) => {
  const result = { ...(style || {}) }
  delete result.color
  delete result.WebkitTextFillColor
  delete result['--lyrics-active-color']
  return result
}

const buildLineStyle = (line, style) => {
  const emphasisStyle = buildEmphasisStyle(line)
  return {
    ...stripLayerColors(style),
    ...emphasisStyle,
    ...(emphasisStyle ? { filter: `brightness(${EMPHASIS_TONE})` } : {}),
  }
}

const buildStaticEmphasisStyle = (token) => {
  const emphasisStyle = buildEmphasisStyle(token)
  if (!emphasisStyle) return undefined
  return {
    ...emphasisStyle,
    filter: `brightness(${EMPHASIS_TONE})`,
  }
}
'''
    content = replace_once(content, old, new, 'remove inline layer colors')

    content = replace_once(
        content,
        '''                  pronunciationTokenData?.style || {
                    '--lyrics-pronunciation-idle-color':
                      pronunciationStyle?.color,
                    '--lyrics-pronunciation-active-color':
                      pronunciationStyle?.['--lyrics-active-color'] ||
                      pronunciationStyle?.color,
                    color: 'var(--lyrics-pronunciation-idle-color)',
                    WebkitTextFillColor:
                      'var(--lyrics-pronunciation-idle-color)',
                    backgroundImage: 'none',
                    ...buildStaticEmphasisStyle(
                      pronunciationToken || segment.token,
                      pronunciationStyle?.color,
                    ),
                  }''',
        '''                  pronunciationTokenData?.style || {
                    backgroundImage: 'none',
                    ...buildStaticEmphasisStyle(
                      pronunciationToken || segment.token,
                    ),
                  }''',
        'static pronunciation style',
    )

    content = content.replace(
        'buildStaticEmphasisStyle(segment.token, style?.color)',
        'buildStaticEmphasisStyle(segment.token)',
    )
    content = content.replace(
        'buildTokenData(\n            segment.token,\n            tokenRGB,\n            window,\n            segment.text,\n          )',
        'buildTokenData(segment.token, tokenRGB)',
    )
    content = content.replace(
        'buildTokenData(segment.token, tokenRGB, mainWindow, segment.text)',
        'buildTokenData(segment.token, tokenRGB)',
    )
    content = content.replace(
        '''buildTokenData(
                pronunciationToken || segment.token,
                pronunciationRGB,
                pronunciationWindow,
                segment.pronunciation,
              )''',
        '''buildTokenData(
                pronunciationToken || segment.token,
                pronunciationRGB,
              )''',
    )
    path.write_text(content)


def patch_timeline() -> None:
    path = Path('ui/src/audioplayer/useLyricsTimeline.js')
    content = path.read_text()
    content = content.replace('  KARAOKE_CLOCK_RESET_THRESHOLD_MS,\n', '')
    content = content.replace('  KARAOKE_MONOTONIC_JITTER_MS,\n', '')
    old = '''      const backwards = lastFrameTime - current
      if (backwards > KARAOKE_CLOCK_RESET_THRESHOLD_MS) {
        current = observed
        anchorAudioMs = observed
        anchorPerfMs = now
      } else if (backwards > 0 && backwards <= KARAOKE_MONOTONIC_JITTER_MS) {
        current = lastFrameTime
      }
'''
    new = '''      const backwards = lastFrameTime - current
      if (backwards > 0) {
        current = lastFrameTime
      }
'''
    content = replace_once(content, old, new, 'monotonic playback clock')
    path.write_text(content)


def patch_panel_tests() -> None:
    path = Path('ui/src/audioplayer/LyricsPanel.test.jsx')
    content = path.read_text()
    old = '''    expect(
      pronunciation.style.getPropertyValue(
        '--lyrics-pronunciation-active-color',
      ),
    ).not.toBe('')
    expect(pronunciation.style.color).toBe(
      'var(--lyrics-pronunciation-idle-color)',
    )
'''
    new = '''    expect(
      group.style.getPropertyValue('--lyrics-pronunciation-active-color'),
    ).not.toBe('')
    expect(pronunciation.style.color).toBe('')
'''
    content = replace_once(content, old, new, 'line pronunciation assertion')

    marker = '''  it('renders unsynced lyrics as static selectable text', () => {'''
    tests = '''  it('uses the same active and release lifecycle for all line-level layers', () => {
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
    expect(pronunciation.style.transition).toBe('')
  })

'''
    content = replace_once(content, marker, tests + marker, 'unified layer tests')
    path.write_text(content)


def patch_timeline_tests() -> None:
    path = Path('ui/src/audioplayer/useLyricsTimeline.test.js')
    content = path.read_text()
    marker = '''  it('starts and stops requestAnimationFrame with playback visibility', () => {'''
    test = '''  it('keeps interpolated playback time monotonic between coarse media updates', () => {
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

'''
    content = replace_once(content, marker, test + marker, 'monotonic clock test')
    path.write_text(content)


def main() -> None:
    patch_panel()
    patch_rows()
    patch_timeline()
    patch_panel_tests()
    patch_timeline_tests()


if __name__ == '__main__':
    main()
