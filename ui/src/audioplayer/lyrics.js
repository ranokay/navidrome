const CACHE_LIMIT = 75
export const LYRIC_SCHEMA_VERSION = 3

const cache = new Map()
const normalizeLanguageTag = (value) =>
  String(value || '')
    .toLowerCase()
    .replace(/_/g, '-')

const finiteTime = (value) => {
  if (value == null || value === '') return null
  const time = Number(value)
  return Number.isFinite(time) ? time : null
}

const byteOffset = (value) => {
  const offset = Number(value)
  return Number.isInteger(offset) && offset >= 0 ? offset : null
}

const codePointByteLength = (codePoint) => {
  if (codePoint <= 0x7f) return 1
  if (codePoint <= 0x7ff) return 2
  if (codePoint <= 0xffff) return 3
  return 4
}

const utf8ByteLength = (text) => {
  let length = 0
  for (const value of String(text || '')) {
    length += codePointByteLength(value.codePointAt(0))
  }
  return length
}

const hashString = (value) => {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(36)
}

export const utf8ByteOffsetToCodeUnitIndex = (text, targetOffset) => {
  const target = byteOffset(targetOffset)
  if (!text || target == null || target <= 0) return 0
  let bytes = 0
  let index = 0
  while (index < text.length && bytes < target) {
    const codePoint = text.codePointAt(index)
    bytes += codePointByteLength(codePoint)
    index += codePoint > 0xffff ? 2 : 1
  }
  return index
}

export const utf8ByteRangeToCodeUnitRange = (text, start, end) => {
  const byteStart = byteOffset(start)
  const byteEnd = byteOffset(end)
  if (
    typeof text !== 'string' ||
    byteStart == null ||
    byteEnd == null ||
    byteEnd < byteStart
  ) {
    return null
  }
  const startIndex = utf8ByteOffsetToCodeUnitIndex(text, byteStart)
  const endIndex = utf8ByteOffsetToCodeUnitIndex(text, byteEnd + 1)
  if (endIndex <= startIndex) return null
  return {
    start: startIndex,
    end: endIndex,
    text: text.slice(startIndex, endIndex),
  }
}

const segmentGraphemes = (value, locale) => {
  if (typeof Intl?.Segmenter !== 'function') return null
  const segmenter = new Intl.Segmenter(locale || undefined, {
    granularity: 'grapheme',
  })
  return Array.from(segmenter.segment(value), ({ segment, index }) => ({
    value: segment,
    index,
    visible: !/^\s+$/u.test(segment),
  }))
}

const deepFreeze = (value) => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value))
    return value
  Object.freeze(value)
  Object.values(value).forEach(deepFreeze)
  return value
}

const parseRawLyrics = (rawLyrics) => {
  if (Array.isArray(rawLyrics)) return rawLyrics
  if (typeof rawLyrics !== 'string' || rawLyrics.trim() === '') return []
  try {
    const parsed = JSON.parse(rawLyrics)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

const languageMatches = (candidate, preferred) =>
  Boolean(
    candidate &&
    preferred &&
    (candidate === preferred ||
      candidate.startsWith(`${preferred}-`) ||
      preferred.startsWith(`${candidate}-`)),
  )

const lyricKind = (lyric) => {
  const kind = String(lyric?.kind || '').toLowerCase()
  return kind === 'translation' || kind === 'pronunciation' ? kind : 'main'
}

const chooseLanguage = (lyrics, preferredLanguage) => {
  if (!lyrics.length) return null
  const preferred = normalizeLanguageTag(preferredLanguage)
  const base = preferred.split('-')[0]
  const candidates = lyrics.some((lyric) => lyric.synced)
    ? lyrics.filter((lyric) => lyric.synced)
    : lyrics
  return (
    candidates.find((lyric) =>
      languageMatches(normalizeLanguageTag(lyric.lang), preferred),
    ) ||
    candidates.find((lyric) =>
      languageMatches(normalizeLanguageTag(lyric.lang), base),
    ) ||
    candidates.find((lyric) =>
      languageMatches(normalizeLanguageTag(lyric.lang), 'en'),
    ) ||
    candidates[0]
  )
}

export const getPreferredLyricLanguage = () =>
  (typeof window !== 'undefined' && window.localStorage?.getItem('locale')) ||
  (typeof navigator !== 'undefined' && navigator.language) ||
  'en'

export const selectLyricLayers = (rawLyrics, preferredLanguage) => {
  const lyrics = parseRawLyrics(rawLyrics).filter(
    (lyric) => Array.isArray(lyric?.line) && lyric.line.length > 0,
  )
  const groups = { main: [], translation: [], pronunciation: [] }
  lyrics.forEach((lyric) => groups[lyricKind(lyric)].push(lyric))
  if (groups.main.length === 0) groups.main = lyrics
  return {
    main: chooseLanguage(groups.main, preferredLanguage),
    translation: chooseLanguage(groups.translation, preferredLanguage),
    pronunciation: chooseLanguage(groups.pronunciation, preferredLanguage),
  }
}

const validPrecision = (value) =>
  ['word', 'syllable', 'segment', 'character'].includes(value) ? value : null

const inferCuePrecision = (cue, lyricFormat, allCuesAreCharacters) => {
  const explicit = validPrecision(cue?.precision)
  if (explicit && (explicit !== 'character' || allCuesAreCharacters))
    return explicit
  if (lyricFormat === 'lyricsfile') return 'word'
  if (lyricFormat === 'elrc' || lyricFormat === 'ttml') return 'segment'
  if (allCuesAreCharacters) return 'character'
  return 'segment'
}

const normalizeCues = (line, format, offset, locale) => {
  const cues = Array.isArray(line?.cue) ? line.cue : []
  const drafts = cues.map((cue, sourceIndex) => {
    const value = typeof cue?.value === 'string' ? cue.value : ''
    const graphemes = segmentGraphemes(value, locale)
    return {
      id: `cue-${sourceIndex}`,
      sourceIndex,
      value,
      start:
        finiteTime(cue?.start) == null ? null : finiteTime(cue.start) + offset,
      end: finiteTime(cue?.end) == null ? null : finiteTime(cue.end) + offset,
      byteStart: byteOffset(cue?.byteStart),
      byteEnd: byteOffset(cue?.byteEnd),
      agentId: String(cue?.agentId || ''),
      sourceId: String(cue?.sourceId || cue?.id || cue?.for || ''),
      requestedPrecision: cue?.precision,
      graphemes,
    }
  })
  const allCuesAreCharacters =
    drafts.length > 0 &&
    drafts.every(
      (cue) =>
        cue.start != null &&
        cue.end != null &&
        cue.graphemes?.filter((part) => part.visible).length === 1,
    )
  return drafts
    .map(({ requestedPrecision, ...cue }) => ({
      ...cue,
      precision: inferCuePrecision(
        { precision: requestedPrecision },
        format,
        allCuesAreCharacters,
      ),
    }))
    .sort(
      (a, b) =>
        (a.start ?? Infinity) - (b.start ?? Infinity) ||
        a.sourceIndex - b.sourceIndex,
    )
}

const buildDisplaySegments = (value, cues, agents) => {
  const text = String(value || '')
  if (!cues.length) {
    return {
      valid: true,
      segments: [{ id: 'text-0', kind: 'text', value: text }],
    }
  }

  const sourceCues = [...cues].sort(
    (left, right) =>
      (left.byteStart ?? Infinity) - (right.byteStart ?? Infinity) ||
      left.sourceIndex - right.sourceIndex,
  )
  const textByteLength = utf8ByteLength(text)
  const segments = []
  let nextByte = 0

  for (const cue of sourceCues) {
    if (
      cue.byteStart == null ||
      cue.byteEnd == null ||
      cue.byteStart < nextByte ||
      cue.byteEnd >= textByteLength
    ) {
      return {
        valid: false,
        segments: [{ id: 'text-0', kind: 'text', value: text }],
      }
    }

    if (cue.byteStart > nextByte) {
      const gap = utf8ByteRangeToCodeUnitRange(
        text,
        nextByte,
        cue.byteStart - 1,
      )
      if (!gap) {
        return {
          valid: false,
          segments: [{ id: 'text-0', kind: 'text', value: text }],
        }
      }
      segments.push({
        id: `gap-${nextByte}`,
        kind: 'text',
        value: gap.text,
      })
    }

    const range = utf8ByteRangeToCodeUnitRange(text, cue.byteStart, cue.byteEnd)
    if (!range || range.text !== cue.value) {
      return {
        valid: false,
        segments: [{ id: 'text-0', kind: 'text', value: text }],
      }
    }
    const agent = agents.get(cue.agentId || 'main')
    segments.push({
      id: cue.id,
      kind: 'cue',
      value: range.text,
      cueIndex: cue.sourceIndex,
      byteStart: cue.byteStart,
      byteEnd: cue.byteEnd,
      agentId: cue.agentId || 'main',
      agentRole:
        agent?.role || (cue.agentId && cue.agentId !== 'main' ? '' : 'main'),
    })
    nextByte = cue.byteEnd + 1
  }

  if (nextByte < textByteLength) {
    const suffix = utf8ByteRangeToCodeUnitRange(
      text,
      nextByte,
      textByteLength - 1,
    )
    if (!suffix) {
      return {
        valid: false,
        segments: [{ id: 'text-0', kind: 'text', value: text }],
      }
    }
    segments.push({
      id: `gap-${nextByte}`,
      kind: 'text',
      value: suffix.text,
    })
  }

  if (segments.map((segment) => segment.value).join('') !== text) {
    return {
      valid: false,
      segments: [{ id: 'text-0', kind: 'text', value: text }],
    }
  }
  return { valid: true, segments }
}

const inferLinePrecision = (cues) => {
  if (!cues.length) return 'line'
  const values = new Set(cues.map((cue) => cue.precision))
  return values.size === 1 ? cues[0].precision : 'mixed'
}

const normalizeLanes = (line, cues, agents) => {
  const grouped = new Map()
  cues.forEach((cue) => {
    const id = cue.agentId || 'main'
    if (!grouped.has(id)) grouped.set(id, [])
    grouped.get(id).push(cue)
  })
  if (!grouped.size) grouped.set('main', [])
  return Array.from(grouped, ([agentId, laneCues]) => ({
    agentId,
    role: agents.get(agentId)?.role || (agentId === 'main' ? 'main' : ''),
    name: agents.get(agentId)?.name || '',
    value:
      laneCues.length > 0
        ? laneCues.map((cue) => cue.value).join('')
        : String(line?.value || ''),
    cues: laneCues,
  }))
}

const lastCueEnd = (cues) =>
  cues.reduce(
    (latest, cue) => Math.max(latest ?? -Infinity, cue.end ?? -Infinity),
    -Infinity,
  )

const createTimeline = (lines) => {
  const startOrder = lines
    .filter((line) => line.start != null)
    .map((line) => line.index)
    .sort((a, b) => lines[a].start - lines[b].start || a - b)
  const events = lines
    .flatMap((line) =>
      line.start == null
        ? []
        : [
            { time: line.start, type: 'start', lineIndex: line.index },
            { time: line.end, type: 'end', lineIndex: line.index },
          ],
    )
    .sort((a, b) => {
      if (a.time !== b.time) return a.time - b.time
      if (a.type !== b.type) return a.type === 'end' ? -1 : 1
      return a.lineIndex - b.lineIndex
    })
  const checkpoints = []
  const active = new Set()
  events.forEach((event, index) => {
    if (event.type === 'start') active.add(event.lineIndex)
    else active.delete(event.lineIndex)
    if ((index + 1) % 64 === 0) {
      checkpoints.push({
        eventIndex: index + 1,
        time: event.time,
        active: Array.from(active),
      })
    }
  })
  return { startOrder, events, checkpoints, checkpointStride: 64 }
}

const normalizeDocument = (lyric, { durationMs, identity, locale }) => {
  if (!lyric || !Array.isArray(lyric.line)) return null
  const offset = finiteTime(lyric.offset) ?? 0
  const format = String(
    lyric.format || (lyric.synced ? 'lrc' : 'plain'),
  ).toLowerCase()
  const agents = new Map(
    (Array.isArray(lyric.agents) ? lyric.agents : []).map((agent) => [
      String(agent.id || ''),
      { role: String(agent.role || ''), name: String(agent.name || '') },
    ]),
  )
  const drafts = lyric.line.map((line, index) => {
    const cues = normalizeCues(line, format, offset, locale)
    const display = buildDisplaySegments(line?.value, cues, agents)
    const cuesBySourceIndex = []
    cues.forEach((cue) => {
      cuesBySourceIndex[cue.sourceIndex] = cue
    })
    const explicitStart = finiteTime(line?.start)
    const explicitEnd = finiteTime(line?.end)
    const cueStart = cues.find((cue) => cue.start != null)?.start ?? null
    return {
      index,
      value: typeof line?.value === 'string' ? line.value : '',
      instrumental: Boolean(line?.instrumental),
      start: explicitStart == null ? cueStart : explicitStart + offset,
      explicitEnd: explicitEnd == null ? null : explicitEnd + offset,
      cues,
      cuesBySourceIndex,
      lanes: normalizeLanes(line, cues, agents),
      displaySegments: display.segments,
      hasValidCueRanges: display.valid,
      precision: display.valid ? inferLinePrecision(cues) : 'line',
      graphemes: segmentGraphemes(String(line?.value || ''), locale),
    }
  })
  const trackEnd = finiteTime(durationMs)
  const lines = drafts.map((line, index) => {
    let end = line.explicitEnd
    let endProvenance = 'explicit'
    const cueEnd = lastCueEnd(line.cues)
    if (end == null && Number.isFinite(cueEnd)) {
      end = cueEnd
      endProvenance = 'cue'
    }
    if (end == null) {
      const next = drafts
        .slice(index + 1)
        .find((candidate) => candidate.start != null)
      if (next) {
        end = next.start
        endProvenance = 'next-line'
      }
    }
    if (end == null && line.start != null) {
      end = line.start + 8000
      if (trackEnd != null) end = Math.min(end, trackEnd)
      endProvenance = 'fallback-cap'
    }
    if (line.start != null && (end == null || end < line.start))
      end = line.start
    return { ...line, end, endProvenance }
  })
  const timed = lines.some((line) => line.start != null)
  return deepFreeze({
    schemaVersion: LYRIC_SCHEMA_VERSION,
    identity,
    kind: lyricKind(lyric),
    language: normalizeLanguageTag(lyric.lang),
    format,
    synced: Boolean(lyric.synced),
    timed,
    lines,
    timeline: createTimeline(lines),
  })
}

const cacheKeyFor = ({ trackId, updatedAt, durationMs, locale }) =>
  [
    trackId || '',
    updatedAt || '',
    durationMs || '',
    locale || '',
    LYRIC_SCHEMA_VERSION,
  ].join(':')

export const normalizeSongLyrics = (
  song,
  locale = getPreferredLyricLanguage(),
) => {
  const rawLyrics = song?.lyrics || '[]'
  const durationMs =
    finiteTime(song?.duration) == null ? null : Number(song.duration) * 1000
  const key = cacheKeyFor({
    trackId: song?.mediaFileId || song?.id,
    updatedAt: song?.updatedAt,
    durationMs,
    locale,
  })
  const cached = cache.get(key)
  if (cached?.rawLyrics === rawLyrics) {
    cache.delete(key)
    cache.set(key, cached)
    return cached.layers
  }
  const selected = selectLyricLayers(rawLyrics, locale)
  const rawHash = hashString(String(rawLyrics))
  const identityFor = (kind, lyric) =>
    `${key}:${rawHash}:${kind}:${hashString(JSON.stringify(lyric || null))}`
  const main = normalizeDocument(selected.main, {
    durationMs,
    locale,
    identity: identityFor('main', selected.main),
  })
  const translation = normalizeDocument(selected.translation, {
    durationMs,
    locale,
    identity: identityFor('translation', selected.translation),
  })
  const pronunciation = normalizeDocument(selected.pronunciation, {
    durationMs,
    locale,
    identity: identityFor('pronunciation', selected.pronunciation),
  })
  const pronunciationByMain = buildLayerLineIndex(main, pronunciation)
  const layers = deepFreeze({
    main,
    translation,
    pronunciation,
    translationByMain: buildLayerLineIndex(main, translation),
    pronunciationByMain,
    pronunciationTokensByMain: buildPronunciationTokenIndex(
      main,
      pronunciation,
      pronunciationByMain,
    ),
  })
  cache.set(key, { rawLyrics, layers })
  while (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value)
  return layers
}

export const clearLyricsCache = () => cache.clear()
export const getLyricsCacheSize = () => cache.size
export const hasStructuredLyricContent = (document) =>
  Boolean(
    document?.lines?.some(
      (line) => line.value || line.instrumental || line.cues.length,
    ),
  )

export const findLayerLineForMain = (
  mainDocument,
  layerDocument,
  mainIndex,
) => {
  const main = mainDocument?.lines?.[mainIndex]
  const lines = layerDocument?.lines || []
  if (!main || !lines.length) return null
  if (main.start == null) return lines[mainIndex] || null
  let low = 0
  let high = lines.length
  while (low < high) {
    const middle = (low + high) >>> 1
    if ((lines[middle].start ?? Infinity) < main.start) low = middle + 1
    else high = middle
  }
  const candidates = lines.slice(
    Math.max(0, low - 2),
    Math.min(lines.length, low + 2),
  )
  let best = null
  let bestDistance = Infinity
  candidates.forEach((line) => {
    if (line.start == null) return
    const overlaps = line.start < main.end && line.end > main.start
    const distance = overlaps ? 0 : Math.abs(line.start - main.start)
    if (distance < bestDistance) {
      best = line
      bestDistance = distance
    }
  })
  return bestDistance <= 2000 ? best : null
}

export const buildLayerLineIndex = (mainDocument, layerDocument) =>
  mainDocument?.lines?.map((_line, index) =>
    findLayerLineForMain(mainDocument, layerDocument, index),
  ) || []

const cueTimesAreMonotonic = (cues) =>
  cues.every(
    (cue, index) =>
      index === 0 ||
      (cue.start ?? Infinity) >= (cues[index - 1].start ?? Infinity),
  )

const timingOverlapScore = (mainCue, pronunciationCue) => {
  if (
    mainCue.start == null ||
    mainCue.end == null ||
    pronunciationCue.start == null ||
    pronunciationCue.end == null
  )
    return 0
  const overlap =
    Math.min(mainCue.end, pronunciationCue.end) -
    Math.max(mainCue.start, pronunciationCue.start)
  if (overlap <= 0) return 0
  const pronunciationDuration = Math.max(
    1,
    pronunciationCue.end - pronunciationCue.start,
  )
  return overlap / pronunciationDuration
}

const findPronunciationTarget = (
  mainCues,
  pronunciationCue,
  pronunciationIndex,
  allowIndexFallback,
) => {
  if (pronunciationCue.sourceId) {
    const explicit = mainCues.filter(
      (candidate) => candidate.sourceId === pronunciationCue.sourceId,
    )
    if (explicit.length > 0) return explicit.length === 1 ? explicit[0] : null
  }

  const exact = mainCues.filter(
    (candidate) =>
      candidate.start === pronunciationCue.start &&
      candidate.end === pronunciationCue.end,
  )
  if (exact.length > 0) return exact.length === 1 ? exact[0] : null

  const overlaps = mainCues
    .map((candidate) => ({
      candidate,
      score: timingOverlapScore(candidate, pronunciationCue),
    }))
    .filter(({ score }) => score > 0)
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.candidate.sourceIndex - right.candidate.sourceIndex,
    )
  if (
    overlaps.length > 0 &&
    (overlaps.length === 1 || overlaps[0].score > overlaps[1].score)
  ) {
    return overlaps[0].candidate
  }

  const boundary = mainCues.filter(
    (candidate) =>
      candidate.start === pronunciationCue.start ||
      candidate.end === pronunciationCue.end,
  )
  if (boundary.length > 0) return boundary.length === 1 ? boundary[0] : null
  return allowIndexFallback ? mainCues[pronunciationIndex] || null : null
}

export const buildPronunciationTokenIndex = (
  mainDocument,
  pronunciationDocument,
  lineMatches = buildLayerLineIndex(mainDocument, pronunciationDocument),
) =>
  mainDocument?.lines?.map((mainLine, lineIndex) => {
    const pronunciationLine = lineMatches[lineIndex]
    if (
      !pronunciationLine?.cues?.length ||
      !mainLine.cues.length ||
      !mainLine.hasValidCueRanges
    ) {
      return pronunciationLine
        ? { mode: 'line', line: pronunciationLine, tokens: [] }
        : null
    }

    const allowIndexFallback =
      mainLine.cues.length === pronunciationLine.cues.length &&
      cueTimesAreMonotonic(mainLine.cues) &&
      cueTimesAreMonotonic(pronunciationLine.cues)
    const groups = new Map()
    for (
      let pronunciationIndex = 0;
      pronunciationIndex < pronunciationLine.cues.length;
      pronunciationIndex += 1
    ) {
      const pronunciationCue = pronunciationLine.cues[pronunciationIndex]
      const mainCue = findPronunciationTarget(
        mainLine.cues,
        pronunciationCue,
        pronunciationIndex,
        allowIndexFallback,
      )
      if (!mainCue) {
        return { mode: 'line', line: pronunciationLine, tokens: [] }
      }
      if (!groups.has(mainCue.sourceIndex)) groups.set(mainCue.sourceIndex, [])
      groups.get(mainCue.sourceIndex).push(pronunciationCue)
    }

    const tokens = Array.from(groups, ([mainCueIndex, cues]) => ({
      id: `pronunciation-${mainCueIndex}`,
      mainCueIndex,
      value: cues.map((cue) => cue.value).join(''),
      cues,
    })).sort((left, right) => left.mainCueIndex - right.mainCueIndex)
    return tokens.length
      ? { mode: 'tokens', line: pronunciationLine, tokens }
      : { mode: 'line', line: pronunciationLine, tokens: [] }
  }) || []
