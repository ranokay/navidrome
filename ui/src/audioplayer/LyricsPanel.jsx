import { makeStyles } from '@material-ui/core/styles'
import React, { useMemo } from 'react'
import { buildLayerLineIndex, hasStructuredLyricContent } from './lyrics'

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
  },
  lines: {
    display: 'flex',
    flexDirection: 'column',
    gap: theme.spacing(3),
  },
  group: {
    borderRadius: theme.shape.borderRadius,
    opacity: 0.72,
    '&:focus-visible': {
      outline: `2px solid ${theme.palette.primary.main}`,
      outlineOffset: 3,
    },
  },
  line: {
    display: 'block',
    fontSize: 24,
    lineHeight: 1.18,
    fontWeight: 700,
    whiteSpace: 'pre-wrap',
    overflowWrap: 'anywhere',
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

const LyricsPanel = ({
  mainLyric,
  translationLyric,
  pronunciationLyric,
  translationMatches,
  pronunciationMatches,
  showTranslation,
  showPronunciation,
  audioInstance,
  loading = false,
  error = null,
}) => {
  const classes = useStyles()
  const translations = useMemo(
    () =>
      translationMatches || buildLayerLineIndex(mainLyric, translationLyric),
    [mainLyric, translationLyric, translationMatches],
  )
  const pronunciations = useMemo(
    () =>
      pronunciationMatches ||
      buildLayerLineIndex(mainLyric, pronunciationLyric),
    [mainLyric, pronunciationLyric, pronunciationMatches],
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

  const seek = (line) => {
    if (!audioInstance || line.start == null) return
    audioInstance.currentTime = line.start / 1000
  }

  return (
    <div className={classes.root} data-testid="karaoke-lyrics-panel">
      <div className={classes.body} data-testid="lyrics-scroll-body">
        <div className={classes.lines}>
          {mainLyric.lines.map((line) => {
            const translation = showTranslation
              ? translations[line.index]
              : null
            const pronunciation = showPronunciation
              ? pronunciations[line.index]
              : null
            return (
              <div
                key={line.index}
                className={classes.group}
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
                <span className={classes.line}>
                  {line.instrumental && !line.value ? '•••' : line.value}
                </span>
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
