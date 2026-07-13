import Typography from '@material-ui/core/Typography'
import clsx from 'clsx'
import React, { memo, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { buildSegmentsFromLine } from './lyricsSegments'
import {
  TOKEN_ACTIVE_ALPHA,
  TOKEN_FUTURE_ALPHA,
  TOKEN_WIPE_EDGE_PCT,
  TOKEN_WIPE_SOFT_SPREAD_PCT,
} from './lyricsKaraokeConstants'
import {
  buildEmphasisStyle,
  isEmphasisRole,
  parseColorRGB,
} from './lyricsKaraokeStyles'
import { resolveKaraokeTokenWindows } from './lyricsTimeline'

const EMPHASIS_TONE = 0.7

const tokenColor = (rgb, alpha) => {
  const [r, g, b] = rgb || [255, 255, 255]
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

const toneEmphasisRGB = (rgb) =>
  rgb ? rgb.map((channel) => Math.round(channel * EMPHASIS_TONE)) : rgb

const getTokenRGB = (token, rgb) =>
  isEmphasisRole(token) ? toneEmphasisRGB(rgb) : rgb

const toneEmphasisColor = (color) => {
  const rgb = parseColorRGB(color)
  if (!rgb) return color

  const alpha = String(color).match(/rgba?\([^)]*?,\s*([\d.]+)\s*\)$/)?.[1]
  return tokenColor(toneEmphasisRGB(rgb), alpha == null ? 1 : Number(alpha))
}

const buildLineStyle = (line, style) => {
  const emphasisStyle = buildEmphasisStyle(line)
  if (!emphasisStyle) return style

  const emphasisColor = style?.color ? toneEmphasisColor(style.color) : null
  return {
    ...style,
    ...emphasisStyle,
    ...(emphasisColor
      ? {
          color: emphasisColor,
          WebkitTextFillColor: emphasisColor,
        }
      : {}),
  }
}

const buildStaticEmphasisStyle = (token, color) => {
  const emphasisStyle = buildEmphasisStyle(token)
  if (!emphasisStyle) return undefined

  const emphasisColor = color ? toneEmphasisColor(color) : null
  return {
    ...emphasisStyle,
    ...(emphasisColor
      ? {
          color: emphasisColor,
          WebkitTextFillColor: emphasisColor,
        }
      : {}),
  }
}

const buildInactiveTokenStyle = (token, rgb) => {
  const tonedRGB = getTokenRGB(token, rgb)
  const color = tokenColor(tonedRGB, TOKEN_FUTURE_ALPHA)
  return {
    color,
    WebkitTextFillColor: color,
    backgroundImage: 'none',
    ...buildEmphasisStyle(token),
  }
}

const buildTimelineTokenStyle = (token, rgb, window) => {
  if (!window || window.start == null || window.end == null) {
    return buildInactiveTokenStyle(token, rgb)
  }
  const tonedRGB = getTokenRGB(token, rgb)
  const doneColor = tokenColor(tonedRGB, TOKEN_ACTIVE_ALPHA)
  const futureColor = tokenColor(tonedRGB, TOKEN_FUTURE_ALPHA)
  return {
    '--lyrics-progress': 0,
    color: 'transparent',
    WebkitTextFillColor: 'transparent',
    backgroundImage: `linear-gradient(90deg, ${doneColor} 0%, ${doneColor} calc(var(--lyrics-progress) * 100% - ${TOKEN_WIPE_EDGE_PCT}%), ${doneColor} calc(var(--lyrics-progress) * 100%), ${futureColor} calc(var(--lyrics-progress) * 100% + ${TOKEN_WIPE_SOFT_SPREAD_PCT}%), ${futureColor} 100%)`,
    backgroundSize: '100% 100%',
    backgroundClip: 'text',
    WebkitBackgroundClip: 'text',
    ...buildEmphasisStyle(token),
  }
}

const tokenRef = ({
  registerToken,
  key,
  lineIndex,
  window,
}) => (node) => {
  registerToken?.(key, { lineIndex, window }, node)
}

export const KaraokeLineRow = memo(
  ({
    lineIndex,
    line,
    nextLineStart,
    className,
    style,
    tokenClassName,
    registerToken,
    rowKey = 'main',
    testId,
  }) => {
    const segments = useMemo(() => buildSegmentsFromLine(line), [line])
    const windows = useMemo(
      () => resolveKaraokeTokenWindows(line, nextLineStart),
      [line, nextLineStart],
    )
    const tokenRGB = useMemo(
      () => (style?.color ? parseColorRGB(style.color) : [255, 255, 255]),
      [style?.color],
    )
    const lineStyle = useMemo(() => buildLineStyle(line, style), [line, style])

    return (
      <Typography
        className={className}
        component="div"
        data-testid={testId}
        style={lineStyle}
      >
        {segments.map((segment, idx) => {
          if (!segment.token)
            return <span key={`text-${idx}`}>{segment.text}</span>

          const window = windows[segment.tokenIndex]
          const key = `${lineIndex}:${rowKey}:${segment.tokenIndex}:main`
          return (
            <span
              key={`token-${idx}-${window?.start ?? 'na'}`}
              className={tokenClassName}
              data-testid="lyrics-token"
              data-lyrics-state="future"
              ref={tokenRef({
                registerToken,
                key,
                lineIndex,
                window,
              })}
              style={buildTimelineTokenStyle(segment.token, tokenRGB, window)}
            >
              {segment.text}
            </span>
          )
        })}
      </Typography>
    )
  },
  (prevProps, nextProps) =>
    prevProps.lineIndex === nextProps.lineIndex &&
    prevProps.line === nextProps.line &&
    prevProps.nextLineStart === nextProps.nextLineStart &&
    prevProps.className === nextProps.className &&
    prevProps.style === nextProps.style &&
    prevProps.tokenClassName === nextProps.tokenClassName &&
    prevProps.registerToken === nextProps.registerToken &&
    prevProps.rowKey === nextProps.rowKey &&
    prevProps.testId === nextProps.testId,
)

KaraokeLineRow.displayName = 'KaraokeLineRow'

const splitTextSegments = (value) =>
  (value || '')
    .split(/(\s+)/)
    .filter((text) => text.length > 0)
    .map((text) => ({
      text,
      token: null,
      tokenIndex: -1,
      isWhitespace: /^\s+$/.test(text),
    }))

const buildPronunciationParts = (line) => {
  if (!line?.value) return []

  const segments = buildSegmentsFromLine(line)
  const tokenParts = segments
    .filter((segment) => segment.token && segment.text.trim())
    .map((segment) => ({
      text: segment.text.trim(),
      segment,
    }))

  if (tokenParts.length > 0) return tokenParts

  return splitTextSegments(line.value)
    .filter((segment) => !segment.isWhitespace)
    .map((segment) => ({
      text: segment.text.trim(),
      segment: null,
    }))
}

const canPairPronunciationSegment = (segment, hasTokenSegments) =>
  Boolean(
    segment.token ||
    (!hasTokenSegments && !segment.isWhitespace && segment.text.trim()),
  )

const buildStackedPronunciationSegments = (line, pronunciationLine) => {
  const lineSegments = buildSegmentsFromLine(line)
  const hasTokenSegments = lineSegments.some((segment) => segment.token)
  const mainSegments = hasTokenSegments
    ? lineSegments
    : splitTextSegments(line?.value || '')
  const pronunciationParts = buildPronunciationParts(pronunciationLine)
  const pairableSegments = mainSegments.filter((segment) =>
    canPairPronunciationSegment(segment, hasTokenSegments),
  )

  if (
    !hasTokenSegments &&
    pronunciationParts.length > 0 &&
    pairableSegments.length > 0 &&
    pronunciationParts.length !== pairableSegments.length
  ) {
    return [
      {
        text: line?.value || '',
        token: null,
        tokenIndex: -1,
        isWhitespace: false,
        pronunciation: pronunciationLine?.value?.trim() || '',
        pronunciationSegment: null,
      },
    ]
  }

  const plainPronunciationParts = []
  const emphasisPronunciationParts = []
  for (const part of pronunciationParts) {
    if (hasTokenSegments && isEmphasisRole(part.segment?.token)) {
      emphasisPronunciationParts.push(part)
    } else {
      plainPronunciationParts.push(part)
    }
  }

  let pronunciationIndex = 0
  let plainPronunciationIndex = 0
  let emphasisPronunciationIndex = 0

  const getPronunciationPart = (segment) => {
    if (!hasTokenSegments) {
      const part = pronunciationParts[pronunciationIndex] || null
      pronunciationIndex += 1
      return part
    }

    if (isEmphasisRole(segment.token)) {
      const part =
        emphasisPronunciationParts[emphasisPronunciationIndex] || null
      emphasisPronunciationIndex += 1
      return part
    }

    const part = plainPronunciationParts[plainPronunciationIndex] || null
    plainPronunciationIndex += 1
    return part
  }

  return mainSegments.map((segment) => {
    if (!canPairPronunciationSegment(segment, hasTokenSegments)) {
      return { ...segment, pronunciation: '' }
    }
    const pronunciationPart = getPronunciationPart(segment)
    return {
      ...segment,
      pronunciation: pronunciationPart?.text || '',
      pronunciationSegment: pronunciationPart?.segment || null,
    }
  })
}

export const KaraokeStackedLineRow = memo(
  ({
    lineIndex,
    line,
    pronunciationLine,
    pronunciationStyle,
    nextLineStart,
    className,
    style,
    tokenClassName,
    classes,
    registerToken,
    rowKey = 'main',
    testId,
  }) => {
    const rowRef = useRef(null)
    const [isWrapped, setIsWrapped] = useState(false)
    const segments = useMemo(
      () => buildStackedPronunciationSegments(line, pronunciationLine),
      [line, pronunciationLine],
    )
    const mainWindows = useMemo(
      () => resolveKaraokeTokenWindows(line, nextLineStart),
      [line, nextLineStart],
    )
    const pronunciationWindows = useMemo(
      () => resolveKaraokeTokenWindows(pronunciationLine, null),
      [pronunciationLine],
    )
    const tokenRGB = useMemo(
      () => (style?.color ? parseColorRGB(style.color) : [255, 255, 255]),
      [style?.color],
    )
    const pronunciationRGB = useMemo(
      () =>
        pronunciationStyle?.color
          ? parseColorRGB(pronunciationStyle.color)
          : [255, 255, 255],
      [pronunciationStyle?.color],
    )
    const lineStyle = useMemo(() => buildLineStyle(line, style), [line, style])

    useLayoutEffect(() => {
      const row = rowRef.current
      if (!row) return undefined

      const updateWrappedState = () => {
        const tokenRows = new Set(
          Array.from(row.querySelectorAll('[data-stacked-token="true"]')).map(
            (node) => node.offsetTop,
          ),
        )
        const wrapped = tokenRows.size > 1
        setIsWrapped((current) => (current === wrapped ? current : wrapped))
      }

      updateWrappedState()
      const ResizeObserverConstructor =
        typeof window !== 'undefined' ? window.ResizeObserver : null
      if (!ResizeObserverConstructor) return undefined
      const resizeObserver = new ResizeObserverConstructor(updateWrappedState)
      resizeObserver.observe(row)
      return () => resizeObserver.disconnect()
    }, [segments])

    return (
      <Typography
        className={clsx(className, {
          [classes.wrappedStackedLine]: isWrapped,
        })}
        component="div"
        data-wrapped={isWrapped ? 'true' : 'false'}
        data-testid={testId}
        ref={rowRef}
        style={lineStyle}
      >
        {segments.map((segment, idx) => {
          const mainWindow = segment.token
            ? mainWindows[segment.tokenIndex]
            : null
          const mainKey = `${lineIndex}:${rowKey}:${segment.tokenIndex}:main`
          const mainText = segment.token ? (
            <span
              className={clsx(tokenClassName, classes.stackedMainText)}
              data-testid="lyrics-token"
              data-lyrics-state="future"
              ref={tokenRef({
                registerToken,
                key: mainKey,
                lineIndex,
                window: mainWindow,
              })}
              style={buildTimelineTokenStyle(
                segment.token,
                tokenRGB,
                mainWindow,
              )}
            >
              {segment.text}
            </span>
          ) : (
            <span
              className={classes.stackedMainText}
              style={buildStaticEmphasisStyle(segment.token, style?.color)}
            >
              {segment.text}
            </span>
          )

          if (!segment.pronunciation) return mainText

          const pronunciationToken = segment.pronunciationSegment?.token
          const pronunciationWindow = pronunciationToken
            ? pronunciationWindows[segment.pronunciationSegment.tokenIndex]
            : mainWindow
          const pronunciationKey = `${lineIndex}:${rowKey}:${segment.tokenIndex}:pronunciation`
          return (
            <span
              key={`stacked-${idx}-${mainWindow?.start ?? segment.text}`}
              className={classes.stackedToken}
              data-stacked-token="true"
            >
              {mainText}
              <span
                className={classes.stackedPronunciation}
                data-testid="lyrics-pronunciation-token"
                data-lyrics-state="future"
                ref={
                  pronunciationWindow
                    ? tokenRef({
                        registerToken,
                        key: pronunciationKey,
                        lineIndex,
                        window: pronunciationWindow,
                      })
                    : undefined
                }
                style={
                  pronunciationWindow
                    ? buildTimelineTokenStyle(
                        pronunciationToken || segment.token,
                        pronunciationRGB,
                        pronunciationWindow,
                      )
                    : {
                        color: pronunciationStyle?.color,
                        WebkitTextFillColor: pronunciationStyle?.color,
                        backgroundImage: 'none',
                        ...buildStaticEmphasisStyle(
                          pronunciationToken || segment.token,
                          pronunciationStyle?.color,
                        ),
                      }
                }
              >
                {segment.pronunciation}
              </span>
            </span>
          )
        })}
      </Typography>
    )
  },
  (prevProps, nextProps) =>
    prevProps.lineIndex === nextProps.lineIndex &&
    prevProps.line === nextProps.line &&
    prevProps.pronunciationLine === nextProps.pronunciationLine &&
    prevProps.pronunciationStyle === nextProps.pronunciationStyle &&
    prevProps.nextLineStart === nextProps.nextLineStart &&
    prevProps.className === nextProps.className &&
    prevProps.style === nextProps.style &&
    prevProps.tokenClassName === nextProps.tokenClassName &&
    prevProps.classes === nextProps.classes &&
    prevProps.registerToken === nextProps.registerToken &&
    prevProps.rowKey === nextProps.rowKey &&
    prevProps.testId === nextProps.testId,
)

KaraokeStackedLineRow.displayName = 'KaraokeStackedLineRow'
