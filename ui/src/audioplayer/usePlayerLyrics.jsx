import React, { useCallback, useMemo, useState } from 'react'
import LyricsPanel from './LyricsPanel'
import MobileKaraokeLyricsPortal from './MobileKaraokeLyricsPortal'
import {
  getPreferredLyricLanguage,
  hasStructuredLyricContent,
  normalizeSongLyrics,
} from './lyrics'
import {
  resolveLyricsSidebarState,
  toggleLayerPreference,
} from './lyricsSidebarState'

const usePlayerLyrics = ({ song, isRadio, audioInstance, isDesktop }) => {
  const [lyricsVisiblePreference, setLyricsVisiblePreference] = useState(false)
  const [translationPreference, setTranslationPreference] = useState(null)
  const [pronunciationPreference, setPronunciationPreference] = useState(null)
  const lyricLocale = getPreferredLyricLanguage()
  const lyricLayers = useMemo(
    () =>
      isRadio
        ? { main: null, translation: null, pronunciation: null }
        : normalizeSongLyrics(song, lyricLocale),
    [isRadio, lyricLocale, song],
  )
  const lyricsLoading = false
  const lyricsError = null

  const hasMainLyric = hasStructuredLyricContent(lyricLayers.main)
  const hasTranslationLyric = hasStructuredLyricContent(lyricLayers.translation)
  const hasPronunciationLyric = hasStructuredLyricContent(
    lyricLayers.pronunciation,
  )
  const { lyricsVisible, showTranslation, showPronunciation } =
    resolveLyricsSidebarState({
      lyricsVisiblePreference,
      translationPreference,
      pronunciationPreference,
      hasTranslationLyric,
      hasPronunciationLyric,
    })
  const lyricsToggleDisabled =
    (lyricsLoading || !hasMainLyric) && !lyricsVisiblePreference
  const useInlineMobileLyrics = lyricsVisible && hasMainLyric && !isDesktop

  const toggleLyrics = useCallback(() => {
    setLyricsVisiblePreference((current) => (current ? false : hasMainLyric))
  }, [hasMainLyric])

  const closeLyrics = useCallback(() => {
    setLyricsVisiblePreference(false)
  }, [])

  const toggleTranslation = useCallback(() => {
    setTranslationPreference((current) =>
      toggleLayerPreference(current, hasTranslationLyric),
    )
  }, [hasTranslationLyric])

  const togglePronunciation = useCallback(() => {
    setPronunciationPreference((current) =>
      toggleLayerPreference(current, hasPronunciationLyric, true),
    )
  }, [hasPronunciationLyric])

  const toolbarLyricsProps = useMemo(
    () => ({
      onToggleLyrics: toggleLyrics,
      lyricsActive: lyricsVisible,
      lyricsDisabled: lyricsToggleDisabled,
      lyricsLoading,
    }),
    [lyricsLoading, lyricsToggleDisabled, lyricsVisible, toggleLyrics],
  )

  const desktopLyricsProps = useMemo(
    () => ({
      visible: isDesktop && lyricsVisible,
      mainLyric: lyricLayers.main,
      translationLyric: lyricLayers.translation,
      pronunciationLyric: lyricLayers.pronunciation,
      translationMatches: lyricLayers.translationByMain,
      pronunciationMatches: lyricLayers.pronunciationByMain,
      pronunciationTokens: lyricLayers.pronunciationTokensByMain,
      showTranslation,
      showPronunciation,
      translationEnabled: hasTranslationLyric,
      pronunciationEnabled: hasPronunciationLyric,
      onToggleTranslation: toggleTranslation,
      onTogglePronunciation: togglePronunciation,
      audioInstance,
      loading: lyricsLoading,
      error: lyricsError,
    }),
    [
      audioInstance,
      hasPronunciationLyric,
      hasTranslationLyric,
      isDesktop,
      lyricLayers.main,
      lyricLayers.pronunciation,
      lyricLayers.pronunciationByMain,
      lyricLayers.pronunciationTokensByMain,
      lyricLayers.translation,
      lyricLayers.translationByMain,
      lyricsError,
      lyricsLoading,
      lyricsVisible,
      showPronunciation,
      showTranslation,
      togglePronunciation,
      toggleTranslation,
    ],
  )

  const mobileLyricsSurface = useMemo(
    () => (
      <MobileKaraokeLyricsPortal active={useInlineMobileLyrics}>
        <LyricsPanel
          visible={useInlineMobileLyrics}
          mainLyric={lyricLayers.main}
          translationLyric={lyricLayers.translation}
          pronunciationLyric={lyricLayers.pronunciation}
          translationMatches={lyricLayers.translationByMain}
          pronunciationMatches={lyricLayers.pronunciationByMain}
          pronunciationTokens={lyricLayers.pronunciationTokensByMain}
          showTranslation={showTranslation}
          showPronunciation={showPronunciation}
          audioInstance={audioInstance}
          loading={lyricsLoading}
          error={lyricsError}
          inline
        />
      </MobileKaraokeLyricsPortal>
    ),
    [
      audioInstance,
      lyricLayers.main,
      lyricLayers.pronunciation,
      lyricLayers.pronunciationByMain,
      lyricLayers.pronunciationTokensByMain,
      lyricLayers.translation,
      lyricLayers.translationByMain,
      lyricsError,
      lyricsLoading,
      showPronunciation,
      showTranslation,
      useInlineMobileLyrics,
    ],
  )

  return {
    toolbarLyricsProps,
    desktopLyricsProps,
    mobileLyricsSurface,
    useInlineMobileLyrics,
    closeLyrics,
  }
}

export default usePlayerLyrics
