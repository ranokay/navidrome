from pathlib import Path


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f'{label}: expected one match, found {count}')
    return text.replace(old, new, 1)


# Replace duration-proportional stagger constants with a bounded phase-wave profile.
path = Path('ui/src/audioplayer/lyricsKaraokeConstants.js')
text = path.read_text()
text = replace_once(
    text,
    """export const KARAOKE_CHARACTER_LIFT_PX = 1.5
export const KARAOKE_CHARACTER_STAGGER_RATIO = 0.75
export const KARAOKE_CHARACTER_WAVE_WIDTH = 0.42
""",
    """export const KARAOKE_CHARACTER_LIFT_PX = 1.5
export const KARAOKE_CHARACTER_WAVE_DURATION_MS = 480
export const KARAOKE_CHARACTER_PHASE_SPREAD = 0.36
""",
    'phase wave constants',
)
path.write_text(text)


# All characters now derive their position from one bounded wave clock. Their
# phase offsets overlap heavily, producing a simultaneous progressive wave
# instead of stretching each 1.5px rise across a long token duration.
path = Path('ui/src/audioplayer/useLyricsTimeline.js')
text = path.read_text()
text = replace_once(
    text,
    """  KARAOKE_CHARACTER_LIFT_PX,
  KARAOKE_CHARACTER_STAGGER_RATIO,
  KARAOKE_CHARACTER_WAVE_WIDTH,
""",
    """  KARAOKE_CHARACTER_LIFT_PX,
  KARAOKE_CHARACTER_PHASE_SPREAD,
  KARAOKE_CHARACTER_WAVE_DURATION_MS,
""",
    'phase wave imports',
)
old = """  const count = characters.length
  const connectedSpan =
    1 + Math.max(0, count - 1) * KARAOKE_CHARACTER_STAGGER_RATIO
  const riseWindow =
    count <= 1
      ? 1
      : Math.min(KARAOKE_CHARACTER_WAVE_WIDTH, 1 / Math.max(1, connectedSpan))
  const stagger = riseWindow * KARAOKE_CHARACTER_STAGGER_RATIO

  characters.forEach((node, index) => {
    const start = index * stagger
    const local = Math.max(
      0,
      Math.min(1, (progress - start) / Math.max(0.001, riseWindow)),
    )
"""
new = """  const rawDuration = Number(record.window?.end) - Number(record.window?.start)
  const tokenDuration =
    Number.isFinite(rawDuration) && rawDuration > 0
      ? rawDuration
      : KARAOKE_CHARACTER_WAVE_DURATION_MS
  const waveDuration = Math.min(
    tokenDuration,
    KARAOKE_CHARACTER_WAVE_DURATION_MS,
  )
  const elapsed = Math.max(0, Math.min(tokenDuration, progress * tokenDuration))
  const waveProgress = Math.max(
    0,
    Math.min(1, elapsed / Math.max(1, waveDuration)),
  )
  const count = characters.length
  const phaseSpread = count <= 1 ? 0 : KARAOKE_CHARACTER_PHASE_SPREAD
  const riseSpan = Math.max(0.001, 1 - phaseSpread)

  characters.forEach((node, index) => {
    const phase =
      count <= 1 ? 0 : (index / Math.max(1, count - 1)) * phaseSpread
    const local = Math.max(0, Math.min(1, (waveProgress - phase) / riseSpan))
"""
text = replace_once(text, old, new, 'bounded phase wave')
path.write_text(text)


# Update tests to validate a fast, concurrent phase wave on a four-second word.
path = Path('ui/src/audioplayer/useLyricsTimeline.test.js')
text = path.read_text()
text = replace_once(
    text,
    """import {
  KARAOKE_CHARACTER_STAGGER_RATIO,
  KARAOKE_CHARACTER_WAVE_WIDTH,
} from './lyricsKaraokeConstants'
""",
    """import {
  KARAOKE_CHARACTER_LIFT_PX,
  KARAOKE_CHARACTER_PHASE_SPREAD,
  KARAOKE_CHARACTER_WAVE_DURATION_MS,
} from './lyricsKaraokeConstants'
""",
    'phase wave test imports',
)
old_test = """  it('uses smooth subpixel character transforms for long token durations', () => {
    const audio = createAudio({ currentTime: 1, duration: 5, paused: true })
    const longLines = [
      {
        start: 0,
        end: 4000,
        tokens: [{ start: 0, end: 4000, value: 'super' }],
      },
    ]
    const { result } = renderHook(() =>
      useLyricsTimeline({
        lines: longLines,
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
        '0:long-word',
        {
          lineIndex: 0,
          window: { start: 0, end: 4000 },
          presentation,
        },
        tokenNode,
      )
    })

    const character = tokenNode.querySelectorAll(
      '[data-lyrics-character="true"]',
    )[1]
    const transforms = []
    ;[1000, 1016, 1032, 1048].forEach((time) => {
      act(() => result.current.syncNow(time, true))
      transforms.push(character.style.transform)
    })

    expect(new Set(transforms).size).toBe(transforms.length)
    transforms.forEach((transform) =>
      expect(transform).toMatch(/^translateY\(-?\d+\.\d{4}px\)$/),
    )
    expect(KARAOKE_CHARACTER_STAGGER_RATIO).toBeGreaterThan(0.5)
    expect(KARAOKE_CHARACTER_STAGGER_RATIO).toBeLessThan(1)

    act(() => result.current.syncNow(650, true))
    const characters = tokenNode.querySelectorAll(
      '[data-lyrics-character="true"]',
    )
    const firstOffset = Number.parseFloat(
      characters[0].style.transform.match(/-?\d+\.\d+/)?.[0] || '0',
    )
    const secondOffset = Number.parseFloat(
      characters[1].style.transform.match(/-?\d+\.\d+/)?.[0] || '0',
    )
    expect(firstOffset).toBeLessThan(-1)
    expect(secondOffset).toBeLessThan(0)
    expect(secondOffset).toBeGreaterThan(firstOffset)
  })
"""
new_test = """  it('uses a bounded concurrent phase wave for long token durations', () => {
    const audio = createAudio({ currentTime: 0, duration: 5, paused: true })
    const longLines = [
      {
        start: 0,
        end: 4000,
        tokens: [{ start: 0, end: 4000, value: 'super' }],
      },
    ]
    const { result } = renderHook(() =>
      useLyricsTimeline({
        lines: longLines,
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
        '0:long-word',
        {
          lineIndex: 0,
          window: { start: 0, end: 4000 },
          presentation,
        },
        tokenNode,
      )
    })

    const characters = Array.from(
      tokenNode.querySelectorAll('[data-lyrics-character="true"]'),
    )
    const firstTransforms = []
    ;[0, 16, 32, 48].forEach((time) => {
      act(() => result.current.syncNow(time, true))
      firstTransforms.push(characters[0].style.transform)
    })

    expect(new Set(firstTransforms).size).toBe(firstTransforms.length)
    firstTransforms.forEach((transform) =>
      expect(transform).toMatch(/^translateY\(-\d+\.\d{4}px\)$/),
    )

    act(() => result.current.syncNow(120, true))
    const offsets = characters.map((character) =>
      Math.abs(
        Number.parseFloat(
          character.style.transform.match(/-?\d+\.\d+/)?.[0] || '0',
        ),
      ),
    )
    expect(offsets.filter((offset) => offset > 0)).toHaveLength(5)
    expect(offsets[0]).toBeGreaterThan(offsets[1])
    expect(offsets[1]).toBeGreaterThan(offsets[2])
    expect(offsets[2]).toBeGreaterThan(offsets[3])
    expect(offsets[3]).toBeGreaterThan(offsets[4])

    act(() => result.current.syncNow(KARAOKE_CHARACTER_WAVE_DURATION_MS, true))
    characters.forEach((character) =>
      expect(character.style.transform).toBe(
        `translateY(-${KARAOKE_CHARACTER_LIFT_PX.toFixed(4)}px)`,
      ),
    )
    expect(KARAOKE_CHARACTER_PHASE_SPREAD).toBeGreaterThan(0)
    expect(KARAOKE_CHARACTER_PHASE_SPREAD).toBeLessThan(0.5)
  })
"""
text = replace_once(text, old_test, new_test, 'long word phase wave test')
path.write_text(text)
