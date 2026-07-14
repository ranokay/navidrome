from pathlib import Path


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f'{label}: expected one match, found {count}')
    return text.replace(old, new, 1)


# Give each character a bounded rise time even when the containing word lasts
# several seconds. Short cues keep the existing proportional wave width.
path = Path('ui/src/audioplayer/lyricsKaraokeConstants.js')
text = path.read_text()
text = replace_once(
    text,
    "export const KARAOKE_CHARACTER_LIFT_PX = 1.5\nexport const KARAOKE_CHARACTER_WAVE_WIDTH = 0.42\n",
    "export const KARAOKE_CHARACTER_LIFT_PX = 1.5\nexport const KARAOKE_CHARACTER_RISE_MS = 260\nexport const KARAOKE_CHARACTER_WAVE_WIDTH = 0.42\n",
    'character rise duration constant',
)
path.write_text(text)


# Use compositor-friendly subpixel transforms rather than the layout-positioning
# `top` property, which visibly quantizes a 1.5px movement into only a few steps.
path = Path('ui/src/audioplayer/useLyricsTimeline.js')
text = path.read_text()
text = replace_once(
    text,
    """  KARAOKE_CHARACTER_LIFT_PX,
  KARAOKE_CHARACTER_WAVE_WIDTH,
""",
    """  KARAOKE_CHARACTER_LIFT_PX,
  KARAOKE_CHARACTER_RISE_MS,
  KARAOKE_CHARACTER_WAVE_WIDTH,
""",
    'character rise duration import',
)
old_lift = """const setCharacterLift = (record, progress) => {
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
new_lift = """const setCharacterLift = (record, progress) => {
  const characters = (record.characters || []).filter(
    (node) => node.dataset.whitespace !== 'true',
  )
  if (!characters.length) return

  const rawDuration = Number(record.window?.end) - Number(record.window?.start)
  const riseWindow =
    Number.isFinite(rawDuration) && rawDuration > 0
      ? Math.min(
          KARAOKE_CHARACTER_WAVE_WIDTH,
          KARAOKE_CHARACTER_RISE_MS / rawDuration,
        )
      : KARAOKE_CHARACTER_WAVE_WIDTH
  const count = characters.length
  const travel = Math.max(0, 1 - riseWindow)

  characters.forEach((node, index) => {
    const start = count <= 1 ? 0 : (index / (count - 1)) * travel
    const local = Math.max(
      0,
      Math.min(1, (progress - start) / Math.max(0.001, riseWindow)),
    )
    const offset = -KARAOKE_CHARACTER_LIFT_PX * smoothStep(local)
    const nextTransform = `translate3d(0, ${offset.toFixed(4)}px, 0)`
    if (node.style.transform !== nextTransform) {
      node.style.transform = nextTransform
    }
  })
}
"""
text = replace_once(text, old_lift, new_lift, 'compositor character lift')
path.write_text(text)


# Keep each grapheme's layout width fixed while only its painted position moves.
path = Path('ui/src/audioplayer/LyricsPanel.jsx')
text = path.read_text()
text = replace_once(
    text,
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
    """  waveCharacter: {
    display: 'inline-block',
    verticalAlign: 'baseline',
    transform: 'translate3d(0, 0, 0)',
    backfaceVisibility: 'hidden',
    willChange: 'transform',
    '@media (prefers-reduced-motion: reduce)': {
      transform: 'none !important',
      willChange: 'auto',
    },
  },
""",
    'compositor wave character style',
)
path.write_text(text)


# Update component assertions from layout top offsets to subpixel transforms.
path = Path('ui/src/audioplayer/LyricsPanel.test.jsx')
text = path.read_text()
text = replace_once(
    text,
    """    expect(firstCharacter.style.top).toBe(
      `-${KARAOKE_LINE_LIFT_PX.toFixed(3)}px`,
    )
""",
    """    expect(firstCharacter.style.transform).toBe(
      `translate3d(0, -${KARAOKE_LINE_LIFT_PX.toFixed(4)}px, 0)`,
    )
""",
    'character-only rise assertion',
)
text = replace_once(
    text,
    """    expect(mainCharacters[0].style.top).toBe(
      `-${KARAOKE_CHARACTER_LIFT_PX.toFixed(3)}px`,
    )
    expect(
      Number.parseFloat(mainCharacters[3].style.top || '0'),
    ).toBeGreaterThan(Number.parseFloat(mainCharacters[0].style.top))
    expect(pronunciationCharacters[0].style.top).toBe(
      mainCharacters[0].style.top,
    )
""",
    """    expect(mainCharacters[0].style.transform).toBe(
      `translate3d(0, -${KARAOKE_CHARACTER_LIFT_PX.toFixed(4)}px, 0)`,
    )
    expect(mainCharacters[3].style.transform).not.toBe(
      mainCharacters[0].style.transform,
    )
    expect(pronunciationCharacters[0].style.transform).toBe(
      mainCharacters[0].style.transform,
    )
""",
    'stacked wave transform assertions',
)
path.write_text(text)


# Lock down smooth, distinct subpixel updates for a four-second word.
path = Path('ui/src/audioplayer/useLyricsTimeline.test.js')
text = path.read_text()
text = replace_once(
    text,
    "import useLyricsTimeline from './useLyricsTimeline'\n",
    """import {
  KARAOKE_CHARACTER_RISE_MS,
  KARAOKE_CHARACTER_WAVE_WIDTH,
} from './lyricsKaraokeConstants'
import useLyricsTimeline from './useLyricsTimeline'
""",
    'wave test constants import',
)
marker = """  it('keeps interpolated playback time monotonic between coarse media updates', () => {
"""
test = """  it('uses smooth subpixel character transforms for long token durations', () => {
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
      expect(transform).toMatch(/^translate3d\(0, -?\d+\.\d{4}px, 0\)$/),
    )
    expect(KARAOKE_CHARACTER_RISE_MS).toBeLessThan(
      4000 * KARAOKE_CHARACTER_WAVE_WIDTH,
    )
  })

"""
text = replace_once(text, marker, test + marker, 'long token smoothness test')
path.write_text(text)
