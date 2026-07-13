import { alpha, lighten, makeStyles } from '@material-ui/core/styles'
import clsx from 'clsx'
import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import {
  buildLayerLineIndex,
  buildPronunciationTokenIndex,
  hasStructuredLyricContent,
} from './lyrics'
import { LyricLineRow } from './LyricsLineRows'
import {
  KARAOKE_DESKTOP_ACTIVE_LINE_ANCHOR_RATIO,
  KARAOKE_INLINE_ACTIVE_LINE_ANCHOR_RATIO,
  KARAOKE_MANUAL_SCROLL_PAUSE_MS,
  KARAOKE_SCROLL_ANIMATION_MS,
} from './lyricsKaraokeConstants'
import { LyricScrollController, lyricScrollTarget } from './lyricsScroll'
import useLyricsTimeline from './useLyricsTimeline'

const useStyles = makeStyles((theme) => ({
  root: {
    height: '100%',
    minHeight: 0,
    display: 'flex',
    flexDirection: 'column',
    color: theme.palette.text.primary,
    '&[data-lyrics-quality="reduced"] .lyrics-grapheme, &[data-lyrics-quality="minimal"] .lyrics-grapheme, &[data-lyrics-quality="reduced-motion"] .lyrics-grapheme':
      {
        transform: 'none',
      },
    '&[data-lyrics-quality="minimal"] .lyrics-cue, &[data-lyrics-quality="reduced-motion"] .lyrics-cue, &[data-lyrics-quality="minimal"] $group, &[data-lyrics-quality="reduced-motion"] $group':
      {
        transform: 'none !important',
      },
  },
  body: {
    flex: 1,
    minHeight: 0,
    overflowY: 'auto',
    overflowX: 'hidden',
    padding: theme.spacing(4, 2.25, 10),
    overscrollBehavior: 'contain',
    scrollbarWidth: 'thin',
    maskImage:
      'linear-gradient(to bottom, transparent, #000 40px, #000 calc(100% - 72px), transparent)',
  },
  inlineBody: {
    padding: theme.spacing(0.5, 1.25, 2),
    textAlign: 'center',
  },
  lines: {
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(3),
  },
  group: {
    position: 'relative',
    '--lyrics-line-lift': 0,
    borderRadius: theme.shape.borderRadius,
    cursor: 'pointer',
    opacity: 1,
    transform: 'translateY(0)',
    transition: 'transform 180ms ease',
    '&[data-active="true"][data-precision="line"]': {
      '& .lyrics-base': {
        color: theme.palette.common.white,
      },
    },
    '&[data-active="true"][data-precision="line"][data-lifting="true"]': {
      transform:
        'perspective(500px) translate3d(0, calc(var(--lyrics-line-lift) * -1.5px), calc(var(--lyrics-line-lift) * 4px)) scale(calc(1 + var(--lyrics-line-lift) * 0.015)) rotateX(calc(var(--lyrics-line-lift) * -0.75deg))',
    },
    '&:focus-visible': {
      outline: `2px solid ${theme.palette.primary.main}`,
      outlineOffset: 3,
    },
    '& .lyrics-line': {
      display: 'block',
      position: 'relative',
      fontSize: 24,
      lineHeight: 1.18,
      fontWeight: 700,
      whiteSpace: 'pre-wrap',
      overflowWrap: 'anywhere',
    },
    '& .lyrics-line[data-token-pronunciation="true"]': {
      lineHeight: 1.8,
    },
    '& .lyrics-base': {
      color: alpha(theme.palette.text.primary, 0.42),
      transition: 'color 120ms linear',
    },
    '& .lyrics-presentation': {
      position: 'absolute',
      inset: 0,
      pointerEvents: 'none',
      opacity: 0,
      whiteSpace: 'pre-wrap',
      overflowWrap: 'anywhere',
    },
    '&[data-active="true"] .lyrics-presentation': {
      opacity: 1,
    },
    '& .lyrics-lane-background, & .lyrics-lane-bg': {
      opacity: 0.76,
    },
    '& .lyrics-cue': {
      display: 'inline-block',
      '--lyrics-token-lift': 0,
      color: 'transparent',
      backgroundImage: `linear-gradient(90deg, ${theme.palette.common.white} 0%, ${theme.palette.common.white} calc(var(--lyrics-progress) * 100%), transparent calc(var(--lyrics-progress) * 100%), transparent 100%)`,
      backgroundClip: 'text',
      WebkitBackgroundClip: 'text',
      transform: 'none',
      transformOrigin: '50% 75%',
    },
    '& .lyrics-cue[data-lifting="true"]': {
      transform:
        'perspective(500px) translate3d(0, calc(var(--lyrics-token-lift) * -1.5px), calc(var(--lyrics-token-lift) * 4px)) scale(calc(1 + var(--lyrics-token-lift) * 0.015)) rotateX(calc(var(--lyrics-token-lift) * -0.75deg))',
    },
    '& .lyrics-grapheme': {
      display: 'inline-block',
      transform: 'none',
      transformOrigin: '50% 75%',
    },
    '& .lyrics-grapheme[data-lifting="true"]': {
      transform:
        'perspective(500px) translate3d(0, calc(var(--lyrics-grapheme-lift) * -2px), calc(var(--lyrics-grapheme-lift) * 4px)) scale(calc(1 + var(--lyrics-grapheme-lift) * 0.015)) rotateX(calc(var(--lyrics-grapheme-lift) * -0.75deg))',
    },
    '& .lyrics-pronunciation-layer': {
      position: 'absolute',
      inset: 0,
      pointerEvents: 'none',
    },
    '& .lyrics-pronunciation-measure': {
      position: 'absolute',
      inset: 0,
      visibility: 'hidden',
      fontSize: 24,
      lineHeight: 1.8,
      fontWeight: 700,
      whiteSpace: 'pre-wrap',
      overflowWrap: 'anywhere',
    },
    '& .lyrics-pronunciation-token-layer': {
      position: 'absolute',
      inset: 0,
    },
    '& .lyrics-pronunciation-token': {
      position: 'absolute',
      display: 'block',
      maxWidth: '100%',
      fontSize: 15,
      lineHeight: 1.1,
      fontWeight: 600,
      whiteSpace: 'nowrap',
      color: 'transparent',
      backgroundImage: `linear-gradient(90deg, ${lighten(
        theme.palette.primary.main,
        0.25,
      )} 0%, ${lighten(
        theme.palette.primary.main,
        0.25,
      )} calc(var(--lyrics-progress) * 100%), ${alpha(
        theme.palette.primary.main,
        0.55,
      )} calc(var(--lyrics-progress) * 100%), ${alpha(
        theme.palette.primary.main,
        0.55,
      )} 100%)`,
      backgroundClip: 'text',
      WebkitBackgroundClip: 'text',
    },
    '& .lyrics-pronunciation-layout-fallback': {
      display: 'none',
      position: 'absolute',
      right: 0,
      bottom: 0,
      left: 0,
      color: alpha(theme.palette.primary.main, 0.55),
      fontSize: 15,
      lineHeight: 1.1,
      fontWeight: 600,
      whiteSpace: 'pre-wrap',
    },
    '& .lyrics-pronunciation-layer[data-fallback="true"] .lyrics-pronunciation-token-layer':
      {
        display: 'none',
      },
    '& .lyrics-pronunciation-layer[data-fallback="true"] .lyrics-pronunciation-layout-fallback':
      {
        display: 'block',
      },
    '& .lyrics-translation': {
      color: theme.palette.text.secondary,
    },
    '& .lyrics-pronunciation-fallback': {
      color: alpha(theme.palette.primary.main, 0.55),
    },
    '@media (prefers-reduced-motion: reduce)': {
      transition: 'none',
      transform: 'none !important',
      '& .lyrics-grapheme': { transform: 'none', transition: 'none' },
    },
  },
  untimed: {
    contentVisibility: 'auto',
    containIntrinsicSize: 'auto 72px',
    cursor: 'text',
    opacity: 1,
    userSelect: 'text',
    transition: 'none',
  },
  aux: {
    display: 'block',
    marginTop: theme.spacing(0.75),
    fontSize: 15,
    lineHeight: 1.25,
    fontWeight: 600,
    color: theme.palette.text.secondary,
    whiteSpace: 'pre-wrap',
  },
  empty: {
    flex: 1,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: theme.spacing(3),
    textAlign: 'center',
    opacity: 0.68,
  },
}))

const useReducedMotion = () => {
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    const query = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    if (!query) return undefined
    const update = () => setReduced(query.matches)
    update()
    query.addEventListener?.('change', update)
    return () => query.removeEventListener?.('change', update)
  }, [])
  return reduced
}

const LyricsPanel = ({
  visible = true,
  mainLyric,
  translationLyric,
  pronunciationLyric,
  translationMatches,
  pronunciationMatches,
  pronunciationTokens,
  showTranslation,
  showPronunciation,
  audioInstance,
  inline = false,
  loading = false,
  error = null,
}) => {
  const classes = useStyles()
  const bodyRef = useRef(null)
  const lineNodesRef = useRef(new Map())
  const manualUntilRef = useRef(0)
  const resumeTimerRef = useRef(0)
  const ignoreScrollUntilRef = useRef(0)
  const touchStartRef = useRef(null)
  const scrollControllerRef = useRef(null)
  if (!scrollControllerRef.current) {
    scrollControllerRef.current = new LyricScrollController()
  }
  const reducedMotion = useReducedMotion()
  const presentationIdentity = useMemo(
    () =>
      [
        mainLyric?.identity || 'empty',
        showTranslation ? translationLyric?.identity || 'translation' : 'no-tr',
        showPronunciation
          ? pronunciationLyric?.identity || 'pronunciation'
          : 'no-pr',
        inline ? 'mobile' : 'desktop',
      ].join(':'),
    [
      inline,
      mainLyric?.identity,
      pronunciationLyric?.identity,
      showPronunciation,
      showTranslation,
      translationLyric?.identity,
    ],
  )
  const { activeIndexes, quality, registerLine, registerCue, syncNow } =
    useLyricsTimeline({
      document: mainLyric,
      audioInstance,
      visible,
      reducedMotion,
      resetKey: presentationIdentity,
    })
  const primaryIndex = activeIndexes.at(-1) ?? -1
  const primaryIndexRef = useRef(primaryIndex)
  primaryIndexRef.current = primaryIndex
  const detailedIndexes = useMemo(() => {
    const indexes = new Set()
    activeIndexes.forEach((active) => {
      for (
        let index = Math.max(0, active - 2);
        index <= active + 2;
        index += 1
      ) {
        indexes.add(index)
      }
    })
    return indexes
  }, [activeIndexes])
  const resolvedTranslationMatches = useMemo(
    () =>
      translationMatches || buildLayerLineIndex(mainLyric, translationLyric),
    [mainLyric, translationLyric, translationMatches],
  )
  const resolvedPronunciationMatches = useMemo(
    () =>
      pronunciationMatches ||
      buildLayerLineIndex(mainLyric, pronunciationLyric),
    [mainLyric, pronunciationLyric, pronunciationMatches],
  )
  const resolvedPronunciationTokens = useMemo(
    () =>
      pronunciationTokens ||
      buildPronunciationTokenIndex(
        mainLyric,
        pronunciationLyric,
        resolvedPronunciationMatches,
      ),
    [
      mainLyric,
      pronunciationLyric,
      pronunciationTokens,
      resolvedPronunciationMatches,
    ],
  )

  const scrollToIndex = useCallback(
    (index, options = {}) => {
      const { force = false, instant = false } = options
      if (
        !mainLyric?.timed ||
        !visible ||
        index < 0 ||
        (!force && Date.now() < manualUntilRef.current)
      )
        return
      const body = bodyRef.current
      const line = lineNodesRef.current.get(index)
      if (!body || !line) return
      const anchor = inline
        ? KARAOKE_INLINE_ACTIVE_LINE_ANCHOR_RATIO
        : KARAOKE_DESKTOP_ACTIVE_LINE_ANCHOR_RATIO
      const top = lyricScrollTarget(body, line, anchor)
      scrollControllerRef.current.scrollTo(body, top, {
        duration: instant || reducedMotion ? 0 : KARAOKE_SCROLL_ANIMATION_MS,
        onWrite: () => {
          ignoreScrollUntilRef.current = Date.now() + 80
        },
      })
    },
    [inline, mainLyric?.timed, reducedMotion, visible],
  )

  const scrollToActive = useCallback(
    (options) => scrollToIndex(primaryIndexRef.current, options),
    [scrollToIndex],
  )

  useEffect(() => scrollToActive(), [primaryIndex, scrollToActive])
  useEffect(() => {
    if (typeof ResizeObserver !== 'function' || !bodyRef.current)
      return undefined
    const observer = new ResizeObserver(() => scrollToActive({ instant: true }))
    observer.observe(bodyRef.current)
    return () => observer.disconnect()
  }, [scrollToActive])

  useLayoutEffect(() => {
    clearTimeout(resumeTimerRef.current)
    manualUntilRef.current = 0
    scrollControllerRef.current.cancel()
    const body = bodyRef.current
    if (body) {
      ignoreScrollUntilRef.current = Date.now() + 80
      body.scrollTop = 0
    }
    const time = Math.max(0, Number(audioInstance?.currentTime) || 0) * 1000
    const result = syncNow(time, true)
    const index = result.primaryIndex
    primaryIndexRef.current = index
    if (index >= 0) scrollToIndex(index, { force: true, instant: true })
  }, [audioInstance, presentationIdentity, scrollToIndex, syncNow])

  useEffect(
    () => () => {
      clearTimeout(resumeTimerRef.current)
      scrollControllerRef.current.cancel()
    },
    [],
  )

  useEffect(() => {
    if (!visible) scrollControllerRef.current.cancel()
    if (!audioInstance) return undefined
    const cancel = () => scrollControllerRef.current.cancel()
    const resume = () => scrollToActive()
    const visibility = () => {
      if (document.visibilityState !== 'visible') cancel()
    }
    audioInstance.addEventListener('pause', cancel)
    audioInstance.addEventListener('play', resume)
    document.addEventListener('visibilitychange', visibility)
    return () => {
      audioInstance.removeEventListener('pause', cancel)
      audioInstance.removeEventListener('play', resume)
      document.removeEventListener('visibilitychange', visibility)
    }
  }, [audioInstance, scrollToActive, visible])

  useEffect(() => {
    if (visible) scrollToActive({ instant: true })
  }, [scrollToActive, visible])

  const pauseAutoScroll = useCallback(() => {
    if (!mainLyric?.timed) return
    manualUntilRef.current = Date.now() + KARAOKE_MANUAL_SCROLL_PAUSE_MS
    scrollControllerRef.current.cancel()
    clearTimeout(resumeTimerRef.current)
    resumeTimerRef.current = setTimeout(() => {
      manualUntilRef.current = 0
      scrollToActive()
    }, KARAOKE_MANUAL_SCROLL_PAUSE_MS)
  }, [mainLyric?.timed, scrollToActive])

  const handleScroll = useCallback(() => {
    if (
      scrollControllerRef.current.active ||
      Date.now() < ignoreScrollUntilRef.current
    )
      return
    pauseAutoScroll()
  }, [pauseAutoScroll])

  const handlePointerDown = useCallback(
    (event) => {
      const body = bodyRef.current
      if (!body || event.pointerType === 'touch') return
      const rect = body.getBoundingClientRect()
      if (event.clientX >= rect.right - 16) pauseAutoScroll()
    },
    [pauseAutoScroll],
  )

  const handleTouchStart = useCallback((event) => {
    touchStartRef.current = event.touches[0]?.clientY ?? null
  }, [])

  const handleTouchMove = useCallback(
    (event) => {
      const start = touchStartRef.current
      const current = event.touches[0]?.clientY
      if (start == null || current == null || Math.abs(current - start) < 8)
        return
      touchStartRef.current = current
      pauseAutoScroll()
    },
    [pauseAutoScroll],
  )

  const seek = useCallback(
    (line) => {
      if (!audioInstance || line.start == null) return
      clearTimeout(resumeTimerRef.current)
      manualUntilRef.current = 0
      scrollControllerRef.current.cancel()
      audioInstance.currentTime = line.start / 1000
      const result = syncNow(line.start, true)
      const index = result.primaryIndex >= 0 ? result.primaryIndex : line.index
      primaryIndexRef.current = index
      scrollToIndex(index, { force: true, instant: true })
    },
    [audioInstance, scrollToIndex, syncNow],
  )

  if (loading || error || !hasStructuredLyricContent(mainLyric)) {
    return (
      <div className={classes.root} data-testid="karaoke-lyrics-panel">
        <div
          className={classes.empty}
          data-testid="lyrics-empty-state"
          role="status"
        >
          {loading
            ? 'Loading lyrics…'
            : error
              ? 'Lyrics unavailable'
              : 'No lyrics available'}
        </div>
      </div>
    )
  }

  return (
    <div
      className={classes.root}
      data-lyrics-quality={quality}
      data-testid="karaoke-lyrics-panel"
    >
      <div
        ref={bodyRef}
        className={clsx(classes.body, inline && classes.inlineBody)}
        data-testid="lyrics-scroll-body"
        onPointerDown={handlePointerDown}
        onScroll={handleScroll}
        onTouchEnd={() => {
          touchStartRef.current = null
        }}
        onTouchMove={handleTouchMove}
        onTouchStart={handleTouchStart}
        onWheel={pauseAutoScroll}
      >
        <div className={classes.lines}>
          {mainLyric.lines.map((line) => {
            const translation = showTranslation
              ? resolvedTranslationMatches[line.index]
              : null
            const pronunciation = showPronunciation
              ? resolvedPronunciationMatches[line.index]
              : null
            const pronunciationMatch = showPronunciation
              ? resolvedPronunciationTokens[line.index]
              : null
            const detailed = detailedIndexes.has(line.index)
            return (
              <div
                key={`${presentationIdentity}:line-${line.index}`}
                ref={(node) => {
                  registerLine(line.index, node)
                  if (node) lineNodesRef.current.set(line.index, node)
                  else lineNodesRef.current.delete(line.index)
                }}
                className={clsx(
                  classes.group,
                  !mainLyric.timed && classes.untimed,
                )}
                data-active="false"
                data-detailed={String(detailed)}
                data-precision={line.precision}
                data-testid="lyrics-line-group"
                role={mainLyric.timed ? 'button' : undefined}
                tabIndex={mainLyric.timed ? 0 : undefined}
                onClick={() => seek(line)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault()
                    seek(line)
                  }
                }}
              >
                <LyricLineRow
                  line={line}
                  detailed={detailed}
                  documentIdentity={presentationIdentity}
                  pronunciationMatch={pronunciationMatch}
                  quality={quality}
                  registerCue={registerCue}
                  className="lyrics-line"
                />
                {pronunciationMatch?.mode === 'line' &&
                  pronunciation?.value &&
                  pronunciation.value !== line.value && (
                    <span
                      className={clsx(
                        classes.aux,
                        'lyrics-pronunciation-fallback',
                      )}
                    >
                      {pronunciation.value}
                    </span>
                  )}
                {translation?.value && translation.value !== line.value && (
                  <span className={clsx(classes.aux, 'lyrics-translation')}>
                    {translation.value}
                  </span>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

export default LyricsPanel
