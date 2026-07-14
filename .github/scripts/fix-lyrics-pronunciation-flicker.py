from pathlib import Path
import re


def replace_once(content: str, old: str, new: str, label: str) -> str:
    count = content.count(old)
    if count != 1:
        raise RuntimeError(f'{label}: expected one match, found {count}')
    return content.replace(old, new, 1)


def patch_panel() -> None:
    path = Path('ui/src/audioplayer/LyricsPanel.jsx')
    content = path.read_text()
    content = replace_once(
        content,
        """    '&[data-active=\"true\"] $line, &[data-lifecycle=\"release\"] $line': {
      color: 'var(--lyrics-active-color)',
    },
    '&[data-active=\"true\"] $auxLine, &[data-lifecycle=\"release\"] $auxLine': {
      color: 'var(--lyrics-active-color)',
    },""",
        """    '&[data-active=\"true\"] $line': {
      color: 'var(--lyrics-active-color)',
    },
    '&[data-active=\"true\"] $auxLine': {
      color: 'var(--lyrics-active-color)',
    },
    '&[data-active=\"true\"] $stackedPronunciation': {
      color:
        'var(--lyrics-pronunciation-active-color, var(--lyrics-pronunciation-idle-color, currentColor))',
      WebkitTextFillColor:
        'var(--lyrics-pronunciation-active-color, var(--lyrics-pronunciation-idle-color, currentColor))',
    },""",
        'active-only line colors',
    )
    content = replace_once(
        content,
        """  stackedPronunciation: {
    display: 'block',
    marginTop: theme.spacing(0.15),
    fontSize: 15,
    lineHeight: 1.05,
    fontWeight: 700,
    maxWidth: '100%',
    overflowWrap: 'anywhere',
    whiteSpace: 'pre-wrap',
  },""",
        """  stackedPronunciation: {
    display: 'block',
    marginTop: theme.spacing(0.15),
    fontSize: 15,
    lineHeight: 1.05,
    fontWeight: 700,
    maxWidth: '100%',
    overflowWrap: 'anywhere',
    whiteSpace: 'pre-wrap',
    color: 'var(--lyrics-pronunciation-idle-color, currentColor)',
    WebkitTextFillColor:
      'var(--lyrics-pronunciation-idle-color, currentColor)',
    transition: `color ${KARAOKE_ANIMATION_MS}ms ${KARAOKE_EASING}, -webkit-text-fill-color ${KARAOKE_ANIMATION_MS}ms ${KARAOKE_EASING}`,
    '@media (prefers-reduced-motion: reduce)': {
      transition: 'none',
    },
  },""",
        'pronunciation transition style',
    )
    path.write_text(content)


def patch_rows() -> None:
    path = Path('ui/src/audioplayer/LyricsLineRows.jsx')
    content = path.read_text()
    content = replace_once(
        content,
        """      '--lyrics-progress': 0,
      transition:
        'opacity 220ms cubic-bezier(0.22, 1, 0.36, 1), color 220ms cubic-bezier(0.22, 1, 0.36, 1), -webkit-text-fill-color 220ms cubic-bezier(0.22, 1, 0.36, 1)',
      color: futureColor,""",
        """      '--lyrics-progress': 0,
      color: futureColor,""",
        'remove per-token color transition',
    )
    content = replace_once(
        content,
        """                  pronunciationTokenData?.style || {
                    color: pronunciationStyle?.color,
                    WebkitTextFillColor: pronunciationStyle?.color,
                    backgroundImage: 'none',""",
        """                  pronunciationTokenData?.style || {
                    '--lyrics-pronunciation-idle-color':
                      pronunciationStyle?.color,
                    '--lyrics-pronunciation-active-color':
                      pronunciationStyle?.['--lyrics-active-color'] ||
                      pronunciationStyle?.color,
                    color: 'var(--lyrics-pronunciation-idle-color)',
                    WebkitTextFillColor:
                      'var(--lyrics-pronunciation-idle-color)',
                    backgroundImage: 'none',""",
        'static pronunciation colors',
    )
    path.write_text(content)


def patch_timeline() -> None:
    path = Path('ui/src/audioplayer/useLyricsTimeline.js')
    content = path.read_text()
    content, rgba_count = re.subn(
        r"\nconst rgba = \(rgb, alpha\) => \{.*?\n\}\n",
        '\n',
        content,
        count=1,
        flags=re.S,
    )
    if rgba_count != 1:
        raise RuntimeError(f'remove rgba helper: expected one match, found {rgba_count}')

    content = replace_once(
        content,
        """const setProgress = (record, value) => {
  const next = Math.max(0, Math.min(1, value))
  if (record.progress != null && Math.abs(record.progress - next) < 0.001)
    return
  record.progress = next
  record.node.style.setProperty('--lyrics-progress', String(next))
}

const setSolidTokenColor""",
        """const setProgress = (record, value) => {
  const next = Math.max(0, Math.min(1, value))
  if (record.progress != null && Math.abs(record.progress - next) < 0.001)
    return
  record.progress = next
  record.node.style.setProperty('--lyrics-progress', String(next))
}

const setTokenOpacity = (record, value) => {
  const next = Math.max(0, Math.min(1, value))
  if (record.opacity != null && Math.abs(record.opacity - next) < 0.001) return
  record.opacity = next
  record.node.style.opacity = String(next)
}

const setSolidTokenColor""",
        'token opacity helper',
    )

    content, state_count = re.subn(
        r"const applyTokenState = \(record, state, progress = 0\) => \{.*?\n\}\n\nconst resetToken",
        """const applyTokenState = (record, state, progress = 0) => {
  const previousState = record.state
  record.state = state
  record.node.dataset.lyricsState = state
  const presentation = record.presentation || {}

  if (state === 'active') {
    if (previousState !== 'active') {
      setTokenOpacity(record, 1)
      setGradientTokenColor(record)
    }
    setProgress(record, progress)
    return
  }

  setTokenOpacity(record, 1)
  if (state === 'completed') {
    setSolidTokenColor(record, presentation.doneColor || 'currentColor')
    setProgress(record, 1)
    return
  }

  setSolidTokenColor(record, presentation.futureColor || 'currentColor')
  setProgress(record, 0)
}

const setTokenReleasePresentation = (record, progress) => {
  const presentation = record.presentation || {}
  const nextProgress = Math.max(0, Math.min(1, progress))
  if (record.state !== 'release') {
    applyTokenState(record, 'completed', 1)
    record.state = 'release'
    record.node.dataset.lyricsState = 'release'
  }
  const activeAlpha = Math.max(0.001, presentation.activeAlpha ?? 1)
  const targetOpacity = Math.min(
    1,
    Math.max(0, (presentation.futureAlpha ?? 0.34) / activeAlpha),
  )
  setTokenOpacity(record, 1 + (targetOpacity - 1) * nextProgress)
}

const resetToken""",
        content,
        count=1,
        flags=re.S,
    )
    if state_count != 1:
        raise RuntimeError(f'apply token state: expected one match, found {state_count}')

    content = replace_once(
        content,
        """    node.dataset.highlightActive =
      phase === 'active' || phase === 'release' ? 'true' : 'false'""",
        """    node.dataset.highlightActive = phase === 'active' ? 'true' : 'false'""",
        'release line highlight state',
    )

    content = replace_once(
        content,
        """  const updateLineTokens = useCallback((lineIndex, time) => {
    lineTokenKeysRef.current.get(lineIndex)?.forEach((key) => {
      const record = tokenRecordsRef.current.get(key)
      if (record) setTokenPresentation(record, time)
    })
  }, [])

  const publishActiveIndexes""",
        """  const updateLineTokens = useCallback((lineIndex, time) => {
    lineTokenKeysRef.current.get(lineIndex)?.forEach((key) => {
      const record = tokenRecordsRef.current.get(key)
      if (record) setTokenPresentation(record, time)
    })
  }, [])

  const updateLineReleaseTokens = useCallback((lineIndex, progress) => {
    lineTokenKeysRef.current.get(lineIndex)?.forEach((key) => {
      const record = tokenRecordsRef.current.get(key)
      if (record) setTokenReleasePresentation(record, progress)
    })
  }, [])

  const publishActiveIndexes""",
        'release token callback',
    )

    content = replace_once(
        content,
        """              releaseIndexesRef.current.add(window.lineIndex)
              setLineState(window.lineIndex, 'release')
              updateLineTokens(window.lineIndex, window.end + lead)""",
        """              releaseIndexesRef.current.add(window.lineIndex)
              setLineState(window.lineIndex, 'release')
              updateLineReleaseTokens(
                window.lineIndex,
                (current - window.end) / KARAOKE_LINE_RELEASE_MS,
              )""",
        'force-seek release start',
    )

    content = replace_once(
        content,
        """            releaseIndexesRef.current.add(lineIndex)
            setLineState(lineIndex, 'release')
            updateLineTokens(lineIndex, window.end + lead)""",
        """            releaseIndexesRef.current.add(lineIndex)
            setLineState(lineIndex, 'release')
            updateLineReleaseTokens(lineIndex, 0)""",
        'normal release start',
    )

    content = replace_once(
        content,
        """      releaseIndexesRef.current.forEach((lineIndex) => {
        const window = timeline.windows[lineIndex]
        if (
          !window?.valid ||
          current >= window.end + KARAOKE_LINE_RELEASE_MS ||
          current < window.end
        ) {
          releaseIndexesRef.current.delete(lineIndex)
          setLineState(lineIndex, 'idle')
          resetLineTokens(
            lineIndex,
            current >= (window?.end ?? Infinity) ? 'inactive-past' : 'future',
          )
        }
      })""",
        """      releaseIndexesRef.current.forEach((lineIndex) => {
        const window = timeline.windows[lineIndex]
        if (
          !window?.valid ||
          current >= window.end + KARAOKE_LINE_RELEASE_MS ||
          current < window.end
        ) {
          releaseIndexesRef.current.delete(lineIndex)
          setLineState(lineIndex, 'idle')
          resetLineTokens(
            lineIndex,
            current >= (window?.end ?? Infinity) ? 'inactive-past' : 'future',
          )
          return
        }
        updateLineReleaseTokens(
          lineIndex,
          (current - window.end) / KARAOKE_LINE_RELEASE_MS,
        )
      })""",
        'release update loop',
    )

    content = replace_once(
        content,
        """      updateLineTokens,
    ],""",
        """      updateLineReleaseTokens,
      updateLineTokens,
    ],""",
        'apply dependencies',
    )

    content = replace_once(
        content,
        """        progress: null,
        state: null,""",
        """        progress: null,
        opacity: null,
        state: null,""",
        'record opacity',
    )

    content = replace_once(
        content,
        """          setTokenPresentation(
            record,
            lineWindow.end + (reducedMotion ? 0 : KARAOKE_HIGHLIGHT_LEAD_MS),
          )""",
        """          setTokenReleasePresentation(
            record,
            (lastAppliedTimeRef.current - lineWindow.end) /
              KARAOKE_LINE_RELEASE_MS,
          )""",
        'register release token',
    )
    path.write_text(content)


def patch_tests() -> None:
    path = Path('ui/src/audioplayer/LyricsPanel.test.jsx')
    content = path.read_text()
    content = replace_once(
        content,
        """      showPronunciation: true,
    })

    expect(screen.getByText('我总要给一些别的')).toBeInTheDocument()
    expect(
      screen.getByText('wo zong yao gei yi xie bie de'),
    ).toBeInTheDocument()
  })""",
        """      showPronunciation: true,
      audioInstance: { currentTime: 0.2, paused: true },
    })

    expect(screen.getByText('我总要给一些别的')).toBeInTheDocument()
    const pronunciation = screen.getByText('wo zong yao gei yi xie bie de')
    const group = pronunciation.closest('[data-testid=\"lyrics-line-group\"]')
    expect(group).toHaveAttribute('data-active', 'true')
    expect(
      pronunciation.style.getPropertyValue(
        '--lyrics-pronunciation-active-color',
      ),
    ).not.toBe('')
    expect(pronunciation.style.color).toBe(
      'var(--lyrics-pronunciation-idle-color)',
    )
  })""",
        'line pronunciation test',
    )

    content = replace_once(
        content,
        """    expect(token.style.backgroundImage).toContain('linear-gradient')
    expect(token.style.color).toBe('transparent')
  })

  it('keeps completed tokens during release then clears stale state', () => {""",
        """    expect(token.style.backgroundImage).toContain('linear-gradient')
    expect(token.style.color).toBe('transparent')
    expect(token.style.transition).toBe('')
  })

  it('starts unhighlighting as soon as a line ends then clears stale state', () => {""",
        'short cue and release test heading',
    )

    content = replace_once(
        content,
        """    expect(group).toHaveAttribute('data-lifecycle', 'release')
    expect(group).toHaveAttribute('data-highlight-active', 'true')
    expect(token).toHaveAttribute('data-lyrics-state', 'completed')
    expect(token.style.backgroundImage).toBe('none')""",
        """    expect(group).toHaveAttribute('data-lifecycle', 'release')
    expect(group).toHaveAttribute('data-highlight-active', 'false')
    expect(token).toHaveAttribute('data-lyrics-state', 'release')
    expect(token.style.backgroundImage).toBe('none')
    expect(Number(token.style.opacity)).toBeLessThan(1)
    expect(Number(token.style.opacity)).toBeGreaterThan(0.3)""",
        'release expectations',
    )

    content = replace_once(
        content,
        """    expect(token).toHaveAttribute('data-lyrics-state', 'inactive-past')
  })""",
        """    expect(token).toHaveAttribute('data-lyrics-state', 'inactive-past')
    expect(token.style.opacity).toBe('1')
  })""",
        'release reset opacity',
    )
    path.write_text(content)


def main() -> None:
    patch_panel()
    patch_rows()
    patch_timeline()
    patch_tests()


if __name__ == '__main__':
    main()
