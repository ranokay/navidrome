from pathlib import Path


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f'{label}: expected one match, found {count}')
    return text.replace(old, new, 1)


# Motion constants: no line drop, plus a subtle per-character wave.
path = Path('ui/src/audioplayer/lyricsKaraokeConstants.js')
text = path.read_text()
text = replace_once(
    text,
    """export const KARAOKE_LINE_ENTER_MS = 180
export const KARAOKE_LINE_LIFT_PX = 1.5
export const KARAOKE_LINE_MOTION_RELEASE_MS = 280
export const KARAOKE_LINE_MOTION_EASING = 'cubic-bezier(0.25, 0.1, 0.25, 1)'
""",
    """export const KARAOKE_LINE_ENTER_MS = 180
export const KARAOKE_LINE_LIFT_PX = 1.5
export const KARAOKE_LINE_MOTION_EASING = 'cubic-bezier(0.25, 0.1, 0.25, 1)'
export const KARAOKE_CHARACTER_LIFT_PX = 1.4
export const KARAOKE_CHARACTER_WAVE_WIDTH = 0.28
""",
    'motion constants',
)
path.write_text(text)


# Keep a line raised after it has started, and render timed token text as
# grapheme spans that can be lifted by the shared timeline progress.
path = Path('ui/src/audioplayer/LyricsPanel.jsx')
text = path.read_text()
text = replace_once(
    text,
    """  KARAOKE_LINE_ENTER_MS,
  KARAOKE_LINE_LIFT_PX,
  KARAOKE_LINE_MOTION_EASING,
  KARAOKE_LINE_MOTION_RELEASE_MS,
""",
    """  KARAOKE_LINE_ENTER_MS,
  KARAOKE_LINE_LIFT_PX,
  KARAOKE_LINE_MOTION_EASING,
""",
    'remove line release import',
)
text = replace_once(
    text,
    """    transform: 'translateY(0)',
    transition: `transform ${KARAOKE_LINE_MOTION_RELEASE_MS}ms ${KARAOKE_LINE_MOTION_EASING}`,
    '&[data-highlight-active="true"]': {
      transform: `translateY(-${KARAOKE_LINE_LIFT_PX}px)`,
      transitionDuration: `${KARAOKE_LINE_ENTER_MS}ms`,
    },
""",
    """    transform: 'translateY(0)',
    transition: 'none',
    '&[data-raised="true"]': {
      transform: `translateY(-${KARAOKE_LINE_LIFT_PX}px)`,
      transition: `transform ${KARAOKE_LINE_ENTER_MS}ms ${KARAOKE_LINE_MOTION_EASING}`,
    },
""",
    'persistent line lift style',
)
text = replace_once(
    text,
    """    '@media (prefers-reduced-motion: reduce)': {
      transition: 'none',
      transform: 'none',
    },
  },
  line: {
""",
    """    '@media (prefers-reduced-motion: reduce)': {
      transition: 'none',
      transform: 'none',
    },
  },
  waveCharacter: {
    display: 'inline-block',
    willChange: 'transform',
    transform: 'translateY(0)',
    '@media (prefers-reduced-motion: reduce)': {
      transform: 'none !important',
      willChange: 'auto',
    },
  },
  line: {
""",
    'wave character style',
)
text = replace_once(
    text,
    """                data-active={isActiveLine ? 'true' : 'false'}
                data-lifecycle={isActiveLine ? 'active' : 'idle'}
""",
    """                data-active={isActiveLine ? 'true' : 'false'}
                data-lifecycle={isActiveLine ? 'active' : 'idle'}
                data-raised={isActiveLine ? 'true' : 'false'}
""",
    'initial raised state',
)
# Both row components already receive the shared classes object only for the
# stacked path. Add the wave class explicitly to both renderers.
text = text.replace(
    """                          tokenClassName={classes.token}
                          registerToken={registerToken}
""",
    """                          tokenClassName={classes.token}
                          waveCharacterClassName={classes.waveCharacter}
                          registerToken={registerToken}
""",
)
text = text.replace(
    """                        tokenClassName={classes.token}
                        registerToken={registerToken}
""",
    """                        tokenClassName={classes.token}
                        waveCharacterClassName={classes.waveCharacter}
                        registerToken={registerToken}
""",
)
path.write_text(text)


# Split timed token text into grapheme clusters. Their transforms are updated
# from the same progress value already driving the gradient, so there is no
# second animation clock and no drift from the highlight.
path = Path('ui/src/audioplayer/LyricsLineRows.jsx')
text = path.read_text()
text = replace_once(
    text,
    """const EMPHASIS_TONE = 0.7

const tokenColor = (rgb, alpha) => {
""",
    """const EMPHASIS_TONE = 0.7

const graphemeSegmenter =
  typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function'
    ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    : null

const splitGraphemes = (value) => {
  const text = String(value || '')
  return graphemeSegmenter
    ? Array.from(graphemeSegmenter.segment(text), ({ segment }) => segment)
    : Array.from(text)
}

const renderWaveText = (text, enabled, className) => {
  if (!enabled) return text
  return splitGraphemes(text).map((character, index) => (
    <span
      key={`${index}-${character}`}
      aria-hidden="true"
      className={className}
      data-lyrics-character="true"
      data-whitespace={/^\\s+$/.test(character) ? 'true' : 'false'}
    >
      {character}
    </span>
  ))
}

const tokenColor = (rgb, alpha) => {
""",
    'grapheme wave helpers',
)
text = replace_once(
    text,
    """    tokenClassName,
    registerToken,
""",
    """    tokenClassName,
    waveCharacterClassName,
    registerToken,
""",
    'line row wave prop',
)
text = replace_once(
    text,
    """              style={tokenData.style}
            >
              {segment.text}
            </span>
""",
    """              style={tokenData.style}
              aria-label={segment.text}
            >
              {renderWaveText(
                segment.text,
                Boolean(window?.start != null && window?.end != null),
                waveCharacterClassName,
              )}
            </span>
""",
    'line row wave text',
)
text = replace_once(
    text,
    """    prevProps.tokenClassName === nextProps.tokenClassName &&
    prevProps.registerToken === nextProps.registerToken &&
""",
    """    prevProps.tokenClassName === nextProps.tokenClassName &&
    prevProps.waveCharacterClassName === nextProps.waveCharacterClassName &&
    prevProps.registerToken === nextProps.registerToken &&
""",
    'line row memo wave prop',
)
text = replace_once(
    text,
    """    tokenClassName,
    classes,
    registerToken,
""",
    """    tokenClassName,
    waveCharacterClassName,
    classes,
    registerToken,
""",
    'stacked row wave prop',
)
text = replace_once(
    text,
    """              style={mainTokenData.style}
            >
              {segment.text}
            </span>
""",
    """              style={mainTokenData.style}
              aria-label={segment.text}
            >
              {renderWaveText(
                segment.text,
                Boolean(mainWindow?.start != null && mainWindow?.end != null),
                waveCharacterClassName,
              )}
            </span>
""",
    'stacked main wave text',
)
text = replace_once(
    text,
    """                >
                  {segment.pronunciation}
                </span>
""",
    """                  aria-label={
                    pronunciationWindow ? segment.pronunciation : undefined
                  }
                >
                  {renderWaveText(
                    segment.pronunciation,
                    Boolean(pronunciationWindow),
                    waveCharacterClassName,
                  )}
                </span>
""",
    'stacked pronunciation wave text',
)
text = replace_once(
    text,
    """    prevProps.tokenClassName === nextProps.tokenClassName &&
    prevProps.classes === nextProps.classes &&
""",
    """    prevProps.tokenClassName === nextProps.tokenClassName &&
    prevProps.waveCharacterClassName === nextProps.waveCharacterClassName &&
    prevProps.classes === nextProps.classes &&
""",
    'stacked row memo wave prop',
)
path.write_text(text)


# Drive each grapheme from token progress and preserve the lifted position for
# completed/past tokens. Also retain the whole-line elevation through release
# and past states.
path = Path('ui/src/audioplayer/useLyricsTimeline.js')
text = path.read_text()
text = replace_once(
    text,
    """  KARAOKE_CLOCK_DRIFT_RESET_MS,
  KARAOKE_HIGHLIGHT_LEAD_MS,
  KARAOKE_LINE_RELEASE_MS,
""",
    """  KARAOKE_CHARACTER_LIFT_PX,
  KARAOKE_CHARACTER_WAVE_WIDTH,
  KARAOKE_CLOCK_DRIFT_RESET_MS,
  KARAOKE_HIGHLIGHT_LEAD_MS,
  KARAOKE_LINE_RELEASE_MS,
""",
    'character wave constants imports',
)
text = replace_once(
    text,
    """const setTokenOpacity = (record, value) => {
""",
    """const smoothStep = (value) => value * value * (3 - 2 * value)

const setCharacterLift = (record, progress) => {
  const characters = record.characters || []
  if (!characters.length) return
  const count = characters.length
  characters.forEach((node, index) => {
    if (node.dataset.whitespace === 'true') return
    const center = (index + 0.5) / count
    const start = Math.max(0, center - KARAOKE_CHARACTER_WAVE_WIDTH / 2)
    const end = Math.min(1, center + KARAOKE_CHARACTER_WAVE_WIDTH / 2)
    const local = Math.max(0, Math.min(1, (progress - start) / Math.max(0.001, end - start)))
    const offset = -KARAOKE_CHARACTER_LIFT_PX * smoothStep(local)
    const nextTransform = `translateY(${offset.toFixed(3)}px)`
    if (node.style.transform !== nextTransform) node.style.transform = nextTransform
  })
}

const setTokenOpacity = (record, value) => {
""",
    'character lift updater',
)
text = replace_once(
    text,
    """    setProgress(record, progress)
    return
""",
    """    setProgress(record, progress)
    setCharacterLift(record, progress)
    return
""",
    'active character wave',
)
text = replace_once(
    text,
    """    setSolidTokenColor(record, presentation.doneColor || 'currentColor')
    setProgress(record, 1)
    return
""",
    """    setSolidTokenColor(record, presentation.doneColor || 'currentColor')
    setProgress(record, 1)
    setCharacterLift(record, 1)
    return
""",
    'completed character lift',
)
text = replace_once(
    text,
    """  setSolidTokenColor(record, presentation.futureColor || 'currentColor')
  setProgress(record, 0)
""",
    """  setSolidTokenColor(record, presentation.futureColor || 'currentColor')
  setProgress(record, 0)
  setCharacterLift(record, state === 'inactive-past' ? 1 : 0)
""",
    'future and past character positions',
)
text = replace_once(
    text,
    """    node.dataset.active = phase === 'active' ? 'true' : 'false'
    node.dataset.lifecycle = phase
    node.dataset.highlightActive = phase === 'active' ? 'true' : 'false'
""",
    """    node.dataset.active = phase === 'active' ? 'true' : 'false'
    node.dataset.lifecycle = phase
    node.dataset.highlightActive = phase === 'active' ? 'true' : 'false'
    node.dataset.raised = phase === 'idle' ? 'false' : 'true'
""",
    'persistent line raised state',
)
text = text.replace("setLineState(window.lineIndex, 'idle')\n              resetLineTokens(window.lineIndex, 'inactive-past')", "setLineState(window.lineIndex, 'past')\n              resetLineTokens(window.lineIndex, 'inactive-past')")
text = text.replace("setLineState(lineIndex, 'idle')\n            resetLineTokens(lineIndex, 'inactive-past')", "setLineState(lineIndex, 'past')\n            resetLineTokens(lineIndex, 'inactive-past')")
text = replace_once(
    text,
    """          setLineState(lineIndex, 'idle')
          resetLineTokens(
            lineIndex,
            current >= (window?.end ?? Infinity) ? 'inactive-past' : 'future',
          )
""",
    """          const isPast = current >= (window?.end ?? Infinity)
          setLineState(lineIndex, isPast ? 'past' : 'idle')
          resetLineTokens(lineIndex, isPast ? 'inactive-past' : 'future')
""",
    'release completion line state',
)
text = replace_once(
    text,
    """      } else {
        setLineState(lineIndex, 'idle')
      }
""",
    """      } else if (window?.valid && time >= window.end) {
        setLineState(lineIndex, 'past')
      } else {
        setLineState(lineIndex, 'idle')
      }
""",
    'registered past line state',
)
text = replace_once(
    text,
    """        presentation: descriptor.presentation,
        progress: null,
""",
    """        presentation: descriptor.presentation,
        characters: reducedMotion
          ? []
          : Array.from(node.querySelectorAll('[data-lyrics-character="true"]')),
        progress: null,
""",
    'cache character nodes',
)
text = replace_once(
    text,
    """      node.dataset.active = 'false'
      node.dataset.lifecycle = 'idle'
      node.dataset.highlightActive = 'false'
""",
    """      node.dataset.active = 'false'
      node.dataset.lifecycle = 'idle'
      node.dataset.highlightActive = 'false'
      node.dataset.raised = 'false'
""",
    'reset raised state',
)
path.write_text(text)


# Tests: completed lines remain elevated, and timed main/pronunciation tokens
# receive independently lifted grapheme spans.
path = Path('ui/src/audioplayer/LyricsPanel.test.jsx')
text = path.read_text()
text = replace_once(
    text,
    """  KARAOKE_DESKTOP_ACTIVE_LINE_ANCHOR_RATIO,
  KARAOKE_LINE_ENTER_MS,
  KARAOKE_LINE_LIFT_PX,
  KARAOKE_LINE_MOTION_RELEASE_MS,
  KARAOKE_MANUAL_SCROLL_PAUSE_MS,
""",
    """  KARAOKE_CHARACTER_LIFT_PX,
  KARAOKE_DESKTOP_ACTIVE_LINE_ANCHOR_RATIO,
  KARAOKE_LINE_ENTER_MS,
  KARAOKE_LINE_LIFT_PX,
  KARAOKE_MANUAL_SCROLL_PAUSE_MS,
""",
    'test constants imports',
)
old_test = """  it('uses a subtle fluid lift and a slower settled return', () => {
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
"""
new_test = """  it('raises a line once and keeps it elevated after release', () => {
    const { rerender } = renderPanel({
      mainLyric,
      audioInstance: { currentTime: 0.5, paused: true },
    })

    const group = screen.getByTestId('lyrics-line-group')
    const activeStyle = window.getComputedStyle(group)
    expect(group).toHaveAttribute('data-highlight-active', 'true')
    expect(group).toHaveAttribute('data-raised', 'true')
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
    expect(group).toHaveAttribute('data-raised', 'true')
    expect(releasedStyle.transform).toBe(
      `translateY(-${KARAOKE_LINE_LIFT_PX}px)`,
    )
  })

  it('lifts timed main and pronunciation graphemes with token progress', () => {
    renderPanel({
      mainLyric: tokenizedMainLyric,
      pronunciationLyric: tokenizedPronunciationLyric,
      showPronunciation: true,
      audioInstance: { currentTime: 0.25, paused: true },
    })

    const mainToken = screen.getAllByTestId('lyrics-token')[0]
    const pronunciationToken = screen.getAllByTestId(
      'lyrics-pronunciation-token',
    )[0]
    const mainCharacters = mainToken.querySelectorAll(
      '[data-lyrics-character="true"]',
    )
    const pronunciationCharacters = pronunciationToken.querySelectorAll(
      '[data-lyrics-character="true"]',
    )

    expect(mainCharacters).toHaveLength(4)
    expect(pronunciationCharacters).toHaveLength(4)
    expect(mainCharacters[0].style.transform).toBe(
      `translateY(-${KARAOKE_CHARACTER_LIFT_PX.toFixed(3)}px)`,
    )
    expect(mainCharacters[3].style.transform).not.toBe(
      mainCharacters[0].style.transform,
    )
    expect(pronunciationCharacters[0].style.transform).toBe(
      mainCharacters[0].style.transform,
    )
  })
"""
text = replace_once(text, old_test, new_test, 'persistent lift and character wave tests')
path.write_text(text)


# Update the phase 4 motion-profile test for the revised enter timing and new
# character-wave constants.
path = Path('ui/src/audioplayer/lyricsScroll.test.js')
text = path.read_text()
text = replace_once(
    text,
    """  KARAOKE_HIGHLIGHT_LEAD_MS,
  KARAOKE_LINE_ENTER_MS,
""",
    """  KARAOKE_CHARACTER_LIFT_PX,
  KARAOKE_CHARACTER_WAVE_WIDTH,
  KARAOKE_HIGHLIGHT_LEAD_MS,
  KARAOKE_LINE_ENTER_MS,
""",
    'motion profile character imports',
)
text = replace_once(
    text,
    """    expect(KARAOKE_SCROLL_ANIMATION_MS).toBe(300)
    expect(KARAOKE_LINE_ENTER_MS).toBe(180)
""",
    """    expect(KARAOKE_SCROLL_ANIMATION_MS).toBe(300)
    expect(KARAOKE_LINE_ENTER_MS).toBe(180)
    expect(KARAOKE_CHARACTER_LIFT_PX).toBe(1.4)
    expect(KARAOKE_CHARACTER_WAVE_WIDTH).toBe(0.28)
""",
    'motion profile character assertions',
)
path.write_text(text)
