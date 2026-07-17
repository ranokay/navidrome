const upperBound = (items, time, getTime) => {
  let low = 0
  let high = items.length
  while (low < high) {
    const middle = (low + high) >>> 1
    if (getTime(items[middle]) <= time) low = middle + 1
    else high = middle
  }
  return low
}

const sameIndexes = (left, right) =>
  left.length === right.length &&
  left.every((value, index) => value === right[index])

export class LyricTimelineCursor {
  constructor(document) {
    this.document = document
    this.eventIndex = 0
    this.active = new Set()
    this.lastTime = -Infinity
    this.lastIndexes = []
    this.result = {
      indexes: this.lastIndexes,
      changed: false,
      primaryIndex: -1,
    }
    this.operations = 0
    this.seekOperations = 0
  }

  reset(document = this.document) {
    this.document = document
    this.eventIndex = 0
    this.active.clear()
    this.lastTime = -Infinity
    this.lastIndexes = []
    this.result.indexes = this.lastIndexes
    this.result.changed = false
    this.result.primaryIndex = -1
  }

  applyEvent(event) {
    this.operations += 1
    if (event.type === 'start') this.active.add(event.lineIndex)
    else this.active.delete(event.lineIndex)
  }

  seek(time) {
    const timeline = this.document?.timeline
    const events = timeline?.events || []
    const checkpoints = timeline?.checkpoints || []
    const checkpointIndex =
      upperBound(checkpoints, time, (item) => item.time) - 1
    const checkpoint =
      checkpointIndex >= 0 ? checkpoints[checkpointIndex] : null
    this.active = new Set(checkpoint?.active || [])
    this.eventIndex = checkpoint?.eventIndex || 0
    this.seekOperations = 0
    while (
      this.eventIndex < events.length &&
      events[this.eventIndex].time <= time
    ) {
      this.applyEvent(events[this.eventIndex])
      this.eventIndex += 1
      this.seekOperations += 1
    }
  }

  update(time, forceSeek = false) {
    const timeline = this.document?.timeline
    const events = timeline?.events || []
    const previousEventIndex = this.eventIndex
    if (forceSeek || time < this.lastTime) {
      this.seek(time)
    } else {
      while (
        this.eventIndex < events.length &&
        events[this.eventIndex].time <= time
      ) {
        this.applyEvent(events[this.eventIndex])
        this.eventIndex += 1
      }
    }
    this.lastTime = time
    if (!forceSeek && previousEventIndex === this.eventIndex) {
      this.result.changed = false
      return this.result
    }
    const indexes = Array.from(this.active).sort((a, b) => a - b)
    const changed = !sameIndexes(indexes, this.lastIndexes)
    this.lastIndexes = indexes
    this.result.indexes = indexes
    this.result.changed = changed
    this.result.primaryIndex = indexes.at(-1) ?? -1
    return this.result
  }
}

export class LyricQualityMonitor {
  constructor(reducedMotion = false) {
    this.level = reducedMotion ? 'reduced-motion' : 'full'
    this.lastPublished = this.level
    this.samples = []
    this.slowFrames = []
    this.slowFrameCount = 0
    this.cadence = null
    this.stableFrames = 0
  }

  record(delta) {
    if (
      this.level === 'reduced-motion' ||
      !Number.isFinite(delta) ||
      delta <= 0
    ) {
      return this.level
    }
    if (this.cadence == null) {
      this.samples.push(delta)
      if (this.samples.length === 60) {
        const sorted = [...this.samples].sort((a, b) => a - b)
        this.cadence = sorted[Math.floor(sorted.length / 2)]
      }
      return this.level
    }
    const slow = delta > this.cadence * 1.5
    this.slowFrames.push(slow)
    if (slow) this.slowFrameCount += 1
    if (this.slowFrames.length > 120) {
      if (this.slowFrames.shift()) this.slowFrameCount -= 1
    }
    const slowRatio = this.slowFrameCount / this.slowFrames.length
    if (this.slowFrames.length === 120 && slowRatio > 0.1) {
      this.level = this.level === 'full' ? 'reduced' : 'minimal'
      this.stableFrames = 0
      this.slowFrames = []
      this.slowFrameCount = 0
      return this.level
    }
    if (slowRatio < 0.02) this.stableFrames += 1
    else this.stableFrames = 0
    if (this.stableFrames >= 600) {
      this.level = this.level === 'minimal' ? 'reduced' : 'full'
      this.stableFrames = 0
    }
    return this.level
  }
}

export const lineProgressAt = (line, time) => {
  if (line?.start == null || line?.end == null || line.end <= line.start)
    return 0
  return Math.max(0, Math.min(1, (time - line.start) / (line.end - line.start)))
}

export const cueProgressAt = (cue, line, time) => {
  const start = cue.start ?? line.start
  const end = cue.end ?? line.end
  if (start == null || end == null || end <= start)
    return time >= (start ?? Infinity) ? 1 : 0
  return Math.max(0, Math.min(1, (time - start) / (end - start)))
}

export const waveTimingFor = (cue) => {
  const count = cue?.graphemes?.filter((part) => part.visible).length || 0
  const duration = (cue?.end ?? 0) - (cue?.start ?? 0)
  if (count < 2 || count > 40 || duration <= 0) return null
  const budget = duration * 0.35
  const availableStagger = budget / (count - 1)
  if (availableStagger < 12) return null
  const stagger = Math.min(45, availableStagger)
  const offsetWindow = stagger * (count - 1)
  const remaining = Math.max(0, duration - offsetWindow)
  if (remaining < 90) return null
  const crestDuration = Math.min(240, remaining)
  return { stagger, duration, count, crestDuration, offsetWindow }
}

const positiveEnvelope = (phase) => {
  if (phase <= 0 || phase >= 1) return 0
  return Math.sin(Math.PI * phase) ** 2
}

export const tokenLiftAt = (timedPart, time) => {
  const start = timedPart?.start
  const end = timedPart?.end
  if (start == null || end == null || end <= start) return 0
  const duration = end - start
  const crestDuration = Math.min(240, duration)
  return positiveEnvelope((time - start) / crestDuration)
}

export const graphemeLiftAt = (cue, graphemeIndex, time) => {
  const wave = waveTimingFor(cue)
  if (!wave || wave.crestDuration <= 0) return 0
  const start = cue.start + wave.stagger * graphemeIndex
  return positiveEnvelope((time - start) / wave.crestDuration)
}
