import { makeStyles } from '@material-ui/core/styles'
import clsx from 'clsx'
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { buildLayerLineIndex, hasStructuredLyricContent } from './lyrics'
import { LyricLineRow } from './LyricsLineRows'
import {
  KARAOKE_DESKTOP_ACTIVE_LINE_ANCHOR_RATIO,
  KARAOKE_INLINE_ACTIVE_LINE_ANCHOR_RATIO,
  KARAOKE_MANUAL_SCROLL_PAUSE_MS,
} from './lyricsKaraokeConstants'
import useLyricsTimeline from './useLyricsTimeline'

const useStyles = makeStyles((theme) => ({
  root: {
    height: '100%',
    minHeight: 0,
    display: 'flex',
    flexDirection: 'column',
    color: theme.palette.text.primary,
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
    contentVisibility: 'auto',
    containIntrinsicSize: '0 72px',
    borderRadius: theme.shape.borderRadius,
    cursor: 'pointer',
    opacity: 0.42,
    transform: 'translateY(0)',
    transition: 'opacity 180ms ease, transform 180ms ease',
    '&[data-active="true"]': {
      opacity: 1,
      transform: 'translateY(-2px)',
    },
    '&:focus-visible': {
      outline: `2px solid ${theme.palette.primary.main}`,
      outlineOffset: 3,
    },
    '& .lyrics-line': {
      display: 'block',
      fontSize: 24,
      lineHeight: 1.18,
      fontWeight: 700,
      whiteSpace: 'pre-wrap',
      overflowWrap: 'anywhere',
    },
    '& .lyrics-lane': { display: 'block' },
    '& .lyrics-lane-background, & .lyrics-lane-bg': {
      fontSize: 21,
      opacity: 0.76,
    },
    '& .lyrics-cue': {
      color: 'transparent',
      backgroundImage: `linear-gradient(90deg, ${theme.palette.primary.main} 0%, ${theme.palette.primary.main} calc(var(--lyrics-progress) * 100%), ${theme.palette.text.primary} calc(var(--lyrics-progress) * 100%), ${theme.palette.text.primary} 100%)`,
      backgroundClip: 'text',
      WebkitBackgroundClip: 'text',
    },
    '& .lyrics-grapheme': {
      display: 'inline-block',
      transform:
        'translateY(calc(sin((var(--lyrics-progress) * 8 - var(--lyrics-wave-index)) * 1rad) * -2px))',
      transition: 'transform var(--lyrics-wave-stagger) linear',
    },
    '@media (prefers-reduced-motion: reduce)': {
      transition: 'none',
      transform: 'none !important',
      '& .lyrics-grapheme': { transform: 'none', transition: 'none' },
    },
  },
  untimed: {
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
    opacity: 0.72,
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
  const reducedMotion = useReducedMotion()
  const { activeIndexes, quality, registerLine, registerCue } =
    useLyricsTimeline({
      document: mainLyric,
      audioInstance,
      visible,
      reducedMotion,
    })
  const primaryIndex = activeIndexes.at(-1) ?? -1
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

  const scrollToActive = useCallback(() => {
    if (
      !mainLyric?.timed ||
      primaryIndex < 0 ||
      Date.now() < manualUntilRef.current
    )
      return
    const body = bodyRef.current
    const line = lineNodesRef.current.get(primaryIndex)
    if (!body || !line) return
    const anchor = inline
      ? KARAOKE_INLINE_ACTIVE_LINE_ANCHOR_RATIO
      : KARAOKE_DESKTOP_ACTIVE_LINE_ANCHOR_RATIO
    const top =
      line.offsetTop - body.clientHeight * anchor + line.offsetHeight / 2
    const options = {
      top: Math.max(0, top),
      behavior: reducedMotion ? 'auto' : 'smooth',
    }
    if (typeof body.scrollTo === 'function') body.scrollTo(options)
    else body.scrollTop = options.top
  }, [inline, mainLyric?.timed, primaryIndex, reducedMotion])

  useEffect(scrollToActive, [scrollToActive])
  useEffect(() => {
    if (typeof ResizeObserver !== 'function' || !bodyRef.current)
      return undefined
    const observer = new ResizeObserver(scrollToActive)
    observer.observe(bodyRef.current)
    return () => observer.disconnect()
  }, [scrollToActive])
  useEffect(() => () => clearTimeout(resumeTimerRef.current), [])

  const pauseAutoScroll = useCallback(() => {
    if (!mainLyric?.timed) return
    manualUntilRef.current = Date.now() + KARAOKE_MANUAL_SCROLL_PAUSE_MS
    clearTimeout(resumeTimerRef.current)
    resumeTimerRef.current = setTimeout(
      scrollToActive,
      KARAOKE_MANUAL_SCROLL_PAUSE_MS,
    )
  }, [mainLyric?.timed, scrollToActive])

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

  const seek = (line) => {
    if (!audioInstance || line.start == null) return
    audioInstance.currentTime = line.start / 1000
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
        onWheel={pauseAutoScroll}
        onPointerDown={pauseAutoScroll}
        onTouchStart={pauseAutoScroll}
      >
        <div className={classes.lines}>
          {mainLyric.lines.map((line) => {
            const translation = showTranslation
              ? resolvedTranslationMatches[line.index]
              : null
            const pronunciation = showPronunciation
              ? resolvedPronunciationMatches[line.index]
              : null
            const detailed = detailedIndexes.has(line.index)
            return (
              <div
                key={line.index}
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
                  quality={quality}
                  registerCue={registerCue}
                  className="lyrics-line"
                />
                {pronunciation?.value && pronunciation.value !== line.value && (
                  <span className={classes.aux}>{pronunciation.value}</span>
                )}
                {translation?.value && translation.value !== line.value && (
                  <span className={classes.aux}>{translation.value}</span>
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
