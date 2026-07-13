import { useEffect, useMemo, useState } from 'react'
import subsonic from '../subsonic'
import { getPreferredLyricLanguage, selectLyricLayers } from './lyrics'

export const emptyLyricLayers = Object.freeze({
  main: null,
  translation: null,
  pronunciation: null,
})

const LYRICS_CACHE_SCHEMA_VERSION = 2
const MAX_LYRIC_CACHE_ENTRIES = 75
const NEGATIVE_CACHE_TTL_MS = 30_000

const cache = new Map()
const inFlight = new Map()

const normalizeLyricLayers = (layers) => ({
  main: layers?.main || null,
  translation: layers?.translation || null,
  pronunciation: layers?.pronunciation || null,
})

const normalizeComparableText = (value) =>
  String(value || '')
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[\p{P}\p{S}\s]+/gu, '')

const finiteTime = (value) => {
  if (value == null || value === '') return null
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

const findReferenceLine = (line, index, referenceLines) => {
  const start = finiteTime(line?.start)
  if (start != null) {
    const timedMatch = referenceLines.find((candidate) => {
      const candidateStart = finiteTime(candidate?.start)
      return candidateStart != null && Math.abs(candidateStart - start) <= 20
    })
    if (timedMatch) return timedMatch
  }
  return referenceLines[index] || null
}

const filterRedundantLines = (lines, referenceLines) => {
  if (!Array.isArray(lines) || !Array.isArray(referenceLines)) return lines
  return lines.filter((line, index) => {
    const text = normalizeComparableText(line?.value)
    if (!text) return true
    const reference = findReferenceLine(line, index, referenceLines)
    return text !== normalizeComparableText(reference?.value)
  })
}

const removeRedundantTranslations = (layers) => {
  const main = layers.main
  const translation = layers.translation
  if (!main || !translation) return layers

  const mainLines = Array.isArray(main.line) ? main.line : []
  const mainCueLines = Array.isArray(main.cueLine) ? main.cueLine : []
  return {
    ...layers,
    translation: {
      ...translation,
      ...(Array.isArray(translation.line)
        ? { line: filterRedundantLines(translation.line, mainLines) }
        : {}),
      ...(Array.isArray(translation.cueLine)
        ? {
            cueLine: filterRedundantLines(
              translation.cueLine,
              mainCueLines.length > 0 ? mainCueLines : mainLines,
            ),
          }
        : {}),
    },
  }
}

const readStructuredLyrics = (response) =>
  response?.json?.['subsonic-response']?.lyricsList?.structuredLyrics || []

const buildCacheKey = ({ trackId, preferredLanguage, updatedAt }) =>
  [
    trackId || '',
    updatedAt || '',
    preferredLanguage || '',
    LYRICS_CACHE_SCHEMA_VERSION,
  ].join('\u0000')

const rememberLyrics = (cacheKey, layers, expiresAt = null) => {
  cache.delete(cacheKey)
  cache.set(cacheKey, { layers, expiresAt })
  while (cache.size > MAX_LYRIC_CACHE_ENTRIES) {
    const oldestCacheKey = cache.keys().next().value
    cache.delete(oldestCacheKey)
  }
}

const readCachedLyrics = (cacheKey) => {
  const cached = cache.get(cacheKey)
  if (!cached) return null
  if (cached.expiresAt != null && cached.expiresAt <= Date.now()) {
    cache.delete(cacheKey)
    return null
  }
  cache.delete(cacheKey)
  cache.set(cacheKey, cached)
  return cached.layers
}

const createLyricsRequest = ({ trackId, preferredLanguage, cacheKey }) => {
  const controller = new AbortController()
  const entry = {
    controller,
    consumers: 0,
    settled: false,
    promise: null,
  }
  entry.promise = subsonic
    .getLyricsBySongId(trackId, { signal: controller.signal })
    .then((response) => {
      const selected = removeRedundantTranslations(
        normalizeLyricLayers(
          selectLyricLayers(readStructuredLyrics(response), preferredLanguage),
        ),
      )
      const hasAnyLayer = Boolean(
        selected.main || selected.translation || selected.pronunciation,
      )
      rememberLyrics(
        cacheKey,
        selected,
        hasAnyLayer ? null : Date.now() + NEGATIVE_CACHE_TTL_MS,
      )
      return selected
    })
    .finally(() => {
      entry.settled = true
      if (inFlight.get(cacheKey) === entry) inFlight.delete(cacheKey)
    })
  inFlight.set(cacheKey, entry)
  return entry
}

const acquireLyricsRequest = ({ trackId, preferredLanguage, cacheKey }) => {
  const existing = inFlight.get(cacheKey)
  const entry =
    existing && !existing.controller.signal.aborted
      ? existing
      : createLyricsRequest({ trackId, preferredLanguage, cacheKey })
  entry.consumers += 1
  let released = false
  return {
    promise: entry.promise,
    release: () => {
      if (released) return
      released = true
      entry.consumers = Math.max(0, entry.consumers - 1)
      if (!entry.settled && entry.consumers === 0) {
        if (inFlight.get(cacheKey) === entry) inFlight.delete(cacheKey)
        entry.controller.abort()
      }
    },
  }
}

const useEnhancedLyrics = ({
  trackId,
  updatedAt,
  disabled = false,
  requested = true,
}) => {
  const preferredLanguage = getPreferredLyricLanguage()
  const cacheKey = useMemo(
    () => buildCacheKey({ trackId, preferredLanguage, updatedAt }),
    [preferredLanguage, trackId, updatedAt],
  )
  const [state, setState] = useState(() => ({
    cacheKey,
    layers: emptyLyricLayers,
    loading: false,
    error: null,
  }))

  useEffect(() => {
    if (!trackId || disabled || !requested) {
      setState({
        cacheKey,
        layers: emptyLyricLayers,
        loading: false,
        error: null,
      })
      return undefined
    }

    const cached = readCachedLyrics(cacheKey)
    if (cached) {
      setState({ cacheKey, layers: cached, loading: false, error: null })
      return undefined
    }

    let active = true
    const request = acquireLyricsRequest({
      trackId,
      preferredLanguage,
      cacheKey,
    })
    setState({
      cacheKey,
      layers: emptyLyricLayers,
      loading: true,
      error: null,
    })

    request.promise
      .then((layers) => {
        if (!active) return
        setState({ cacheKey, layers, loading: false, error: null })
      })
      .catch((error) => {
        if (!active || error?.name === 'AbortError') return
        cache.delete(cacheKey)
        setState({
          cacheKey,
          layers: emptyLyricLayers,
          loading: false,
          error,
        })
      })

    return () => {
      active = false
      request.release()
    }
  }, [cacheKey, disabled, preferredLanguage, requested, trackId])

  if (state.cacheKey !== cacheKey) {
    return { layers: emptyLyricLayers, loading: false, error: null }
  }
  return {
    layers: state.layers,
    loading: state.loading,
    error: state.error,
  }
}

export const clearEnhancedLyricsCache = () => {
  cache.clear()
  inFlight.forEach((entry) => entry.controller.abort())
  inFlight.clear()
}

export default useEnhancedLyrics
