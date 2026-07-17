import clsx from 'clsx'
import React, { memo, useCallback, useLayoutEffect, useRef } from 'react'

const CueOverlay = memo(
  ({ cue, lineIndex, quality, registerCue, role, value }) => {
    const canWave =
      quality === 'full' && cue.graphemes?.some((part) => part.visible)
    return (
      <span
        ref={(node) => registerCue(lineIndex, cue.sourceIndex, node, 'main')}
        className={clsx(
          'lyrics-cue',
          role && `lyrics-lane-${role}`,
          role === 'background' && 'lyrics-lane-bg',
        )}
        data-precision={cue.precision}
        style={{
          '--lyrics-progress': 0,
          '--lyrics-token-lift': 0,
        }}
      >
        {canWave
          ? cue.graphemes.map((grapheme) =>
              grapheme.visible ? (
                <span
                  className="lyrics-grapheme"
                  key={`${grapheme.index}-${grapheme.value}`}
                  style={{ '--lyrics-grapheme-lift': 0 }}
                >
                  {grapheme.value}
                </span>
              ) : (
                grapheme.value
              ),
            )
          : value}
      </span>
    )
  },
)
CueOverlay.displayName = 'CueOverlay'

const TimedOverlay = ({ line, quality, registerCue }) => (
  <span aria-hidden="true" className="lyrics-presentation">
    {line.displaySegments.map((segment) => {
      if (segment.kind !== 'cue') return segment.value
      const cue = line.cuesBySourceIndex[segment.cueIndex]
      if (!cue) return segment.value
      return (
        <CueOverlay
          key={`${line.index}-${segment.id}`}
          cue={cue}
          lineIndex={line.index}
          quality={quality}
          registerCue={registerCue}
          role={segment.agentRole}
          value={segment.value}
        />
      )
    })}
  </span>
)

const layoutPronunciation = (root) => {
  if (!root) return
  const measure = root.querySelector('.lyrics-pronunciation-measure')
  const tokens = Array.from(
    root.querySelectorAll('.lyrics-pronunciation-token'),
  )
  const rootRect = root.getBoundingClientRect()
  const rows = new Map()
  let fallback = !measure || rootRect.width <= 0

  tokens.forEach((token) => {
    token.style.removeProperty('left')
    token.style.removeProperty('top')
    const cueIndex = token.dataset.mainCueIndex
    const slot = measure?.querySelector(`[data-main-cue-index="${cueIndex}"]`)
    const rects = slot ? Array.from(slot.getClientRects()) : []
    if (rects.length !== 1) {
      fallback = true
      return
    }
    const rect = rects[0]
    const rowKey = Math.round(rect.top - rootRect.top)
    if (!rows.has(rowKey)) rows.set(rowKey, [])
    rows.get(rowKey).push({
      token,
      center: rect.left - rootRect.left + rect.width / 2,
      top: rect.top - rootRect.top + 25,
      width: token.getBoundingClientRect().width,
    })
  })

  rows.forEach((row) => {
    row.sort((left, right) => left.center - right.center)
    const required = row.reduce(
      (width, entry) => width + entry.width + (width ? 4 : 0),
      0,
    )
    if (required > rootRect.width) {
      fallback = true
      return
    }
    let right = 0
    row.forEach((entry) => {
      entry.left = Math.max(0, entry.center - entry.width / 2, right + 4)
      right = entry.left + entry.width
    })
    const overflow = Math.max(0, right - rootRect.width)
    if (overflow > 0) {
      row.forEach((entry) => {
        entry.left -= overflow
      })
    }
    if (row[0]?.left < 0) fallback = true
  })

  root.dataset.fallback = String(fallback)
  if (fallback) return
  rows.forEach((row) => {
    row.forEach(({ token, left, top }) => {
      token.style.left = `${left}px`
      token.style.top = `${top}px`
    })
  })
}

const PronunciationTokens = memo(
  ({ line, match, registerCue, documentIdentity }) => {
    const rootRef = useRef(null)
    const layout = useCallback(() => layoutPronunciation(rootRef.current), [])

    useLayoutEffect(() => {
      layout()
      if (typeof ResizeObserver !== 'function' || !rootRef.current)
        return undefined
      const observer = new ResizeObserver(layout)
      observer.observe(rootRef.current)
      return () => observer.disconnect()
    }, [documentIdentity, layout, match])

    return (
      <span
        className="lyrics-pronunciation-layer"
        data-fallback="false"
        ref={rootRef}
      >
        <span aria-hidden="true" className="lyrics-pronunciation-measure">
          {line.displaySegments.map((segment) =>
            segment.kind === 'cue' ? (
              <span
                data-main-cue-index={segment.cueIndex}
                key={`measure-${segment.id}`}
              >
                {segment.value}
              </span>
            ) : (
              segment.value
            ),
          )}
        </span>
        <span className="lyrics-pronunciation-token-layer">
          {match.tokens.map((token) => (
            <span
              className="lyrics-pronunciation-token"
              data-main-cue-index={token.mainCueIndex}
              key={token.id}
              ref={(node) =>
                registerCue(line.index, token.mainCueIndex, node, token.id)
              }
              style={{ '--lyrics-progress': 0 }}
            >
              {token.value}
            </span>
          ))}
        </span>
        <span className="lyrics-pronunciation-layout-fallback">
          {match.line.value}
        </span>
      </span>
    )
  },
)
PronunciationTokens.displayName = 'PronunciationTokens'

export const LyricLineRow = memo(
  ({
    className,
    detailed,
    documentIdentity,
    line,
    pronunciationMatch,
    quality,
    registerCue,
  }) => {
    const value =
      line.instrumental && !line.value && line.cues.length === 0
        ? '•••'
        : line.value
    const tokenPronunciation = pronunciationMatch?.mode === 'tokens'
    return (
      <span
        className={className}
        data-token-pronunciation={String(tokenPronunciation)}
      >
        <span
          aria-label={
            line.instrumental && !line.value ? 'Instrumental' : undefined
          }
          className={clsx(
            'lyrics-base',
            line.instrumental && !line.value && 'lyrics-instrumental',
          )}
          data-testid="lyrics-base-text"
        >
          {value}
        </span>
        {detailed && line.cues.length > 0 && line.hasValidCueRanges ? (
          <TimedOverlay
            line={line}
            quality={quality}
            registerCue={registerCue}
          />
        ) : null}
        {tokenPronunciation ? (
          <PronunciationTokens
            documentIdentity={documentIdentity}
            line={line}
            match={pronunciationMatch}
            registerCue={registerCue}
          />
        ) : null}
      </span>
    )
  },
)
LyricLineRow.displayName = 'LyricLineRow'
