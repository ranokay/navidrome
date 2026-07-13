import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react'
import {
  cueProgressAt,
  graphemeLiftAt,
  lineProgressAt,
  LyricQualityMonitor,
  LyricTimelineCursor,
  tokenLiftAt,
} from './lyricsTimeline'

const mediaTimeMs = (audio) => {
  const time = Number(audio?.currentTime)
  return Number.isFinite(time) && time >= 0 ? time * 1000 : 0
}

const setProgress = (node, value) => {
  if (node) node.style.setProperty('--lyrics-progress', String(value))
}

const resetCueNode = (node, state = 'future') => {
  if (!node) return
  node.dataset.lyricsState = state
  node.dataset.lifting = 'false'
  setProgress(node, 0)
  node.style.setProperty('--lyrics-token-lift', '0')
  node.querySelectorAll?.('.lyrics-grapheme').forEach((part) => {
    part.dataset.lifting = 'false'
    part.style.setProperty('--lyrics-grapheme-lift', '0')
  })
}

const cueStart = (cue, line) => cue.start ?? line.start ?? Infinity

const useLyricsTimeline = ({
  document: lyricDocument,
  audioInstance,
  visible,
  reducedMotion,
  resetKey,
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
    if (node) {
      lineNodesRef.current.set(index, node)
      const active = cursorRef.current.active.has(index)
      node.dataset.active = String(active)
      node.dataset.lifting = 'false'
      node.style.setProperty('--lyrics-line-lift', '0')
    } else lineNodesRef.current.delete(index)
  }, [])

  const registerCue = useCallback(
    (lineIndex, cueIndex, node, slot = 'main') => {
      const key = `${lineIndex}:${cueIndex}`
      if (!cueNodesRef.current.has(key)) {
        cueNodesRef.current.set(key, new Map())
      }
      const slots = cueNodesRef.current.get(key)
      if (!node) {
        slots.delete(slot)
        if (slots.size === 0) cueNodesRef.current.delete(key)
        return
      }
      slots.set(slot, node)
      const line = lyricDocument?.lines?.[lineIndex]
      const cue = line?.cuesBySourceIndex?.[cueIndex]
      const active = cursorRef.current.active.has(lineIndex)
      if (
        active &&
        line &&
        cue &&
        Number.isFinite(cursorRef.current.lastTime)
      ) {
        const progress = cueProgress(cue, line, cursorRef.current.lastTime)
        node.dataset.lyricsState =
          progress <= 0 ? 'future' : progress >= 1 ? 'completed' : 'active'
        setProgress(node, progress)
      } else {
        resetCueNode(node)
      }
    },
    [cueProgress, lyricDocument],
  )

  const cueNodes = useCallback(
    (lineIndex, cueIndex) =>
      cueNodesRef.current.get(`${lineIndex}:${cueIndex}`)?.values() || [],
    [],
  )

  const setCuePresentation = useCallback(
    (lineIndex, cue, time, progress) => {
      for (const node of cueNodes(lineIndex, cue.sourceIndex)) {
        node.dataset.lyricsState =
          progress <= 0 ? 'future' : progress >= 1 ? 'completed' : 'active'
        setProgress(node, progress)
        const isMain = node.classList.contains('lyrics-cue')
        const qualityLevel = qualityRef.current.level
        const canLift =
          isMain &&
          qualityLevel !== 'minimal' &&
          qualityLevel !== 'reduced-motion'
        let tokenLift = canLift ? tokenLiftAt(cue, time) : 0
        const graphemes = isMain
          ? node.querySelectorAll('.lyrics-grapheme')
          : []
        if (qualityLevel === 'full' && graphemes.length > 0) {
          graphemes.forEach((part, index) => {
            const lift = graphemeLiftAt(cue, index, time)
            tokenLift = Math.max(tokenLift, lift)
            part.dataset.lifting = String(lift > 0)
            part.style.setProperty('--lyrics-grapheme-lift', String(lift))
          })
        } else {
          graphemes.forEach((part) => {
            part.dataset.lifting = 'false'
            part.style.setProperty('--lyrics-grapheme-lift', '0')
          })
        }
        node.dataset.lifting = String(tokenLift > 0)
        node.style.setProperty('--lyrics-token-lift', String(tokenLift))
      }
    },
    [cueNodes],
  )

  const resetLineCues = useCallback((lineIndex, state) => {
    const prefix = `${lineIndex}:`
    cueNodesRef.current.forEach((slots, key) => {
      if (!key.startsWith(prefix)) return
      slots.forEach((node) => resetCueNode(node, state))
    })
    cueStateRef.current.delete(lineIndex)
  }, [])

  const updateCues = useCallback(
    (lineIndex, line, time, forceSeek) => {
      if (!line.cues.length) return
      const previous = cueStateRef.current.get(lineIndex) || {
        nextIndex: 0,
        active: new Set(),
        time: -Infinity,
      }
      const seeking = forceSeek || time < previous.time
      if (seeking) {
        const active = new Set()
        let nextIndex = 0
        line.cues.forEach((cue, index) => {
          const progress = cueProgress(cue, line, time)
          setCuePresentation(lineIndex, cue, time, progress)
          const started = cueStart(cue, line) <= time
          if (started) nextIndex = index + 1
          if (started && progress < 1) active.add(index)
        })
        cueStateRef.current.set(lineIndex, { active, nextIndex, time })
        return
      }

      const active = previous.active
      let nextIndex = previous.nextIndex
      while (
        nextIndex < line.cues.length &&
        cueStart(line.cues[nextIndex], line) <= time
      ) {
        active.add(nextIndex)
        nextIndex += 1
      }
      active.forEach((index) => {
        const cue = line.cues[index]
        const progress = cueProgress(cue, line, time)
        setCuePresentation(lineIndex, cue, time, progress)
        if (progress >= 1) {
          active.delete(index)
        }
      })
      cueStateRef.current.set(lineIndex, { active, nextIndex, time })
    },
    [cueProgress, setCuePresentation],
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
          if (node) {
            node.dataset.active = 'false'
            node.dataset.lifting = 'false'
            node.style.setProperty('--lyrics-line-lift', '0')
          }
          if (line) {
            resetLineCues(index, time >= line.end ? 'inactive-past' : 'future')
          }
        })
      }
      result.indexes.forEach((index) => {
        const line = lyricDocument?.lines?.[index]
        const node = lineNodesRef.current.get(index)
        if (!line || !node) return
        node.dataset.active = 'true'
        setProgress(node, lineProgressAt(line, time))
        const lineLift =
          qualityRef.current.level === 'minimal' ||
          qualityRef.current.level === 'reduced-motion'
            ? 0
            : tokenLiftAt(line, time)
        node.dataset.lifting = String(lineLift > 0)
        node.style.setProperty('--lyrics-line-lift', String(lineLift))
        updateCues(index, line, time, forceSeek)
      })
      if (result.changed) setActiveIndexes(result.indexes)
      return result
    },
    [lyricDocument, resetLineCues, updateCues],
  )

  useLayoutEffect(() => {
    lineNodesRef.current.forEach((node) => {
      node.dataset.active = 'false'
      node.dataset.lifting = 'false'
      node.style.setProperty('--lyrics-line-lift', '0')
    })
    cueNodesRef.current.forEach((slots) =>
      slots.forEach((node) => resetCueNode(node)),
    )
    cursorRef.current = new LyricTimelineCursor(lyricDocument)
    cueStateRef.current.clear()
    qualityRef.current = new LyricQualityMonitor(reducedMotion)
    setActiveIndexes([])
    setQuality(qualityRef.current.level)
    apply(mediaTimeMs(audioInstance), true)
  }, [apply, audioInstance, lyricDocument, reducedMotion, resetKey])

  useEffect(() => {
    if (!audioInstance || !lyricDocument?.timed) return undefined
    const seek = () => apply(mediaTimeMs(audioInstance), true)
    audioInstance.addEventListener('seeking', seek)
    audioInstance.addEventListener('seeked', seek)
    return () => {
      audioInstance.removeEventListener('seeking', seek)
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
