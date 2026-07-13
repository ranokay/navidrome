import clsx from 'clsx'
import React, { memo } from 'react'
import { waveTimingFor } from './lyricsTimeline'

const CueText = memo(({ cue, cueIndex, lineIndex, quality, registerCue }) => {
  const wave = quality === 'full' ? waveTimingFor(cue) : null
  const canWave = Boolean(wave && cue.graphemes)
  return (
    <span
      ref={(node) => registerCue(lineIndex, cueIndex, node)}
      className="lyrics-cue"
      data-precision={cue.precision}
      style={{ '--lyrics-progress': 0 }}
    >
      {canWave
        ? cue.graphemes.map((grapheme, index) =>
            grapheme.visible ? (
              <span
                className="lyrics-grapheme"
                key={`${grapheme.index}-${grapheme.value}`}
                style={{
                  '--lyrics-wave-index': index,
                  '--lyrics-wave-stagger': `${wave.stagger}ms`,
                }}
              >
                {grapheme.value}
              </span>
            ) : (
              grapheme.value
            ),
          )
        : cue.value}
    </span>
  )
})
CueText.displayName = 'CueText'

const Lane = ({ lane, lineIndex, quality, registerCue }) => (
  <span
    className={clsx('lyrics-lane', lane.role && `lyrics-lane-${lane.role}`)}
  >
    {lane.cues.length > 0
      ? lane.cues.map((cue) => (
          <CueText
            key={cue.id}
            cue={cue}
            cueIndex={cue.sourceIndex}
            lineIndex={lineIndex}
            quality={quality}
            registerCue={registerCue}
          />
        ))
      : lane.value}
  </span>
)

export const LyricLineRow = memo(
  ({ line, detailed, quality, registerCue, className }) => (
    <span className={className}>
      {line.instrumental && !line.value && line.cues.length === 0 ? (
        <span aria-label="Instrumental" className="lyrics-instrumental">
          •••
        </span>
      ) : detailed && line.cues.length > 0 ? (
        line.lanes.map((lane) => (
          <Lane
            key={lane.agentId}
            lane={lane}
            lineIndex={line.index}
            quality={quality}
            registerCue={registerCue}
          />
        ))
      ) : (
        line.value || line.cues.map((cue) => cue.value).join('')
      )}
    </span>
  ),
)
LyricLineRow.displayName = 'LyricLineRow'
