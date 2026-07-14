from pathlib import Path


def replace_once(text, old, new, name):
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f'{name}: expected 1 match, got {count}')
    return text.replace(old, new, 1)


path = Path('ui/src/audioplayer/LyricsPanel.jsx')
text = path.read_text()
text = replace_once(
    text,
    """    transition: `color ${KARAOKE_ANIMATION_MS}ms ${KARAOKE_EASING}, -webkit-text-fill-color ${KARAOKE_ANIMATION_MS}ms ${KARAOKE_EASING}`,
    '@media (prefers-reduced-motion: reduce)': {""",
    """    transition: `color ${KARAOKE_ANIMATION_MS}ms ${KARAOKE_EASING}, -webkit-text-fill-color ${KARAOKE_ANIMATION_MS}ms ${KARAOKE_EASING}`,
    '&[data-timed="true"]': {
      transition: 'none',
    },
    '@media (prefers-reduced-motion: reduce)': {""",
    'timed pronunciation transition',
)
path.write_text(text)

path = Path('ui/src/audioplayer/LyricsLineRows.jsx')
text = path.read_text()
text = replace_once(
    text,
    """                data-testid="lyrics-pronunciation-token"
                data-lyrics-state="future"
                ref={""",
    """                data-testid="lyrics-pronunciation-token"
                data-lyrics-state="future"
                data-timed={pronunciationWindow ? 'true' : 'false'}
                ref={""",
    'timed pronunciation marker',
)
path.write_text(text)

path = Path('ui/src/audioplayer/lyrics.js')
text = path.read_text()
text = replace_once(
    text,
    """const buildBaseKaraokeLine = (line, index, offset = 0) => ({
  index,
  start: applyTimeOffset(line?.start, offset),
  end: applyTimeOffset(line?.end, offset),
  value: typeof line?.value === 'string' ? line.value : '',
  tokens: [],
  lanes: [],
})""",
    """const buildBaseKaraokeLine = (line, index, offset = 0) => ({
  index,
  start: applyTimeOffset(line?.start, offset),
  end: applyTimeOffset(line?.end, offset),
  timingMode: 'line',
  value: typeof line?.value === 'string' ? line.value : '',
  tokens: [],
  lanes: [],
})""",
    'base line timing mode',
)
text = replace_once(
    text,
    """    tokens,
    lanes,
  }
}""",
    """    timingMode: tokens.length > 0 ? 'token' : 'line',
    tokens,
    lanes,
  }
}""",
    'cue line timing mode',
)
text = replace_once(
    text,
    """  for (let i = 0; i < normalized.length; i += 1) {
    if (normalized[i].end == null) {
      const nextStart = normalized[i + 1]?.start
      if (nextStart != null) normalized[i].end = nextStart
    }
  }

  return normalized""",
    """  return normalized""",
    'remove inferred end mutation',
)
path.write_text(text)

path = Path('ui/src/audioplayer/lyricsTimeline.js')
text = path.read_text()
text = replace_once(
    text,
    """const latestExplicitTokenEnd = (line) => {
  const tokens = Array.isArray(line?.tokens) ? line.tokens : []
  let latest = null
  for (const token of tokens) {
    const end = finiteTime(token?.end)
    if (end != null && (latest == null || end > latest)) latest = end
  }
  return latest
}
""",
    """const latestExplicitTokenEnd = (line) => {
  const tokens = Array.isArray(line?.tokens) ? line.tokens : []
  let latest = null
  for (const token of tokens) {
    const end = finiteTime(token?.end)
    if (end != null && (latest == null || end > latest)) latest = end
  }
  return latest
}

const estimateLineSpokenDuration = (line) => {
  const compactLength = Array.from(
    String(line?.value || '').replace(/\\s+/g, ''),
  ).length
  const words = String(line?.value || '')
    .trim()
    .split(/\\s+/)
    .filter(Boolean).length
  const estimate = 480 + words * 285 + compactLength * 18
  return Math.max(800, Math.min(6000, estimate))
}

const inferLineTimedEnd = (line, start, nextStart, trackEnd) => {
  const estimatedEnd = start + estimateLineSpokenDuration(line)
  const boundary = nextStart ?? trackEnd
  if (boundary == null) return estimatedEnd
  const interval = Math.max(0, boundary - start)
  if (interval <= 0) return boundary
  const releaseGap = Math.min(420, Math.max(120, interval * 0.14))
  const latestEnd = Math.max(start + Math.min(650, interval), boundary - releaseGap)
  return Math.min(estimatedEnd, latestEnd, boundary)
}
""",
    'line timing helpers',
)
text = replace_once(
    text,
    """    let end = finiteTime(line?.end) ?? latestExplicitTokenEnd(line)
    if (end == null) end = nextTimedStarts[lineIndex]
    if (end == null && start != null) {
      end = start + fallbackLineDurationMs
      if (trackEnd != null) end = Math.min(end, trackEnd)
    }""",
    """    let end = finiteTime(line?.end) ?? latestExplicitTokenEnd(line)
    if (end == null && start != null && line?.timingMode === 'line') {
      end = inferLineTimedEnd(
        line,
        start,
        nextTimedStarts[lineIndex],
        trackEnd,
      )
    }
    if (end == null) end = nextTimedStarts[lineIndex]
    if (end == null && start != null) {
      end = start + fallbackLineDurationMs
      if (trackEnd != null) end = Math.min(end, trackEnd)
    }""",
    'line timing selection',
)
path.write_text(text)

path = Path('ui/src/audioplayer/lyricsTimeline.test.js')
text = path.read_text()
marker = """  it('caps a final open line with track duration', () => {"""
insert = """  it('ends line-timed lyrics before the next timestamp when no end exists', () => {
    const timeline = buildLyricsTimeline([
      {
        start: 1000,
        value: 'A short lyric line',
        timingMode: 'line',
        tokens: [],
      },
      { start: 5000, end: 6000, timingMode: 'line', tokens: [] },
    ])
    const cursor = new LyricTimelineCursor(timeline)

    expect(timeline.windows[0].end).toBeGreaterThan(1000)
    expect(timeline.windows[0].end).toBeLessThan(5000)
    expect(cursor.update(1500, true).indexes).toEqual([0])
    expect(cursor.update(timeline.windows[0].end + 1).indexes).toEqual([])
  })

"""
text = replace_once(text, marker, insert + marker, 'line timing test')
path.write_text(text)

path = Path('ui/src/audioplayer/LyricsPanel.test.jsx')
text = path.read_text()
text = replace_once(
    text,
    """    expect(pronunciation.style.transition).toBe('')
  })""",
    """    expect(pronunciation).toHaveAttribute('data-timed', 'true')
    expect(pronunciation.style.transition).toBe('')
  })""",
    'timed pronunciation test',
)
path.write_text(text)
