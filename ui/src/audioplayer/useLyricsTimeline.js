import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  KARAOKE_CHARACTER_LIFT_PX,
  KARAOKE_CHARACTER_PHASE_SPREAD,
  KARAOKE_CHARACTER_WAVE_DURATION_MS,
  KARAOKE_CLOCK_DRIFT_RESET_MS,
  KARAOKE_HIGHLIGHT_LEAD_MS,
  KARAOKE_LINE_RELEASE_MS,
} from './lyricsKaraokeConstants'
import {
  buildLyricsTimeline,
  getTimelineScrollTarget,
  LyricTimelineCursor,
  tokenProgressAt,
} from './lyricsTimeline'

const mediaTimeMs = (audio) => {
  const seconds = Number(audio?.currentTime)
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1000 : 0
}

const mediaDurationMs = (audio) => {
  const seconds = Number(audio?.duration)
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : null
}

const sameIndexes = (left, right) =>
  left.length === right.length &&
  left.every((value, index) => value === right[index])

const setProgress = (record, value) => {
  const next = Math.max(0, Math.min(1, value))
  if (record.progress != null && Math.abs(record.progress - next) < 0.001)
    return
  record.progress = next
  record.node.style.setProperty('--lyrics-progress', String(next))
}

const smootherStep = (value) =>
  value * value * value * (value * (value * 6 - 15) + 10)

const setCharacterLift = (record, progress) => {
  const characters = (record.characters || []).filter(
    (node) => node.dataset.whitespace !== 'true',
  )
  if (!characters.length) return

  const rawDuration = Number(record.window?.end) - Number(record.window?.start)
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
    const lift = Math.max(
      0,
      Math.min(
        KARAOKE_CHARACTER_LIFT_PX,
        KARAOKE_CHARACTER_LIFT_PX * smootherStep(local),
      ),
    )
    if (lift < 0.00005) {
      if (node.style.transform) node.style.removeProperty('transform')
      return
    }
    const nextTransform = `translateY(-${lift.toFixed(4)}px)`
    if (node.style.transform !== nextTransform) {
      node.style.transform = nextTransform
    }
  })
}

const setTokenOpacity = (record, value) => {
  const next = Math.max(0, Math.min(1, value))
  if (record.opacity != null && Math.abs(record.opacity - next) < 0.001) return
  record.opacity = next
  record.node.style.opacity = String(next)
}

const setTokenActiveAlpha = (record, value) => {
  const next = Math.max(0, Math.min(1, value))
  if (record.activeAlpha != null && Math.abs(record.activeAlpha - next) < 0.001)
    return
  record.activeAlpha = next
  record.node.style.setProperty('--lyrics-token-active-alpha', String(next))
}

const setGradientTokenColor = (record) => {
  record.node.style.color = 'transparent'
  record.node.style.webkitTextFillColor = 'transparent'
  record.node.style.backgroundImage = record.presentation.gradient
  record.node.style.backgroundSize = '100% 100%'
  record.node.style.backgroundClip = 'text'
  record.node.style.webkitBackgroundClip = 'text'
}

const getInactiveTokenAlpha = (presentation = {}) =>
  Math.min(1, Math.max(0, presentation.futureAlpha ?? 0.34))

const getActiveTokenAlpha = (presentation = {}) =>
  Math.min(1, Math.max(0, presentation.activeAlpha ?? 1))

const isGradientTokenState = (state) =>
  state === 'future' ||
  state === 'active' ||
  state === 'completed' ||
  state === 'release' ||
  state === 'inactive-past'

const applyTokenState = (record, state, progress = 0) => {
  const previousState = record.state
  record.state = state
  record.node.dataset.lyricsState = state
  const presentation = record.presentation || {}

  if (!isGradientTokenState(previousState)) {
    setGradientTokenColor(record)
  }

  const isFuture = state === 'future'
  const isPast = state === 'inactive-past'
  const nextProgress = isFuture ? 0 : state === 'active' ? progress : 1
  setProgress(record, nextProgress)
  setCharacterLift(record, nextProgress)
  setTokenOpacity(record, 1)
  setTokenActiveAlpha(
    record,
    isPast
      ? getInactiveTokenAlpha(presentation)
      : getActiveTokenAlpha(presentation),
  )
}

const setTokenReleasePresentation = (record, progress) => {
  const presentation = record.presentation || {}
  const nextProgress = Math.max(0, Math.min(1, progress))
  if (record.state !== 'release') {
    applyTokenState(record, 'completed', 1)
    record.state = 'release'
    record.node.dataset.lyricsState = 'release'
  }
  const activeAlpha = getActiveTokenAlpha(presentation)
  const targetAlpha = getInactiveTokenAlpha(presentation)
  setTokenOpacity(record, 1)
  setTokenActiveAlpha(
    record,
    activeAlpha + (targetAlpha - activeAlpha) * nextProgress,
  )
}

const resetToken = (record, state = 'future') => {
  applyTokenState(record, state, 0)
}

const setTokenPresentation = (record, time) => {
  const progress = tokenProgressAt(record.window, time)
  const state =
    progress <= 0 ? 'future' : progress >= 1 ? 'completed' : 'active'
  if (record.state !== state || state === 'active') {
    applyTokenState(record, state, progress)
  }
}

const canListenToMedia = (audio) =>
  Boolean(
    audio &&
    typeof audio.addEventListener === 'function' &&
    typeof audio.removeEventListener === 'function',
  )

const useLyricsTimeline = ({
  lines,
  audioInstance,
  visible,
  reducedMotion,
}) => {
  const [durationMs, setDurationMs] = useState(() =>
    mediaDurationMs(audioInstance),
  )

  useEffect(() => {
    const updateDuration = () => setDurationMs(mediaDurationMs(audioInstance))
    updateDuration()
    if (!canListenToMedia(audioInstance)) return undefined
    audioInstance.addEventListener('loadedmetadata', updateDuration)
    audioInstance.addEventListener('durationchange', updateDuration)
    return () => {
      audioInstance.removeEventListener('loadedmetadata', updateDuration)
      audioInstance.removeEventListener('durationchange', updateDuration)
    }
  }, [audioInstance])

  const timeline = useMemo(
    () => buildLyricsTimeline(lines, { durationMs }),
    [durationMs, lines],
  )
  const cursorRef = useRef(new LyricTimelineCursor(timeline))
  const lineNodesRef = useRef(new Map())
  const tokenRecordsRef = useRef(new Map())
  const lineTokenKeysRef = useRef(new Map())
  const releaseIndexesRef = useRef(new Set())
  const frameRef = useRef(0)
  const lastPublishedIndexesRef = useRef([])
  const lastScrollTargetRef = useRef(-1)
  const lastAppliedTimeRef = useRef(0)
  const [activeIndexes, setActiveIndexes] = useState([])
  const [scrollTargetIndex, setScrollTargetIndex] = useState(-1)

  const setLineState = useCallback((lineIndex, phase) => {
    const node = lineNodesRef.current.get(lineIndex)
    if (!node) return
    node.dataset.active = phase === 'active' ? 'true' : 'false'
    node.dataset.lifecycle = phase
    node.dataset.highlightActive = phase === 'active' ? 'true' : 'false'
    node.dataset.raised = phase === 'idle' ? 'false' : 'true'
  }, [])

  const resetLineTokens = useCallback((lineIndex, state = 'future') => {
    lineTokenKeysRef.current.get(lineIndex)?.forEach((key) => {
      const record = tokenRecordsRef.current.get(key)
      if (record) resetToken(record, state)
    })
  }, [])

  const updateLineTokens = useCallback((lineIndex, time) => {
    lineTokenKeysRef.current.get(lineIndex)?.forEach((key) => {
      const record = tokenRecordsRef.current.get(key)
      if (record) setTokenPresentation(record, time)
    })
  }, [])

  const updateLineReleaseTokens = useCallback((lineIndex, progress) => {
    lineTokenKeysRef.current.get(lineIndex)?.forEach((key) => {
      const record = tokenRecordsRef.current.get(key)
      if (record) setTokenReleasePresentation(record, progress)
    })
  }, [])

  const publishActiveIndexes = useCallback((indexes) => {
    if (sameIndexes(lastPublishedIndexesRef.current, indexes)) return
    lastPublishedIndexesRef.current = indexes
    setActiveIndexes(indexes)
  }, [])

  const publishScrollTarget = useCallback(
    (time) => {
      const nextIndex = getTimelineScrollTarget(timeline, time)
      if (nextIndex === lastScrollTargetRef.current) return
      lastScrollTargetRef.current = nextIndex
      setScrollTargetIndex(nextIndex)
    },
    [timeline],
  )

  const apply = useCallback(
    (time, forceSeek = false) => {
      const current = Number.isFinite(Number(time))
        ? Math.max(0, Number(time))
        : 0
      const lead = reducedMotion ? 0 : KARAOKE_HIGHLIGHT_LEAD_MS
      lastAppliedTimeRef.current = current
      const cursor = cursorRef.current
      const previousIndexes = cursor.lastIndexes
      const result = cursor.update(current, forceSeek)

      if (forceSeek) {
        releaseIndexesRef.current.clear()
        timeline.windows.forEach((window) => {
          if (!window.valid || current < window.start) {
            setLineState(window.lineIndex, 'idle')
            resetLineTokens(window.lineIndex, 'future')
            return
          }
          if (current >= window.end) {
            if (current < window.end + KARAOKE_LINE_RELEASE_MS) {
              releaseIndexesRef.current.add(window.lineIndex)
              setLineState(window.lineIndex, 'release')
              updateLineReleaseTokens(
                window.lineIndex,
                (current - window.end) / KARAOKE_LINE_RELEASE_MS,
              )
            } else {
              setLineState(window.lineIndex, 'past')
              resetLineTokens(window.lineIndex, 'inactive-past')
            }
          }
        })
      } else if (result.changed) {
        previousIndexes.forEach((lineIndex) => {
          if (cursor.active.has(lineIndex)) return
          const window = timeline.windows[lineIndex]
          if (
            window?.valid &&
            current >= window.end &&
            current < window.end + KARAOKE_LINE_RELEASE_MS
          ) {
            releaseIndexesRef.current.add(lineIndex)
            setLineState(lineIndex, 'release')
            updateLineReleaseTokens(lineIndex, 0)
          } else {
            setLineState(lineIndex, 'past')
            resetLineTokens(lineIndex, 'inactive-past')
          }
        })
      }

      result.indexes.forEach((lineIndex) => {
        releaseIndexesRef.current.delete(lineIndex)
        setLineState(lineIndex, 'active')
        updateLineTokens(lineIndex, current + lead)
      })

      releaseIndexesRef.current.forEach((lineIndex) => {
        const window = timeline.windows[lineIndex]
        if (
          !window?.valid ||
          current >= window.end + KARAOKE_LINE_RELEASE_MS ||
          current < window.end
        ) {
          releaseIndexesRef.current.delete(lineIndex)
          const isPast = current >= (window?.end ?? Infinity)
          setLineState(lineIndex, isPast ? 'past' : 'idle')
          resetLineTokens(lineIndex, isPast ? 'inactive-past' : 'future')
          return
        }
        updateLineReleaseTokens(
          lineIndex,
          (current - window.end) / KARAOKE_LINE_RELEASE_MS,
        )
      })

      if (result.changed || forceSeek) publishActiveIndexes(result.indexes)
      publishScrollTarget(current)
      return result
    },
    [
      publishActiveIndexes,
      publishScrollTarget,
      reducedMotion,
      resetLineTokens,
      setLineState,
      timeline.windows,
      updateLineReleaseTokens,
      updateLineTokens,
    ],
  )

  const registerLine = useCallback(
    (lineIndex, node) => {
      if (!node) {
        lineNodesRef.current.delete(lineIndex)
        return
      }
      lineNodesRef.current.set(lineIndex, node)
      const window = timeline.windows[lineIndex]
      const time = lastAppliedTimeRef.current
      if (cursorRef.current.active.has(lineIndex)) {
        setLineState(lineIndex, 'active')
      } else if (
        window?.valid &&
        time >= window.end &&
        time < window.end + KARAOKE_LINE_RELEASE_MS
      ) {
        setLineState(lineIndex, 'release')
      } else if (window?.valid && time >= window.end) {
        setLineState(lineIndex, 'past')
      } else {
        setLineState(lineIndex, 'idle')
      }
    },
    [setLineState, timeline.windows],
  )

  const registerToken = useCallback(
    (key, descriptor, node) => {
      const existing = tokenRecordsRef.current.get(key)
      if (!node) {
        if (existing) {
          tokenRecordsRef.current.delete(key)
          const keys = lineTokenKeysRef.current.get(existing.lineIndex)
          keys?.delete(key)
          if (keys?.size === 0) {
            lineTokenKeysRef.current.delete(existing.lineIndex)
          }
        }
        return
      }

      const record = {
        key,
        node,
        lineIndex: descriptor.lineIndex,
        window: descriptor.window,
        presentation: descriptor.presentation,
        characters: reducedMotion
          ? []
          : Array.from(node.querySelectorAll('[data-lyrics-character="true"]')),
        progress: null,
        opacity: null,
        activeAlpha: null,
        state: null,
      }
      tokenRecordsRef.current.set(key, record)
      if (!lineTokenKeysRef.current.has(record.lineIndex)) {
        lineTokenKeysRef.current.set(record.lineIndex, new Set())
      }
      lineTokenKeysRef.current.get(record.lineIndex).add(key)

      if (cursorRef.current.active.has(record.lineIndex)) {
        setTokenPresentation(
          record,
          lastAppliedTimeRef.current +
            (reducedMotion ? 0 : KARAOKE_HIGHLIGHT_LEAD_MS),
        )
      } else {
        const lineWindow = timeline.windows[record.lineIndex]
        if (
          lineWindow?.valid &&
          lastAppliedTimeRef.current >= lineWindow.end &&
          lastAppliedTimeRef.current < lineWindow.end + KARAOKE_LINE_RELEASE_MS
        ) {
          setTokenReleasePresentation(
            record,
            (lastAppliedTimeRef.current - lineWindow.end) /
              KARAOKE_LINE_RELEASE_MS,
          )
        } else {
          resetToken(
            record,
            lineWindow?.valid && lastAppliedTimeRef.current >= lineWindow.end
              ? 'inactive-past'
              : 'future',
          )
        }
      }
    },
    [reducedMotion, timeline.windows],
  )

  const getLineNode = useCallback(
    (lineIndex) => lineNodesRef.current.get(lineIndex) || null,
    [],
  )

  useLayoutEffect(() => {
    lineNodesRef.current.forEach((node) => {
      node.dataset.active = 'false'
      node.dataset.lifecycle = 'idle'
      node.dataset.highlightActive = 'false'
      node.dataset.raised = 'false'
    })
    tokenRecordsRef.current.forEach((record) => resetToken(record))
    cursorRef.current = new LyricTimelineCursor(timeline)
    releaseIndexesRef.current.clear()
    lastPublishedIndexesRef.current = []
    lastScrollTargetRef.current = -1
    setActiveIndexes([])
    setScrollTargetIndex(-1)
    apply(mediaTimeMs(audioInstance), true)
  }, [apply, audioInstance, timeline])

  useEffect(() => {
    if (
      !audioInstance ||
      !timeline.events.length ||
      !canListenToMedia(audioInstance)
    ) {
      return undefined
    }
    const seek = () => apply(mediaTimeMs(audioInstance), true)
    audioInstance.addEventListener('seeking', seek)
    audioInstance.addEventListener('seeked', seek)
    return () => {
      audioInstance.removeEventListener('seeking', seek)
      audioInstance.removeEventListener('seeked', seek)
    }
  }, [apply, audioInstance, timeline.events.length])

  useEffect(() => {
    if (!audioInstance || !timeline.events.length || !visible) return undefined
    if (!canListenToMedia(audioInstance)) {
      apply(mediaTimeMs(audioInstance), true)
      return undefined
    }

    let cancelled = false
    let anchorAudioMs = mediaTimeMs(audioInstance)
    let anchorPerfMs = performance.now()
    let lastFrameTime = anchorAudioMs

    const stop = () => {
      if (frameRef.current) window.cancelAnimationFrame(frameRef.current)
      frameRef.current = 0
    }

    const resetAnchor = () => {
      anchorAudioMs = mediaTimeMs(audioInstance)
      anchorPerfMs = performance.now()
      lastFrameTime = anchorAudioMs
    }

    const readInterpolatedTime = () => {
      const observed = mediaTimeMs(audioInstance)
      const now = performance.now()
      const rate = Number(audioInstance.playbackRate)
      const canInterpolate =
        !audioInstance.paused &&
        !audioInstance.seeking &&
        Number.isFinite(rate) &&
        rate > 0
      if (!canInterpolate) {
        anchorAudioMs = observed
        anchorPerfMs = now
        lastFrameTime = observed
        return observed
      }
      const predicted = anchorAudioMs + (now - anchorPerfMs) * rate
      const drift = observed - predicted
      let current =
        Math.abs(drift) > KARAOKE_CLOCK_DRIFT_RESET_MS ? observed : predicted
      if (Math.abs(drift) > KARAOKE_CLOCK_DRIFT_RESET_MS) {
        anchorAudioMs = observed
        anchorPerfMs = now
      }
      const backwards = lastFrameTime - current
      if (backwards > 0) {
        current = lastFrameTime
      }
      lastFrameTime = Math.max(0, current)
      return lastFrameTime
    }

    const tick = () => {
      if (
        cancelled ||
        audioInstance.paused ||
        window.document.visibilityState !== 'visible'
      ) {
        stop()
        return
      }
      apply(readInterpolatedTime())
      frameRef.current = window.requestAnimationFrame(tick)
    }

    const start = () => {
      if (
        frameRef.current ||
        audioInstance.paused ||
        window.document.visibilityState !== 'visible'
      ) {
        return
      }
      resetAnchor()
      frameRef.current = window.requestAnimationFrame(tick)
    }

    const syncAndStop = () => {
      stop()
      apply(mediaTimeMs(audioInstance), true)
    }

    const visibility = () => {
      if (window.document.visibilityState !== 'visible') {
        stop()
        return
      }
      apply(mediaTimeMs(audioInstance), true)
      start()
    }

    audioInstance.addEventListener('play', start)
    audioInstance.addEventListener('pause', syncAndStop)
    window.document.addEventListener('visibilitychange', visibility)
    apply(mediaTimeMs(audioInstance), true)
    start()

    return () => {
      cancelled = true
      stop()
      audioInstance.removeEventListener('play', start)
      audioInstance.removeEventListener('pause', syncAndStop)
      window.document.removeEventListener('visibilitychange', visibility)
    }
  }, [apply, audioInstance, timeline.events.length, visible])

  const syncNow = useCallback(
    (time = mediaTimeMs(audioInstance), forceSeek = true) =>
      apply(time, forceSeek),
    [apply, audioInstance],
  )

  return {
    activeIndexes,
    primaryIndex: activeIndexes.at(-1) ?? -1,
    scrollTargetIndex,
    registerLine,
    registerToken,
    getLineNode,
    syncNow,
    timeline,
  }
}

export default useLyricsTimeline
