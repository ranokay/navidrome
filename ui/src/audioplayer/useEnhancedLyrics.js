import { useEffect, useMemo, useState } from 'react'
import subsonic from '../subsonic'
import { getPreferredLyricLanguage, selectLyricLayers } from './lyrics'

export const emptyLyricLayers = Object.freeze({
  main: null,
  translation: null,
  pronunciation: null,
})

const LYRICS_CACHE_SCHEMA_VERSION = 1
const MAX_LYRIC_CACHE_ENTRIES = 75
const NEGATIVE_CACHE_TTL_MS = 30_000

const cache = new Map()
const inFlight = new Map()

const normalizeLyricLayers = (layers) => ({
  main: layers?.main || null,
  translation: layers?.translation || null,
  pronunciation: layers?.pronunciation || null,
})

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

const fetchLyrics = ({ trackId, preferredLanguage, cacheKey, signal }) => {
  const existing = inFlight.get(cacheKey)
  if (existing) return existing

  const request = subsonic
    .getLyricsBySongId(trackId, { signal })
    .then((response) => {
      const selected = normalizeLyricLayers(
        selectLyricLayers(readStructuredLyrics(response), preferredLanguage),
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
      if (inFlight.get(cacheKey) === request) inFlight.delete(cacheKey)
    })

  inFlight.set(cacheKey, request)
  return request
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

    const controller = new AbortController()
    let active = true
    setState({
      cacheKey,
      layers: emptyLyricLayers,
      loading: true,
      error: null,
    })

    fetchLyrics({
      trackId,
      preferredLanguage,
      cacheKey,
      signal: controller.signal,
    })
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
      controller.abort()
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
  inFlight.clear()
}

export default useEnhancedLyrics
