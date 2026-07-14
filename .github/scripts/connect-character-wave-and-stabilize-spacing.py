from pathlib import Path


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f'{label}: expected one match, found {count}')
    return text.replace(old, new, 1)


# Replace the fixed rise-duration model with an overlapping stagger. A value of
# 0.75 means the next character begins after the previous character has
# completed 75% of its rise, producing a connected wave without simultaneous
# movement.
path = Path('ui/src/audioplayer/lyricsKaraokeConstants.js')
text = path.read_text()
text = replace_once(
    text,
    "export const KARAOKE_CHARACTER_LIFT_PX = 1.5\nexport const KARAOKE_CHARACTER_RISE_MS = 260\nexport const KARAOKE_CHARACTER_WAVE_WIDTH = 0.42\n",
    "export const KARAOKE_CHARACTER_LIFT_PX = 1.5\nexport const KARAOKE_CHARACTER_STAGGER_RATIO = 0.75\nexport const KARAOKE_CHARACTER_WAVE_WIDTH = 0.42\n",
    'connected wave constant',
)
path.write_text(text)


path = Path('ui/src/audioplayer/useLyricsTimeline.js')
text = path.read_text()
text = replace_once(
    text,
    """  KARAOKE_CHARACTER_LIFT_PX,
  KARAOKE_CHARACTER_RISE_MS,
  KARAOKE_CHARACTER_WAVE_WIDTH,
""",
    """  KARAOKE_CHARACTER_LIFT_PX,
  KARAOKE_CHARACTER_STAGGER_RATIO,
  KARAOKE_CHARACTER_WAVE_WIDTH,
""",
    'connected wave import',
)
text = replace_once(
    text,
    "const smoothStep = (value) => value * value * (3 - 2 * value)\n",
    """const smootherStep = (value) =>
  value * value * value * (value * (value * 6 - 15) + 10)
""",
    'smoother wave easing',
)
old_lift = """const setCharacterLift = (record, progress) => {
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
new_lift = """const setCharacterLift = (record, progress) => {
  const characters = (record.characters || []).filter(
    (node) => node.dataset.whitespace !== 'true',
  )
  if (!characters.length) return

  const count = characters.length
  const connectedSpan =
    1 + Math.max(0, count - 1) * KARAOKE_CHARACTER_STAGGER_RATIO
  const riseWindow =
    count <= 1
      ? 1
      : Math.min(
          KARAOKE_CHARACTER_WAVE_WIDTH,
          1 / Math.max(1, connectedSpan),
        )
  const stagger = riseWindow * KARAOKE_CHARACTER_STAGGER_RATIO

  characters.forEach((node, index) => {
    const start = index * stagger
    const local = Math.max(
      0,
      Math.min(1, (progress - start) / Math.max(0.001, riseWindow)),
    )
    const offset = -KARAOKE_CHARACTER_LIFT_PX * smootherStep(local)
    const nextTransform = `translateY(${offset.toFixed(4)}px)`
    if (node.style.transform !== nextTransform) {
      node.style.transform = nextTransform
    }
  })
}
"""
text = replace_once(text, old_lift, new_lift, 'connected compositor wave')
path.write_text(text)


# A 2D vertical transform avoids the glyph rerasterization and apparent
# horizontal spacing changes produced by individually promoted 3D layers.
path = Path('ui/src/audioplayer/LyricsPanel.jsx')
text = path.read_text()
text = replace_once(
    text,
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
    """  waveCharacter: {
    display: 'inline-block',
    verticalAlign: 'baseline',
    transform: 'translateY(0)',
    transformOrigin: 'center bottom',
    '@media (prefers-reduced-motion: reduce)': {
      transform: 'none !important',
    },
  },
""",
    'stable 2D character transform',
)
path.write_text(text)


# Update component assertions for the stable 2D transform.
path = Path('ui/src/audioplayer/LyricsPanel.test.jsx')
text = path.read_text()
text = text.replace(
    "`translate3d(0, -${KARAOKE_LINE_LIFT_PX.toFixed(4)}px, 0)`",
    "`translateY(-${KARAOKE_LINE_LIFT_PX.toFixed(4)}px)`",
)
text = text.replace(
    "`translate3d(0, -${KARAOKE_CHARACTER_LIFT_PX.toFixed(4)}px, 0)`",
    "`translateY(-${KARAOKE_CHARACTER_LIFT_PX.toFixed(4)}px)`",
)
path.write_text(text)


# Validate both smooth subpixel updates and the overlap between adjacent
# characters on a long token.
path = Path('ui/src/audioplayer/useLyricsTimeline.test.js')
text = path.read_text()
text = replace_once(
    text,
    """import {
  KARAOKE_CHARACTER_RISE_MS,
  KARAOKE_CHARACTER_WAVE_WIDTH,
} from './lyricsKaraokeConstants'
""",
    """import {
  KARAOKE_CHARACTER_STAGGER_RATIO,
  KARAOKE_CHARACTER_WAVE_WIDTH,
} from './lyricsKaraokeConstants'
""",
    'connected wave test import',
)
text = replace_once(
    text,
    """    transforms.forEach((transform) =>
      expect(transform).toMatch(/^translate3d\(0, -?\d+\.\d{4}px, 0\)$/),
    )
    expect(KARAOKE_CHARACTER_RISE_MS).toBeLessThan(
      4000 * KARAOKE_CHARACTER_WAVE_WIDTH,
    )
""",
    """    transforms.forEach((transform) =>
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
""",
    'connected wave assertions',
)
path.write_text(text)
