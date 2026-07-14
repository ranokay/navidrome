from pathlib import Path


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f'{label}: expected one match, found {count}')
    return text.replace(old, new, 1)


# Preserve source/display order and retain timed blank rows as timing-only markers.
path = Path('ui/src/audioplayer/lyrics.js')
text = path.read_text()
text = replace_once(
    text,
    """  const renderableLines = lines.filter(
    (line) => line.value || line.tokens.length > 0,
  )
  const hasUntimedLines = renderableLines.some((line) => line.start == null)
  const normalized = renderableLines.sort((a, b) => {
    if (hasUntimedLines) return a.index - b.index
    if (a.start == null && b.start == null) return a.index - b.index
    if (a.start == null) return 1
    if (b.start == null) return -1
    if (a.start !== b.start) return a.start - b.start
    return a.index - b.index
  })

  return normalized
""",
    """  return lines
    .map((line) => ({
      ...line,
      renderable: Boolean(line.value?.trim() || line.tokens.length > 0),
    }))
    .sort((a, b) => a.index - b.index)
""",
    'preserve source order and timing markers',
)
text = replace_once(
    text,
    """  lines.some(
    (line) =>
      toTime(line?.start) != null ||
      (Array.isArray(line?.tokens) &&
        line.tokens.some(
          (token) => toTime(token?.start) != null || toTime(token?.end) != null,
        )),
  )
""",
    """  lines.some(
    (line) =>
      line?.renderable !== false &&
      (toTime(line?.start) != null ||
        (Array.isArray(line?.tokens) &&
          line.tokens.some(
            (token) =>
              toTime(token?.start) != null || toTime(token?.end) != null,
          )))
  )
""",
    'ignore timing-only rows for usable timing',
)
path.write_text(text)


# Build timing order independently from display order and exclude timing-only rows
# from active/scroll events while still using their timestamps as boundaries.
path = Path('ui/src/audioplayer/lyricsTimeline.js')
text = path.read_text()
text = replace_once(
    text,
    """const sameIndexes = (left, right) =>
  left.length === right.length &&
  left.every((value, index) => value === right[index])
""",
    """const sameIndexes = (left, right) =>
  left.length === right.length &&
  left.every((value, index) => value === right[index])

const getPrimaryActiveIndex = (timeline, indexes) =>
  indexes.reduce((primaryIndex, lineIndex) => {
    if (primaryIndex < 0) return lineIndex
    const primary = timeline?.windows?.[primaryIndex]
    const candidate = timeline?.windows?.[lineIndex]
    if ((candidate?.start ?? -Infinity) !== (primary?.start ?? -Infinity)) {
      return (candidate?.start ?? -Infinity) > (primary?.start ?? -Infinity)
        ? lineIndex
        : primaryIndex
    }
    return lineIndex > primaryIndex ? lineIndex : primaryIndex
  }, -1)
""",
    'primary active line helper',
)
text = replace_once(
    text,
    """  const nextTimedStarts = new Array(sourceLines.length).fill(null)
  let nextStart = null
  for (let index = sourceLines.length - 1; index >= 0; index -= 1) {
    nextTimedStarts[index] = nextStart
    if (starts[index] != null) nextStart = starts[index]
  }
""",
    """  const nextTimedStarts = new Array(sourceLines.length).fill(null)
  const timedEntries = starts
    .map((start, lineIndex) => ({ start, lineIndex }))
    .filter((entry) => entry.start != null)
    .sort(
      (left, right) =>
        left.start - right.start || left.lineIndex - right.lineIndex,
    )
  let nextDistinctStart = null
  for (let index = timedEntries.length - 1; index >= 0; ) {
    const groupStart = timedEntries[index].start
    let groupIndex = index
    while (groupIndex >= 0 && timedEntries[groupIndex].start === groupStart) {
      nextTimedStarts[timedEntries[groupIndex].lineIndex] = nextDistinctStart
      groupIndex -= 1
    }
    nextDistinctStart = groupStart
    index = groupIndex
  }
""",
    'chronological next timed starts',
)
text = replace_once(
    text,
    """    const valid = start != null && end != null && end > start
    return {
      lineIndex,
      start,
      end,
      valid,
""",
    """    const renderable = line?.renderable !== false
    const intervalValid = start != null && end != null && end > start
    const valid = renderable && intervalValid
    return {
      lineIndex,
      start,
      end,
      renderable,
      intervalValid,
      valid,
""",
    'timing-only timeline window',
)
text = replace_once(
    text,
    """    this.result.primaryIndex = indexes.at(-1) ?? -1
""",
    """    this.result.primaryIndex = getPrimaryActiveIndex(this.timeline, indexes)
""",
    'chronological primary line',
)
path.write_text(text)


# Do not render or match timing-only rows, while keeping their array indexes for
# the timeline and source-order mapping.
path = Path('ui/src/audioplayer/LyricsPanel.jsx')
text = path.read_text()
text = replace_once(
    text,
    """  for (let layerIndex = 0; layerIndex < layerLines.length; layerIndex += 1) {
    const layerWindow = getLayerMatchWindow(layerLines, layerIndex)
    for (let mainIndex = 0; mainIndex < mainLines.length; mainIndex += 1) {
      const mainWindow = getLayerMatchWindow(mainLines, mainIndex)
""",
    """  for (let layerIndex = 0; layerIndex < layerLines.length; layerIndex += 1) {
    if (layerLines[layerIndex]?.renderable === false) continue
    const layerWindow = getLayerMatchWindow(layerLines, layerIndex)
    for (let mainIndex = 0; mainIndex < mainLines.length; mainIndex += 1) {
      if (mainLines[mainIndex]?.renderable === false) continue
      const mainWindow = getLayerMatchWindow(mainLines, mainIndex)
""",
    'skip timing-only layer matches',
)
text = replace_once(
    text,
    """          {mainLines.map((line, idx) => {
            const trLine = trByMainIndex[idx]
""",
    """          {mainLines.map((line, idx) => {
            if (line.renderable === false) return null
            const trLine = trByMainIndex[idx]
""",
    'skip timing-only rendering',
)
path.write_text(text)


# Parser/model tests for source order and timing-only rows.
path = Path('ui/src/audioplayer/lyrics.test.js')
text = path.read_text()
marker = """  it('estimates token windows when cue token timing is collapsed', () => {
"""
tests = """  it('preserves source display order independently from timestamps', () => {
    const lines = buildKaraokeLines({
      synced: true,
      line: [
        { start: 3000, value: 'Displayed first' },
        { start: 1000, value: 'Displayed second' },
        { start: 2000, value: 'Displayed third' },
      ],
    })

    expect(lines.map((line) => line.value)).toEqual([
      'Displayed first',
      'Displayed second',
      'Displayed third',
    ])
    expect(lines.map((line) => line.start)).toEqual([3000, 1000, 2000])
  })

  it('preserves timed blank rows as non-renderable timing markers', () => {
    const lines = buildKaraokeLines({
      synced: true,
      line: [
        { start: 1000, value: 'Before pause' },
        { start: 2000, value: '' },
        { start: 4000, value: 'After pause' },
      ],
    })

    expect(lines).toHaveLength(3)
    expect(lines[1]).toMatchObject({
      start: 2000,
      value: '',
      renderable: false,
    })
  })

"""
text = replace_once(text, marker, tests + marker, 'lyrics phase 3 tests')
path.write_text(text)


# Timeline tests for chronological ordering and timing-only semantics.
path = Path('ui/src/audioplayer/lyricsTimeline.test.js')
text = path.read_text()
marker = """  it('keeps a start-only line active until the next timestamp', () => {
"""
tests = """  it('uses chronological timing independently from display order', () => {
    const timeline = buildLyricsTimeline([
      { start: 3000, end: 5000, value: 'Displayed first', tokens: [] },
      { start: 1000, end: 4000, value: 'Displayed second', tokens: [] },
      { start: 2000, value: 'Displayed third', tokens: [] },
    ])
    const cursor = new LyricTimelineCursor(timeline)

    expect(timeline.windows[2].end).toBe(3000)
    expect(cursor.update(2500, true)).toMatchObject({
      indexes: [1, 2],
      primaryIndex: 2,
    })
    expect(cursor.update(3500)).toMatchObject({
      indexes: [0, 1],
      primaryIndex: 0,
    })
  })

  it('uses timed blank markers as boundaries without activating or scrolling to them', () => {
    const timeline = buildLyricsTimeline([
      {
        start: 1000,
        value: 'Before pause',
        tokens: [],
        renderable: true,
      },
      { start: 2000, value: '', tokens: [], renderable: false },
      {
        start: 4000,
        end: 5000,
        value: 'After pause',
        tokens: [],
        renderable: true,
      },
    ])
    const cursor = new LyricTimelineCursor(timeline)

    expect(timeline.windows[0].end).toBe(2000)
    expect(timeline.windows[1]).toMatchObject({
      renderable: false,
      intervalValid: true,
      valid: false,
    })
    expect(cursor.update(2500, true).indexes).toEqual([])
    expect(timeline.scrollOrder.map((window) => window.lineIndex)).toEqual([0, 2])
  })

  it('bounds a final open line when media duration is unavailable', () => {
    const timeline = buildLyricsTimeline([{ start: 7000, tokens: [] }], {
      fallbackLineDurationMs: 8000,
    })

    expect(timeline.windows[0]).toMatchObject({
      start: 7000,
      end: 15000,
      valid: true,
    })
  })

"""
text = replace_once(text, marker, tests + marker, 'timeline phase 3 tests')
path.write_text(text)


# Rendering regression: timing-only rows must not create empty lyric blocks.
path = Path('ui/src/audioplayer/LyricsPanel.test.jsx')
text = path.read_text()
marker = """  it('renders main, stacked pronunciation, and translation in layer order', () => {
"""
test = """  it('does not render timed blank rows as empty lyric groups', () => {
    renderPanel({
      mainLyric: {
        synced: true,
        line: [
          { start: 0, value: 'Before pause' },
          { start: 1000, value: '' },
          { start: 2000, value: 'After pause' },
        ],
      },
      audioInstance: { currentTime: 1.5, paused: true },
    })

    expect(screen.getAllByTestId('lyrics-line-group')).toHaveLength(2)
    expect(screen.getByText('Before pause')).toBeInTheDocument()
    expect(screen.getByText('After pause')).toBeInTheDocument()
  })

"""
text = replace_once(text, marker, test + marker, 'panel timing-only test')
path.write_text(text)
