import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  KARAOKE_HIGHLIGHT_LEAD_MS,
  KARAOKE_LINE_ENTER_MS,
  KARAOKE_LINE_LIFT_PX,
  KARAOKE_LINE_MOTION_RELEASE_MS,
  KARAOKE_SCROLL_ANIMATION_MS,
  KARAOKE_SCROLL_PRE_ROLL_MS,
} from './lyricsKaraokeConstants'
import {
  animateScrollTop,
  cancelScrollAnimation,
  getAnchoredScrollTop,
  getScrollEndPadding,
} from './lyricsScroll'

const createScrollableBody = (scrollTop = 0) => ({
  clientHeight: 200,
  scrollHeight: 1000,
  scrollTop,
})

describe('lyrics scroll helpers', () => {
  let animationFrames
  let now

  beforeEach(() => {
    animationFrames = []
    now = 0
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      animationFrames.push(callback)
      return animationFrames.length
    })
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('uses the phase 4 motion timing profile', () => {
    expect(KARAOKE_HIGHLIGHT_LEAD_MS).toBe(120)
    expect(KARAOKE_SCROLL_PRE_ROLL_MS).toBe(320)
    expect(KARAOKE_SCROLL_ANIMATION_MS).toBe(300)
    expect(KARAOKE_LINE_ENTER_MS).toBe(180)
    expect(KARAOKE_LINE_MOTION_RELEASE_MS).toBe(280)
    expect(KARAOKE_LINE_LIFT_PX).toBe(1.5)
  })

  it('calculates end padding from the active-line anchor', () => {
    expect(getScrollEndPadding({ clientHeight: 500 }, 0.42)).toBe(290)
    expect(getScrollEndPadding({ clientHeight: 200 }, 0.5)).toBe(100)
    expect(getScrollEndPadding({ clientHeight: 0 }, 0.5)).toBe(0)
    expect(getScrollEndPadding(null, 0.5)).toBe(0)
  })

  it('anchors a target relative to the current scroll position', () => {
    const body = {
      ...createScrollableBody(120),
      getBoundingClientRect: () => ({ top: 50 }),
    }
    const target = {
      getBoundingClientRect: () => ({ top: 310 }),
    }

    // 120 + (310 - 50 - 200 * 0.4) = 300
    expect(getAnchoredScrollTop(body, target, 0.4)).toBe(300)
  })

  it('clamps anchored targets to the scrollable range', () => {
    const body = {
      ...createScrollableBody(20),
      getBoundingClientRect: () => ({ top: 100 }),
    }
    const above = {
      getBoundingClientRect: () => ({ top: -500 }),
    }
    const below = {
      getBoundingClientRect: () => ({ top: 5000 }),
    }

    expect(getAnchoredScrollTop(body, above, 0.4)).toBe(0)
    expect(getAnchoredScrollTop(body, below, 0.4)).toBe(800)
  })

  it('stores a cancellable frame while animating scroll position', () => {
    const body = createScrollableBody()
    const scrollAnimationRef = { current: null }
    window.requestAnimationFrame.mockImplementationOnce((callback) => {
      animationFrames.push(callback)
      return 0
    })

    animateScrollTop({
      body,
      targetTop: 400,
      reducedMotion: false,
      scrollAnimationRef,
    })

    expect(scrollAnimationRef.current?.frameId).toBe(0)

    cancelScrollAnimation(scrollAnimationRef)

    expect(window.cancelAnimationFrame).toHaveBeenCalledWith(0)
    expect(scrollAnimationRef.current).toBeNull()
  })

  it('updates scroll position immediately when reduced motion is enabled', () => {
    const body = createScrollableBody()
    const scrollAnimationRef = { current: null }

    animateScrollTop({
      body,
      targetTop: 400,
      reducedMotion: true,
      scrollAnimationRef,
    })

    expect(body.scrollTop).toBe(400)
    expect(window.requestAnimationFrame).not.toHaveBeenCalled()
    expect(scrollAnimationRef.current).toBeNull()
  })

  it('skips tiny scroll adjustments within the settle distance', () => {
    const body = createScrollableBody()
    const scrollAnimationRef = { current: null }

    animateScrollTop({
      body,
      targetTop: 1,
      reducedMotion: false,
      scrollAnimationRef,
    })

    expect(body.scrollTop).toBe(0)
    expect(window.requestAnimationFrame).not.toHaveBeenCalled()
    expect(scrollAnimationRef.current).toBeNull()
  })

  it('clears the current animation after natural completion', () => {
    const body = createScrollableBody()
    const scrollAnimationRef = { current: null }

    animateScrollTop({
      body,
      targetTop: 400,
      reducedMotion: false,
      scrollAnimationRef,
    })

    now = 1000
    animationFrames[0]()

    expect(body.scrollTop).toBe(400)
    expect(scrollAnimationRef.current).toBeNull()
  })

  it('ignores stale frames after a newer scroll animation starts', () => {
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
})
