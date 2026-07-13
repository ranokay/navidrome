import { useCallback, useEffect, useRef, useState } from 'react'
import {
  cueProgressAt,
  lineProgressAt,
  LyricQualityMonitor,
  LyricTimelineCursor,
} from './lyricsTimeline'

const mediaTimeMs = (audio) => {
  const time = Number(audio?.currentTime)
  return Number.isFinite(time) && time >= 0 ? time * 1000 : 0
}

const setProgress = (node, value) => {
  if (node) node.style.setProperty('--lyrics-progress', String(value))
}

const cueStart = (cue, line) => cue.start ?? line.start ?? Infinity

const cueIndexAt = (cues, line, time) => {
  let low = 0
  let high = cues.length
  while (low < high) {
    const middle = (low + high) >>> 1
    if (cueStart(cues[middle], line) <= time) low = middle + 1
    else high = middle
  }
  return low - 1
}

const useLyricsTimeline = ({
  document: lyricDocument,
  audioInstance,
  visible,
  reducedMotion,
}) => {
  const cursorRef = useRef(new LyricTimelineCursor(lyricDocument))
  const lineNodesRef = useRef(new Map())
  const cueNodesRef = useRef(new Map())
  const cueStateRef = useRef(new Map())
  const frameRef = useRef(0)
  const lastFrameRef = useRef(null)
  const qualityRef = useRef(new LyricQualityMonitor(reducedMotion))
  const [activeIndexes, setActiveIndexes] = useState([])
  const [quality, setQuality] = useState(qualityRef.current.level)

  const cueProgress = useCallback((cue, line, time) => {
    if (qualityRef.current.level === 'minimal') {
      return time >= cueStart(cue, line) ? 1 : 0
    }
    return cueProgressAt(cue, line, time)
  }, [])

  const registerLine = useCallback((index, node) => {
    if (node) lineNodesRef.current.set(index, node)
    else lineNodesRef.current.delete(index)
  }, [])

  const registerCue = useCallback(
    (lineIndex, cueIndex, node) => {
      const key = `${lineIndex}:${cueIndex}`
      if (!node) {
        cueNodesRef.current.delete(key)
        return
      }
      cueNodesRef.current.set(key, node)
      const line = lyricDocument?.lines?.[lineIndex]
      const cue = line?.cuesBySourceIndex?.[cueIndex]
      if (line && cue && Number.isFinite(cursorRef.current.lastTime)) {
        setProgress(node, cueProgress(cue, line, cursorRef.current.lastTime))
      }
    },
    [cueProgress, lyricDocument],
  )

  const updateCues = useCallback(
    (lineIndex, line, time, forceSeek) => {
      if (!line.cues.length) return
      const previous = cueStateRef.current.get(lineIndex) || {
        index: -1,
        time: -Infinity,
      }
      const seeking = forceSeek || time < previous.time
      let target = previous.index
      if (seeking) {
        target = cueIndexAt(line.cues, line, time)
        line.cues.forEach((cue) => {
          setProgress(
            cueNodesRef.current.get(`${lineIndex}:${cue.sourceIndex}`),
            cueProgress(cue, line, time),
          )
        })
      } else {
        while (
          target + 1 < line.cues.length &&
          cueStart(line.cues[target + 1], line) <= time
        ) {
          if (target >= 0) {
            const completed = line.cues[target]
            setProgress(
              cueNodesRef.current.get(`${lineIndex}:${completed.sourceIndex}`),
              1,
            )
          }
          target += 1
        }
        if (target >= 0) {
          const cue = line.cues[target]
          setProgress(
            cueNodesRef.current.get(`${lineIndex}:${cue.sourceIndex}`),
            cueProgress(cue, line, time),
          )
        }
      }
      cueStateRef.current.set(lineIndex, { index: target, time })
    },
    [cueProgress],
  )

  const apply = useCallback(
    (time, forceSeek = false) => {
      const cursor = cursorRef.current
      const previous = cursor.lastIndexes
      const result = cursor.update(time, forceSeek)
      if (result.changed) {
        previous.forEach((index) => {
          if (cursor.active.has(index)) return
          const line = lyricDocument?.lines?.[index]
          const node = lineNodesRef.current.get(index)
          if (!line || !node) return
          node.dataset.active = 'false'
          setProgress(node, time >= line.end ? 1 : 0)
        })
      }
      result.indexes.forEach((index) => {
        const line = lyricDocument?.lines?.[index]
        const node = lineNodesRef.current.get(index)
        if (!line || !node) return
        node.dataset.active = 'true'
        setProgress(node, lineProgressAt(line, time))
        updateCues(index, line, time, forceSeek)
      })
      if (result.changed) setActiveIndexes(result.indexes)
      return result
    },
    [lyricDocument, updateCues],
  )

  useEffect(() => {
    cursorRef.current = new LyricTimelineCursor(lyricDocument)
    cueStateRef.current.clear()
    qualityRef.current = new LyricQualityMonitor(reducedMotion)
    setActiveIndexes([])
    setQuality(qualityRef.current.level)
    apply(mediaTimeMs(audioInstance), true)
  }, [apply, audioInstance, lyricDocument, reducedMotion])

  useEffect(() => {
    if (!audioInstance || !lyricDocument?.timed) return undefined
    const seek = () => apply(mediaTimeMs(audioInstance), true)
    audioInstance.addEventListener('seeked', seek)
    return () => {
      audioInstance.removeEventListener('seeked', seek)
    }
  }, [apply, audioInstance, lyricDocument])

  useEffect(() => {
    if (!audioInstance || !lyricDocument?.timed || !visible) return undefined
    let cancelled = false
    const stop = () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current)
      frameRef.current = 0
      lastFrameRef.current = null
    }
    const tick = (now) => {
      if (
        cancelled ||
        audioInstance.paused ||
        window.document.visibilityState !== 'visible'
      ) {
        stop()
        return
      }
      if (lastFrameRef.current != null) {
        const nextQuality = qualityRef.current.record(
          now - lastFrameRef.current,
        )
        if (nextQuality !== qualityRef.current.lastPublished) {
          qualityRef.current.lastPublished = nextQuality
          setQuality(nextQuality)
        }
      }
      lastFrameRef.current = now
      apply(mediaTimeMs(audioInstance))
      frameRef.current = requestAnimationFrame(tick)
    }
    const start = () => {
      if (
        frameRef.current ||
        audioInstance.paused ||
        window.document.visibilityState !== 'visible'
      )
        return
      frameRef.current = requestAnimationFrame(tick)
    }
    const syncAndStop = () => {
      stop()
      apply(mediaTimeMs(audioInstance), true)
    }
    audioInstance.addEventListener('play', start)
    audioInstance.addEventListener('pause', syncAndStop)
    const visibility = () => {
      if (window.document.visibilityState !== 'visible') {
        stop()
        return
      }
      apply(mediaTimeMs(audioInstance), true)
      start()
    }
    window.document.addEventListener('visibilitychange', visibility)
    start()
    return () => {
      cancelled = true
      stop()
      audioInstance.removeEventListener('play', start)
      audioInstance.removeEventListener('pause', syncAndStop)
      window.document.removeEventListener('visibilitychange', visibility)
    }
  }, [apply, audioInstance, lyricDocument, visible])

  return { activeIndexes, quality, registerLine, registerCue, syncNow: apply }
}

export default useLyricsTimeline
