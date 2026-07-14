from pathlib import Path


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f'{label}: expected one match, found {count}')
    return text.replace(old, new, 1)


path = Path('ui/src/audioplayer/useLyricsTimeline.js')
text = path.read_text()
old = """  if (state === 'active') {
    if (previousState !== 'active') {
      setTokenOpacity(record, 1)
      setGradientTokenColor(record)
    }
    setProgress(record, progress)
    setCharacterLift(record, progress)
    return
  }

  setTokenOpacity(record, 1)
  if (state === 'completed') {
    setSolidTokenColor(record, presentation.doneColor || 'currentColor')
    setProgress(record, 1)
    setCharacterLift(record, 1)
    return
  }
"""
new = """  if (state === 'active' || state === 'completed') {
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
"""
text = replace_once(text, old, new, 'preserve completed gradient paint')
path.write_text(text)


path = Path('ui/src/audioplayer/useLyricsTimeline.test.js')
text = path.read_text()
marker = """  it('uses smooth subpixel character transforms for long token durations', () => {
"""
test = """  it('keeps the same gradient paint when an active word completes', () => {
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
        '0:stable-completion',
        {
          lineIndex: 0,
          window: { start: 0, end: 500 },
          presentation,
        },
        tokenNode,
      )
    })

    const activeBackground = tokenNode.style.backgroundImage
    expect(tokenNode.dataset.lyricsState).toBe('active')
    expect(tokenNode.style.color).toBe('transparent')

    act(() => result.current.syncNow(600, true))

    expect(tokenNode.dataset.lyricsState).toBe('completed')
    expect(tokenNode.style.backgroundImage).toBe(activeBackground)
    expect(tokenNode.style.color).toBe('transparent')
    expect(tokenNode.style.webkitTextFillColor).toBe('transparent')
    tokenNode
      .querySelectorAll('[data-lyrics-character="true"]')
      .forEach((character) =>
        expect(character.style.transform).toBe('translateY(-1.5000px)'),
      )
  })

"""
text = replace_once(text, marker, test + marker, 'completed paint regression test')
path.write_text(text)
