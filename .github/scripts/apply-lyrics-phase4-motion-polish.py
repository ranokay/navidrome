from pathlib import Path


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f'{label}: expected one match, found {count}')
    return text.replace(old, new, 1)


constants_path = Path('ui/src/audioplayer/lyricsKaraokeConstants.js')
constants = constants_path.read_text()
constants = replace_once(
    constants,
    'export const KARAOKE_SCROLL_ANIMATION_MS = 260',
    'export const KARAOKE_SCROLL_ANIMATION_MS = 300',
    'scroll animation duration',
)
constants = replace_once(
    constants,
    'export const KARAOKE_LINE_ENTER_MS = 180',
    'export const KARAOKE_LINE_ENTER_MS = 100',
    'line enter duration',
)
constants_path.write_text(constants)


scroll_path = Path('ui/src/audioplayer/lyricsScroll.js')
scroll = scroll_path.read_text()
scroll = replace_once(
    scroll,
    """  const step = () => {
    const progress = clamp(
      (performance.now() - startedAt) / KARAOKE_SCROLL_ANIMATION_MS,
      0,
      1,
    )
    body.scrollTop = startTop + distance * easeInOut(progress)

    if (progress < 1) {
      animation.frameId = window.requestAnimationFrame(step)
      return
    }

    if (scrollAnimationRef.current === animation) {
      scrollAnimationRef.current = null
    }
  }
""",
    """  const step = () => {
    if (scrollAnimationRef.current !== animation) return

    const progress = clamp(
      (performance.now() - startedAt) / KARAOKE_SCROLL_ANIMATION_MS,
      0,
      1,
    )
    body.scrollTop =
      progress >= 1
        ? nextTargetTop
        : startTop + distance * easeInOut(progress)

    if (progress < 1) {
      animation.frameId = window.requestAnimationFrame(step)
      return
    }

    scrollAnimationRef.current = null
  }
""",
    'stale scroll frame guard',
)
scroll_path.write_text(scroll)


test_path = Path('ui/src/audioplayer/lyricsScroll.test.js')
tests = test_path.read_text()
tests = replace_once(
    tests,
    """import {
  animateScrollTop,
  cancelScrollAnimation,
  getAnchoredScrollTop,
  getScrollEndPadding,
} from './lyricsScroll'
""",
    """import {
  KARAOKE_HIGHLIGHT_LEAD_MS,
  KARAOKE_LINE_ENTER_MS,
  KARAOKE_SCROLL_ANIMATION_MS,
  KARAOKE_SCROLL_PRE_ROLL_MS,
} from './lyricsKaraokeConstants'
import {
  animateScrollTop,
  cancelScrollAnimation,
  getAnchoredScrollTop,
  getScrollEndPadding,
} from './lyricsScroll'
""",
    'scroll constants test imports',
)
marker = """  it('calculates end padding from the active-line anchor', () => {
"""
profile_test = """  it('uses the phase 4 motion timing profile', () => {
    expect(KARAOKE_HIGHLIGHT_LEAD_MS).toBe(120)
    expect(KARAOKE_SCROLL_PRE_ROLL_MS).toBe(320)
    expect(KARAOKE_SCROLL_ANIMATION_MS).toBe(300)
    expect(KARAOKE_LINE_ENTER_MS).toBe(100)
  })

"""
tests = replace_once(tests, marker, profile_test + marker, 'motion profile test')
old_test = """  it('keeps a newer animation when an older frame completes late', () => {
    const body = createScrollableBody()
    const scrollAnimationRef = { current: null }

    animateScrollTop({
      body,
      targetTop: 400,
      reducedMotion: false,
      scrollAnimationRef,
    })
    const firstAnimation = scrollAnimationRef.current

    animateScrollTop({
      body,
      targetTop: 500,
      reducedMotion: false,
      scrollAnimationRef,
    })
    const secondAnimation = scrollAnimationRef.current

    expect(secondAnimation).not.toBe(firstAnimation)

    now = 1000
    animationFrames[0]()

    expect(scrollAnimationRef.current).toBe(secondAnimation)

    animationFrames[1]()

    expect(body.scrollTop).toBe(500)
    expect(scrollAnimationRef.current).toBeNull()
  })
"""
new_test = """  it('ignores stale frames after a newer scroll animation starts', () => {
    const body = createScrollableBody()
    const scrollAnimationRef = { current: null }

    animateScrollTop({
      body,
      targetTop: 400,
      reducedMotion: false,
      scrollAnimationRef,
    })
    const firstAnimation = scrollAnimationRef.current

    animateScrollTop({
      body,
      targetTop: 500,
      reducedMotion: false,
      scrollAnimationRef,
    })
    const secondAnimation = scrollAnimationRef.current

    expect(secondAnimation).not.toBe(firstAnimation)

    now = KARAOKE_SCROLL_ANIMATION_MS / 2
    animationFrames[0]()

    expect(body.scrollTop).toBe(0)
    expect(scrollAnimationRef.current).toBe(secondAnimation)
    expect(animationFrames).toHaveLength(2)

    animationFrames[1]()

    expect(body.scrollTop).toBe(250)
    expect(scrollAnimationRef.current).toBe(secondAnimation)
    expect(animationFrames).toHaveLength(3)

    now = KARAOKE_SCROLL_ANIMATION_MS
    animationFrames[2]()

    expect(body.scrollTop).toBe(500)
    expect(scrollAnimationRef.current).toBeNull()
  })
"""
tests = replace_once(tests, old_test, new_test, 'stale scroll regression test')
test_path.write_text(tests)
