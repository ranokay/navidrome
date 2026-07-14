from pathlib import Path


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f'{label}: expected one match, found {count}')
    return text.replace(old, new, 1)


path = Path('ui/src/audioplayer/useLyricsTimeline.js')
text = path.read_text()

text = replace_once(
    text,
    """const setGradientTokenColor = (record) => {
  record.node.style.color = 'transparent'
  record.node.style.webkitTextFillColor = 'transparent'
  record.node.style.backgroundImage = record.presentation.gradient
  record.node.style.backgroundSize = '100% 100%'
  record.node.style.backgroundClip = 'text'
  record.node.style.webkitBackgroundClip = 'text'
}

const applyTokenState = (record, state, progress = 0) => {
""",
    """const setGradientTokenColor = (record) => {
  record.node.style.color = 'transparent'
  record.node.style.webkitTextFillColor = 'transparent'
  record.node.style.backgroundImage = record.presentation.gradient
  record.node.style.backgroundSize = '100% 100%'
  record.node.style.backgroundClip = 'text'
  record.node.style.webkitBackgroundClip = 'text'
}

const getInactiveTokenOpacity = (presentation = {}) => {
  const activeAlpha = Math.max(0.001, presentation.activeAlpha ?? 1)
  return Math.min(
    1,
    Math.max(0, (presentation.futureAlpha ?? 0.34) / activeAlpha),
  )
}

const isGradientTokenState = (state) =>
  state === 'active' ||
  state === 'completed' ||
  state === 'release' ||
  state === 'inactive-past'

const applyTokenState = (record, state, progress = 0) => {
""",
    'gradient lifecycle helpers',
)

text = replace_once(
    text,
    """  if (state === 'active' || state === 'completed') {
    const wasGradientState =
      previousState === 'active' || previousState === 'completed'
    if (!wasGradientState) {
      setTokenOpacity(record, 1)
      setGradientTokenColor(record)
    }
    const nextProgress = state === 'completed' ? 1 : progress
    setProgress(record, nextProgress)
    setCharacterLift(record, nextProgress)
    return
  }

  setTokenOpacity(record, 1)

  setSolidTokenColor(record, presentation.futureColor || 'currentColor')
  setProgress(record, 0)
  setCharacterLift(record, state === 'inactive-past' ? 1 : 0)
""",
    """  if (state === 'active' || state === 'completed' || state === 'inactive-past') {
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
    'continuous inactive-past gradient state',
)

text = replace_once(
    text,
    """  const activeAlpha = Math.max(0.001, presentation.activeAlpha ?? 1)
  const targetOpacity = Math.min(
    1,
    Math.max(0, (presentation.futureAlpha ?? 0.34) / activeAlpha),
  )
  setTokenOpacity(record, 1 + (targetOpacity - 1) * nextProgress)
""",
    """  const targetOpacity = getInactiveTokenOpacity(presentation)
  setTokenOpacity(record, 1 + (targetOpacity - 1) * nextProgress)
""",
    'shared inactive opacity target',
)

path.write_text(text)


test_path = Path('ui/src/audioplayer/useLyricsTimeline.test.js')
tests = test_path.read_text()
marker = """  it('uses smooth subpixel character transforms for long token durations', () => {
"""
test = """  it('keeps gradient paint and opacity continuous when release becomes past', () => {
    const audio = createAudio({ currentTime: 0.25, paused: true })
    const { result } = renderHook(() =>
      useLyricsTimeline({
        lines,
        audioInstance: audio,
        visible: true,
        reducedMotion: false,
      }),
    )
    const tokenNode = document.createElement('span')
    Array.from('first').forEach((character) => {
      const node = document.createElement('span')
      node.dataset.lyricsCharacter = 'true'
      node.textContent = character
      tokenNode.appendChild(node)
    })

    act(() => {
      result.current.registerToken(
        '0:no-release-blink',
        {
          lineIndex: 0,
          window: { start: 0, end: 500 },
          presentation,
        },
        tokenNode,
      )
    })

    act(() => result.current.syncNow(600, true))
    const gradient = tokenNode.style.backgroundImage
    const releaseOpacity = tokenNode.style.opacity
    expect(tokenNode.dataset.lyricsState).toBe('release')
    expect(tokenNode.style.color).toBe('transparent')

    act(() => result.current.syncNow(800, true))

    expect(tokenNode.dataset.lyricsState).toBe('inactive-past')
    expect(tokenNode.style.backgroundImage).toBe(gradient)
    expect(tokenNode.style.color).toBe('transparent')
    expect(tokenNode.style.webkitTextFillColor).toBe('transparent')
    expect(tokenNode.style.opacity).toBe(releaseOpacity)
    expect(tokenNode.style.getPropertyValue('--lyrics-progress')).toBe('1')
  })

"""
tests = replace_once(tests, marker, test + marker, 'release-to-past continuity test')
test_path.write_text(tests)
