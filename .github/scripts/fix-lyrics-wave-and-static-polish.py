from pathlib import Path


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f'{label}: expected one match, found {count}')
    return text.replace(old, new, 1)


# Broaden the character rise overlap so the motion travels continuously.
path = Path('ui/src/audioplayer/lyricsKaraokeConstants.js')
text = path.read_text()
text = replace_once(
    text,
    'export const KARAOKE_CHARACTER_WAVE_WIDTH = 0.28',
    'export const KARAOKE_CHARACTER_WAVE_WIDTH = 0.42',
    'character wave width',
)
path.write_text(text)


# Use relative top positioning instead of transforms. This keeps inline glyph
# layout stable and makes every character move only upward.
path = Path('ui/src/audioplayer/useLyricsTimeline.js')
text = path.read_text()
old = """const setCharacterLift = (record, progress) => {
  const characters = record.characters || []
  if (!characters.length) return
  const count = characters.length
  characters.forEach((node, index) => {
    if (node.dataset.whitespace === 'true') return
    const center = (index + 0.5) / count
    const start = Math.max(0, center - KARAOKE_CHARACTER_WAVE_WIDTH / 2)
    const end = Math.min(1, center + KARAOKE_CHARACTER_WAVE_WIDTH / 2)
    const local = Math.max(
      0,
      Math.min(1, (progress - start) / Math.max(0.001, end - start)),
    )
    const offset = -KARAOKE_CHARACTER_LIFT_PX * smoothStep(local)
    const nextTransform = `translateY(${offset.toFixed(3)}px)`
    if (node.style.transform !== nextTransform)
      node.style.transform = nextTransform
  })
}
"""
new = """const setCharacterLift = (record, progress) => {
  const characters = (record.characters || []).filter(
    (node) => node.dataset.whitespace !== 'true',
  )
  if (!characters.length) return
  const count = characters.length
  const travel = Math.max(0, 1 - KARAOKE_CHARACTER_WAVE_WIDTH)
  characters.forEach((node, index) => {
    const start = count <= 1 ? 0 : (index / (count - 1)) * travel
    const local = Math.max(
      0,
      Math.min(
        1,
        (progress - start) / Math.max(0.001, KARAOKE_CHARACTER_WAVE_WIDTH),
      ),
    )
    const offset = -KARAOKE_CHARACTER_LIFT_PX * smoothStep(local)
    const nextTop = `${offset.toFixed(3)}px`
    if (node.style.top !== nextTop) node.style.top = nextTop
  })
}
"""
text = replace_once(text, old, new, 'monotonic character wave')
path.write_text(text)


# Preserve natural inline spacing and avoid creating an inline-block for spaces.
path = Path('ui/src/audioplayer/LyricsLineRows.jsx')
text = path.read_text()
old = """const renderWaveText = (text, enabled, className) => {
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
"""
new = """const renderWaveText = (text, enabled, className) => {
  if (!enabled) return text
  return splitGraphemes(text).map((character, index) => {
    if (/^\\s+$/.test(character)) return character
    return (
      <span
        key={`${index}-${character}`}
        aria-hidden="true"
        className={className}
        data-lyrics-character="true"
      >
        {character}
      </span>
    )
  })
}
"""
text = replace_once(text, old, new, 'stable grapheme rendering')
path.write_text(text)


# Apply the wave class to every timed main/pronunciation rendering path, keep
# unsynced lyrics fully highlighted, avoid React/imperative lifecycle overlap,
# add hover affordance, and calculate bottom reading room for every lyric type.
path = Path('ui/src/audioplayer/LyricsPanel.jsx')
text = path.read_text()
text = replace_once(
    text,
    """    transform: 'translateY(0)',
    transition: 'none',
""",
    """    transform: 'translateY(0)',
    transition: `background-color 150ms ${KARAOKE_LINE_MOTION_EASING}`,
    '&[role="button"]:hover, &[role="button"]:focus-visible': {
      backgroundColor: colorWithAlpha(theme.palette.text.primary, 0.055),
    },
""",
    'clickable line hover',
)
text = replace_once(
    text,
    """      transition: `transform ${KARAOKE_LINE_ENTER_MS}ms ${KARAOKE_LINE_MOTION_EASING}`,
""",
    """      transition: `transform ${KARAOKE_LINE_ENTER_MS}ms ${KARAOKE_LINE_MOTION_EASING}, background-color 150ms ${KARAOKE_LINE_MOTION_EASING}`,
""",
    'raised line hover transition',
)
text = replace_once(
    text,
    """  waveCharacter: {
    display: 'inline-block',
    willChange: 'transform',
    transform: 'translateY(0)',
    '@media (prefers-reduced-motion: reduce)': {
      transform: 'none !important',
      willChange: 'auto',
    },
  },
""",
    """  waveCharacter: {
    position: 'relative',
    top: 0,
    display: 'inline',
    willChange: 'top',
    '@media (prefers-reduced-motion: reduce)': {
      top: '0 !important',
      willChange: 'auto',
    },
  },
""",
    'stable wave character style',
)
text = replace_once(
    text,
    """  token: {
    whiteSpace: 'pre-wrap',
    overflowWrap: 'anywhere',
  },
""",
    """  token: {
    whiteSpace: 'pre-wrap',
    overflowWrap: 'anywhere',
    fontKerning: 'none',
    fontVariantLigatures: 'none',
  },
""",
    'stable token spacing',
)
text = replace_once(
    text,
    """    if (!visible || !body || !hasTimedMainLines) {
      setScrollEndPadding(0)
      return
    }
""",
    """    if (!visible || !body) {
      setScrollEndPadding(0)
      return
    }
""",
    'bottom room for all lyric types',
)
text = replace_once(
    text,
    """    hasTimedMainLines,
    layoutVersion,
""",
    """    layoutVersion,
""",
    'remove timed padding dependency',
)
text = replace_once(
    text,
    """            const canSeekLine = Boolean(audioInstance && line.start != null)
            const isActiveLine = activeIndexSet.has(idx)
""",
    """            const canSeekLine = Boolean(audioInstance && line.start != null)
            const isActiveLine = activeIndexSet.has(idx)
            const isStaticLine = !hasTimedMainLines
""",
    'static line state',
)
text = replace_once(
    text,
    """                ref={(node) => registerLine(idx, node)}
                className={classes.lineGroup}
                data-active={isActiveLine ? 'true' : 'false'}
                data-lifecycle={isActiveLine ? 'active' : 'idle'}
                data-raised={isActiveLine ? 'true' : 'false'}
""",
    """                ref={
                  hasTimedMainLines ? (node) => registerLine(idx, node) : undefined
                }
                className={classes.lineGroup}
                data-active={isStaticLine || isActiveLine ? 'true' : 'false'}
                {...(isStaticLine
                  ? {
                      'data-lifecycle': 'active',
                      'data-highlight-active': 'true',
                      'data-raised': 'false',
                    }
                  : {})}
""",
    'single lifecycle owner and static highlight',
)
# Four rendering paths previously did not all receive the wave class.
text = replace_once(
    text,
    """                          tokenClassName={classes.token}
                          classes={classes}
""",
    """                          tokenClassName={classes.token}
                          waveCharacterClassName={classes.waveCharacter}
                          classes={classes}
""",
    'multi-lane stacked wave prop',
)
text = replace_once(
    text,
    """                    tokenClassName={classes.token}
                    classes={classes}
""",
    """                    tokenClassName={classes.token}
                    waveCharacterClassName={classes.waveCharacter}
                    classes={classes}
""",
    'stacked wave prop',
)
text = replace_once(
    text,
    """                    tokenClassName={classes.token}
                    registerToken={registerToken}
                    rowKey="main"
""",
    """                    tokenClassName={classes.token}
                    waveCharacterClassName={classes.waveCharacter}
                    registerToken={registerToken}
                    rowKey="main"
""",
    'plain main wave prop',
)
path.write_text(text)


# Regression tests for all rendering paths, monotonic top motion, static
# highlighting, and untimed bottom room.
path = Path('ui/src/audioplayer/LyricsPanel.test.jsx')
text = path.read_text()
text = replace_once(
    text,
    """    expect(mainCharacters[0].style.transform).toBe(
      `translateY(-${KARAOKE_CHARACTER_LIFT_PX.toFixed(3)}px)`,
    )
    expect(mainCharacters[3].style.transform).not.toBe(
      mainCharacters[0].style.transform,
    )
    expect(pronunciationCharacters[0].style.transform).toBe(
      mainCharacters[0].style.transform,
    )
""",
    """    expect(mainCharacters[0].style.top).toBe(
      `-${KARAOKE_CHARACTER_LIFT_PX.toFixed(3)}px`,
    )
    expect(Number.parseFloat(mainCharacters[3].style.top || '0')).toBeGreaterThan(
      Number.parseFloat(mainCharacters[0].style.top),
    )
    expect(pronunciationCharacters[0].style.top).toBe(
      mainCharacters[0].style.top,
    )
""",
    'wave top assertions',
)
marker = """  it('uses the same active and release lifecycle for all line-level layers', () => {
"""
new_test = """  it('applies the character wave to ordinary timed lyrics without pronunciation', () => {
    renderPanel({
      mainLyric: tokenizedMainLyric,
      audioInstance: { currentTime: 0.25, paused: true },
    })

    const tokens = screen.getAllByTestId('lyrics-token')
    expect(
      tokens[0].querySelectorAll('[data-lyrics-character="true"]'),
    ).toHaveLength(4)
    expect(
      tokens[1].querySelectorAll('[data-lyrics-character="true"]'),
    ).toHaveLength(4)
  })

"""
text = replace_once(text, marker, new_test + marker, 'ordinary timed wave test')
text = replace_once(
    text,
    """    groups.forEach((group) => {
      expect(group).toHaveAttribute('data-active', 'false')
      expect(group).not.toHaveAttribute('aria-current')
      expect(group).toHaveAttribute('data-scroll-target', 'false')
    })
""",
    """    groups.forEach((group) => {
      expect(group).toHaveAttribute('data-active', 'true')
      expect(group).toHaveAttribute('data-lifecycle', 'active')
      expect(group).toHaveAttribute('data-highlight-active', 'true')
      expect(group).not.toHaveAttribute('aria-current')
      expect(group).toHaveAttribute('data-scroll-target', 'false')
    })
""",
    'unsynced highlighted assertions',
)
old = """      expect(lines).toHaveAttribute('data-scroll-end-padding', '290')
    } finally {
"""
new = """      expect(lines).toHaveAttribute('data-scroll-end-padding', '290')
      unmount()

      renderPanel({
        mainLyric: {
          synced: false,
          line: [{ value: 'Plain first line' }, { value: 'Plain last line' }],
        },
      })
      lines = screen
        .getByTestId('lyrics-scroll-body')
        .querySelector('[data-scroll-end-padding]')
      expect(lines).toHaveAttribute(
        'data-scroll-end-padding',
        String(expectedDesktop),
      )
    } finally {
"""
text = replace_once(text, old, new, 'untimed bottom room test')
path.write_text(text)
