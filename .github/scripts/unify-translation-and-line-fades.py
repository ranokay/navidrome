from pathlib import Path


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f'{label}: expected one match, found {count}')
    return text.replace(old, new, 1)


panel_path = Path('ui/src/audioplayer/LyricsPanel.jsx')
panel = panel_path.read_text()

# Keep all line-level layers on the same relative brightness curve. This
# preserves each layer's hue and active brightness while matching the
# pronunciation layer's perceived fade progress.
panel = replace_once(
    panel,
    """      const idleAlpha =
        layer === 'main' ? 0.46 : layer === 'translation' ? 0.34 : 0.38
      const activeAlpha =
        layer === 'main' ? 0.98 : layer === 'translation' ? 0.72 : 0.78
""",
    """      const activeAlpha =
        layer === 'main' ? 0.98 : layer === 'translation' ? 0.72 : 0.78
      const pronunciationFadeRatio = 0.38 / 0.78
      const idleAlpha = activeAlpha * pronunciationFadeRatio
""",
    'shared relative layer fade',
)

# Translations are semantic auxiliary text, not a one-to-one phonetic lane.
# Even when a source supplies cue timing, use the main line lifecycle so the
# whole translation starts and ends with main + pronunciation instead of
# racing through unrelated translated words.
helper_marker = """const buildLineGroupStyle = (canSeekLine, layerStyles) => ({
"""
helper = """const buildSynchronizedTranslationLine = (mainLine, translationLine) => {
  const highlighted = buildHighlightedAuxLine(mainLine, translationLine)
  if (!highlighted) return highlighted
  return {
    ...highlighted,
    tokens: [],
    lanes: undefined,
  }
}

const buildLineGroupStyle = (canSeekLine, layerStyles) => ({
"""
panel = replace_once(
    panel,
    helper_marker,
    helper,
    'synchronized translation helper',
)

panel = replace_once(
    panel,
    """                  <KaraokeLineRow
                    lineIndex={idx}
                    line={buildHighlightedAuxLine(line, trLine)}
                    nextLineStart={null}
                    className={clsx(classes.auxLine, classes.translationLine)}
                    style={layerStyles.translation}
                    tokenClassName={classes.token}
                    registerToken={registerToken}
                    rowKey="translation"
                  />
""",
    """                  <KaraokeLineRow
                    lineIndex={idx}
                    line={buildSynchronizedTranslationLine(line, trLine)}
                    nextLineStart={null}
                    className={clsx(classes.auxLine, classes.translationLine)}
                    style={layerStyles.translation}
                    tokenClassName={classes.token}
                    rowKey="translation"
                  />
""",
    'translation rendering lifecycle',
)
panel_path.write_text(panel)


test_path = Path('ui/src/audioplayer/LyricsPanel.test.jsx')
tests = test_path.read_text()
marker = """  it('uses the same active and release lifecycle for all line-level layers', () => {
"""
new_test = """  it('keeps timed translations on the main line lifecycle', () => {
    const translationLyric = {
      synced: true,
      line: [{ start: 0, end: 1000, value: 'Translated phrase' }],
      cueLine: [
        {
          index: 0,
          start: 0,
          end: 700,
          value: 'Translated phrase',
          cue: [
            {
              start: 0,
              end: 150,
              value: 'Translated',
              byteStart: 0,
              byteEnd: 9,
            },
            {
              start: 150,
              end: 700,
              value: 'phrase',
              byteStart: 11,
              byteEnd: 16,
            },
          ],
        },
      ],
    }

    renderPanel({
      mainLyric: tokenizedMainLyric,
      pronunciationLyric: tokenizedPronunciationLyric,
      translationLyric,
      showPronunciation: true,
      showTranslation: true,
      audioInstance: { currentTime: 0.25, paused: true },
    })

    const group = screen.getByTestId('lyrics-line-group')
    const translation = screen.getByText('Translated phrase')
    expect(group).toHaveAttribute('data-active', 'true')
    expect(translation).not.toHaveAttribute('data-lyrics-state')
    expect(translation.style.backgroundImage).toBe('')
    expect(
      group.style.getPropertyValue('--lyrics-translation-active-color'),
    ).not.toBe('')
  })

"""
tests = replace_once(
    tests,
    marker,
    new_test + marker,
    'translation lifecycle regression test',
)
test_path.write_text(tests)
