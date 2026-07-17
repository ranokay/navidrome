const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

export const lyricScrollTarget = (body, line, anchor) => {
  if (!body || !line) return 0
  const requested =
    line.offsetTop - body.clientHeight * anchor + line.offsetHeight / 2
  const maximum = Math.max(0, body.scrollHeight - body.clientHeight)
  return clamp(requested, 0, maximum)
}

export const easeLyricScroll = (progress) => {
  const clamped = clamp(progress, 0, 1)
  return 1 - (1 - clamped) ** 3
}

export class LyricScrollController {
  constructor({
    requestFrame = (callback) => requestAnimationFrame(callback),
    cancelFrame = (frame) => cancelAnimationFrame(frame),
    now = () => performance.now(),
  } = {}) {
    this.requestFrame = requestFrame
    this.cancelFrame = cancelFrame
    this.now = now
    this.frame = 0
  }

  get active() {
    return this.frame !== 0
  }

  cancel() {
    if (this.frame) this.cancelFrame(this.frame)
    this.frame = 0
  }

  scrollTo(body, target, { duration = 260, onWrite } = {}) {
    this.cancel()
    if (!body) return
    const maximum = Math.max(0, body.scrollHeight - body.clientHeight)
    const from = body.scrollTop
    const to = clamp(target, 0, maximum)
    const write = (value) => {
      onWrite?.(value)
      body.scrollTop = value
    }
    if (duration <= 0 || Math.abs(to - from) < 0.5) {
      write(to)
      return
    }
    const startedAt = this.now()
    const step = (timestamp) => {
      const progress = clamp((timestamp - startedAt) / duration, 0, 1)
      write(from + (to - from) * easeLyricScroll(progress))
      if (progress >= 1) {
        this.frame = 0
        return
      }
      this.frame = this.requestFrame(step)
    }
    this.frame = this.requestFrame(step)
  }
}
