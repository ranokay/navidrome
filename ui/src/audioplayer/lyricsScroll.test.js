import { describe, expect, it, vi } from 'vitest'
import {
  LyricScrollController,
  easeLyricScroll,
  lyricScrollTarget,
} from './lyricsScroll'

const geometry = ({
  clientHeight = 200,
  offsetHeight = 40,
  offsetTop = 500,
  scrollHeight = 1200,
} = {}) => ({
  body: { clientHeight, scrollHeight, scrollTop: 0 },
  line: { offsetHeight, offsetTop },
})

describe('lyricScrollTarget', () => {
  it('anchors different-height lines and clamps the beginning and end', () => {
    const middle = geometry()
    expect(lyricScrollTarget(middle.body, middle.line, 0.38)).toBe(444)

    const beginning = geometry({ offsetTop: 10 })
    expect(lyricScrollTarget(beginning.body, beginning.line, 0.38)).toBe(0)

    const end = geometry({ offsetTop: 1190, offsetHeight: 80 })
    expect(lyricScrollTarget(end.body, end.line, 0.38)).toBe(1000)
  })
})

describe('LyricScrollController', () => {
  it('runs one cancellable eased transition and supports immediate seeks', () => {
    let now = 0
    let nextFrame = 0
    const callbacks = new Map()
    const controller = new LyricScrollController({
      now: () => now,
      requestFrame: (callback) => {
        const id = ++nextFrame
        callbacks.set(id, callback)
        return id
      },
      cancelFrame: (id) => callbacks.delete(id),
    })
    const { body } = geometry()
    const write = vi.fn()
    controller.scrollTo(body, 500, { duration: 260, onWrite: write })
    expect(controller.active).toBe(true)
    expect(callbacks.size).toBe(1)

    const runFrame = (time) => {
      now = time
      const [id, callback] = callbacks.entries().next().value
      callbacks.delete(id)
      callback(time)
    }
    runFrame(130)
    expect(body.scrollTop).toBeCloseTo(437.5)
    expect(controller.active).toBe(true)

    controller.cancel()
    expect(controller.active).toBe(false)
    expect(callbacks.size).toBe(0)

    controller.scrollTo(body, 100, { duration: 0, onWrite: write })
    expect(body.scrollTop).toBe(100)
    expect(controller.active).toBe(false)
    expect(write).toHaveBeenCalled()
  })

  it('uses a monotonic easing function', () => {
    const samples = [0, 0.25, 0.5, 0.75, 1].map(easeLyricScroll)
    expect(samples[0]).toBe(0)
    expect(samples.at(-1)).toBe(1)
    expect(samples).toEqual([...samples].sort((left, right) => left - right))
  })
})
