from pathlib import Path


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f'{label}: expected one match, found {count}')
    return text.replace(old, new, 1)


# Keep timed tokens in the same clipped-gradient paint mode from future through
# past. At progress 0 the gradient is entirely the normal idle color; at
# progress 1 the active alpha variable controls release without element-opacity
# double dimming.
path = Path('ui/src/audioplayer/LyricsLineRows.jsx')
text = path.read_text()
text = replace_once(
    text,
    """  const futureColor = tokenColor(tonedRGB, TOKEN_FUTURE_ALPHA)
  const doneColor = tokenColor(tonedRGB, TOKEN_ACTIVE_ALPHA)
  const softColor = tokenColor(
""",
    """  const futureColor = tokenColor(tonedRGB, TOKEN_FUTURE_ALPHA)
  const doneColor = tokenColor(tonedRGB, TOKEN_ACTIVE_ALPHA)
  const gradientDoneColor = tokenColor(
    tonedRGB,
    'var(--lyrics-token-active-alpha, 1)',
  )
  const softColor = tokenColor(
""",
    'gradient active alpha color',
)
text = replace_once(
    text,
    """  const gradient = `linear-gradient(90deg, ${doneColor} 0%, ${doneColor} ${activeStop}, ${softColor} ${softStop}, ${futureColor} ${futureStop}, ${futureColor} 100%)`

  return {
    style: {
      '--lyrics-progress': 0,
      color: futureColor,
      WebkitTextFillColor: futureColor,
      backgroundImage: 'none',
      ...buildEmphasisStyle(token),
    },
""",
    """  const gradient = `linear-gradient(90deg, ${gradientDoneColor} 0%, ${gradientDoneColor} ${activeStop}, ${softColor} ${softStop}, ${futureColor} ${futureStop}, ${futureColor} 100%)`

  return {
    style: {
      '--lyrics-progress': 0,
      '--lyrics-token-active-alpha': TOKEN_ACTIVE_ALPHA,
      color: 'transparent',
      WebkitTextFillColor: 'transparent',
      backgroundImage: gradient,
      backgroundSize: '100% 100%',
      backgroundClip: 'text',
      WebkitBackgroundClip: 'text',
      ...buildEmphasisStyle(token),
    },
""",
    'single token paint mode',
)
path.write_text(text)


path = Path('ui/src/audioplayer/useLyricsTimeline.js')
text = path.read_text()
text = replace_once(
    text,
    """    const offset = -KARAOKE_CHARACTER_LIFT_PX * smootherStep(local)
    const nextTransform = `translateY(${offset.toFixed(4)}px)`
    if (node.style.transform !== nextTransform) {
      node.style.transform = nextTransform
    }
""",
    """    const lift = Math.max(
      0,
      Math.min(KARAOKE_CHARACTER_LIFT_PX, KARAOKE_CHARACTER_LIFT_PX * smootherStep(local)),
    )
    if (lift < 0.00005) {
      if (node.style.transform) node.style.removeProperty('transform')
      return
    }
    const nextTransform = `translateY(-${lift.toFixed(4)}px)`
    if (node.style.transform !== nextTransform) {
      node.style.transform = nextTransform
    }
""",
    'strictly upward character lift',
)
text = replace_once(
    text,
    """const setSolidTokenColor = (record, color) => {
  record.node.style.color = color
  record.node.style.webkitTextFillColor = color
  record.node.style.backgroundImage = 'none'
  record.node.style.backgroundClip = ''
  record.node.style.webkitBackgroundClip = ''
}

const setGradientTokenColor = (record) => {
""",
    """const setTokenActiveAlpha = (record, value) => {
  const next = Math.max(0, Math.min(1, value))
  if (
    record.activeAlpha != null &&
    Math.abs(record.activeAlpha - next) < 0.001
  )
    return
  record.activeAlpha = next
  record.node.style.setProperty('--lyrics-token-active-alpha', String(next))
}

const setGradientTokenColor = (record) => {
""",
    'token active alpha setter',
)
text = replace_once(
    text,
    """const getInactiveTokenOpacity = (presentation = {}) => {
  const activeAlpha = Math.max(0.001, presentation.activeAlpha ?? 1)
  return Math.min(
    1,
    Math.max(0, (presentation.futureAlpha ?? 0.34) / activeAlpha),
  )
}

const isGradientTokenState = (state) =>
  state === 'active' ||
""",
    """const getInactiveTokenAlpha = (presentation = {}) =>
  Math.min(1, Math.max(0, presentation.futureAlpha ?? 0.34))

const getActiveTokenAlpha = (presentation = {}) =>
  Math.min(1, Math.max(0, presentation.activeAlpha ?? 1))

const isGradientTokenState = (state) =>
  state === 'future' ||
  state === 'active' ||
""",
    'direct token alpha helpers',
)
text = replace_once(
    text,
    """  if (
    state === 'active' ||
    state === 'completed' ||
    state === 'inactive-past'
  ) {
    if (!isGradientTokenState(previousState)) {
      setGradientTokenColor(record)
    }
    const nextProgress = state === 'active' ? progress : 1
    setProgress(record, nextProgress)
    setCharacterLift(record, nextProgress)
    setTokenOpacity(
      record,
      state === 'inactive-past' ? getInactiveTokenOpacity(presentation) : 1,
    )
    return
  }

  setTokenOpacity(record, 1)
  setSolidTokenColor(record, presentation.futureColor || 'currentColor')
  setProgress(record, 0)
  setCharacterLift(record, 0)
""",
    """  if (!isGradientTokenState(previousState)) {
    setGradientTokenColor(record)
  }

  const isFuture = state === 'future'
  const isPast = state === 'inactive-past'
  const nextProgress = isFuture ? 0 : state === 'active' ? progress : 1
  setProgress(record, nextProgress)
  setCharacterLift(record, nextProgress)
  setTokenOpacity(record, 1)
  setTokenActiveAlpha(
    record,
    isPast
      ? getInactiveTokenAlpha(presentation)
      : getActiveTokenAlpha(presentation),
  )
""",
    'single token lifecycle paint path',
)
text = replace_once(
    text,
    """  const targetOpacity = getInactiveTokenOpacity(presentation)
  setTokenOpacity(record, 1 + (targetOpacity - 1) * nextProgress)
""",
    """  const activeAlpha = getActiveTokenAlpha(presentation)
  const targetAlpha = getInactiveTokenAlpha(presentation)
  setTokenOpacity(record, 1)
  setTokenActiveAlpha(
    record,
    activeAlpha + (targetAlpha - activeAlpha) * nextProgress,
  )
""",
    'release through gradient alpha',
)
text = replace_once(
    text,
    """        progress: null,
        opacity: null,
        state: null,
""",
    """        progress: null,
        opacity: null,
        activeAlpha: null,
        state: null,
""",
    'token active alpha cache',
)
path.write_text(text)


# Update the release continuity test for direct gradient alpha rather than
# element opacity, and add a regression for strictly one-way character motion.
path = Path('ui/src/audioplayer/useLyricsTimeline.test.js')
text = path.read_text()
text = replace_once(
    text,
    """    const gradient = tokenNode.style.backgroundImage
    const releaseOpacity = Number(tokenNode.style.opacity)
    expect(tokenNode.dataset.lyricsState).toBe('release')
    expect(tokenNode.style.color).toBe('transparent')

    act(() => result.current.syncNow(1220, true))

    const pastOpacity = Number(tokenNode.style.opacity)
    expect(tokenNode.dataset.lyricsState).toBe('inactive-past')
    expect(tokenNode.style.backgroundImage).toBe(gradient)
    expect(tokenNode.style.color).toBe('transparent')
    expect(tokenNode.style.webkitTextFillColor).toBe('transparent')
    expect(Math.abs(pastOpacity - releaseOpacity)).toBeLessThan(0.01)
    expect(pastOpacity).toBeCloseTo(presentation.futureAlpha, 5)
    expect(tokenNode.style.getPropertyValue('--lyrics-progress')).toBe('1')
""",
    """    const gradient = tokenNode.style.backgroundImage
    const releaseAlpha = Number(
      tokenNode.style.getPropertyValue('--lyrics-token-active-alpha'),
    )
    expect(tokenNode.dataset.lyricsState).toBe('release')
    expect(tokenNode.style.color).toBe('transparent')
    expect(tokenNode.style.opacity).toBe('1')

    act(() => result.current.syncNow(1220, true))

    const pastAlpha = Number(
      tokenNode.style.getPropertyValue('--lyrics-token-active-alpha'),
    )
    expect(tokenNode.dataset.lyricsState).toBe('inactive-past')
    expect(tokenNode.style.backgroundImage).toBe(gradient)
    expect(tokenNode.style.color).toBe('transparent')
    expect(tokenNode.style.webkitTextFillColor).toBe('transparent')
    expect(tokenNode.style.opacity).toBe('1')
    expect(Math.abs(pastAlpha - releaseAlpha)).toBeLessThan(0.01)
    expect(pastAlpha).toBeCloseTo(presentation.futureAlpha, 5)
    expect(tokenNode.style.getPropertyValue('--lyrics-progress')).toBe('1')
""",
    'release alpha continuity assertions',
)
marker = """  it('uses smooth subpixel character transforms for long token durations', () => {
"""
test = """  it('starts every character at rest and only moves it upward', () => {
    const audio = createAudio({ currentTime: 0.879, duration: 5, paused: true })
    const delayedLines = [
      {
        start: 0,
        end: 4000,
        tokens: [{ start: 1000, end: 4000, value: 'super' }],
      },
    ]
    const { result } = renderHook(() =>
      useLyricsTimeline({
        lines: delayedLines,
        audioInstance: audio,
        visible: true,
        reducedMotion: false,
      }),
    )
    const tokenNode = document.createElement('span')
    Array.from('super').forEach((character) => {
      const node = document.createElement('span')
      node.dataset.lyricsCharacter = 'true'
      node.textContent = character
      tokenNode.appendChild(node)
    })

    act(() => {
      result.current.registerToken(
        '0:one-way-rise',
        {
          lineIndex: 0,
          window: { start: 1000, end: 4000 },
          presentation,
        },
        tokenNode,
      )
    })

    const characters = Array.from(
      tokenNode.querySelectorAll('[data-lyrics-character="true"]'),
    )
    characters.forEach((character) => expect(character.style.transform).toBe(''))

    act(() => result.current.syncNow(900, true))

    expect(characters[0].style.transform).toMatch(
      /^translateY\(-\d+\.\d{4}px\)$/,
    )
    characters.slice(1).forEach((character) =>
      expect(character.style.transform).toBe(''),
    )
    characters.forEach((character) => {
      const offset = Number.parseFloat(
        character.style.transform.match(/-?\d+\.\d+/)?.[0] || '0',
      )
      expect(offset).toBeLessThanOrEqual(0)
    })
  })

"""
text = replace_once(text, marker, test + marker, 'one-way character motion test')
path.write_text(text)


# Verify the initial rendered token already uses the same gradient paint mode,
# avoiding an activation-time glyph repaint.
path = Path('ui/src/audioplayer/LyricsPanel.test.jsx')
text = path.read_text()
marker = """  it('uses only the per-character rise for token-timed lyrics', () => {
"""
test = """  it('renders future timed tokens with the same gradient paint mode', () => {
    renderPanel({
      mainLyric: tokenizedMainLyric,
      audioInstance: { currentTime: 0, paused: true },
    })

    const futureToken = screen.getAllByTestId('lyrics-token')[1]
    expect(futureToken).toHaveAttribute('data-lyrics-state', 'future')
    expect(futureToken.style.color).toBe('transparent')
    expect(futureToken.style.webkitTextFillColor).toBe('transparent')
    expect(futureToken.style.backgroundImage).not.toBe('none')
    expect(futureToken.style.opacity).toBe('1')
  })

"""
text = replace_once(text, marker, test + marker, 'initial gradient paint test')
path.write_text(text)
