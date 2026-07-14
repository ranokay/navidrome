from pathlib import Path


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f'{label}: expected one match, found {count}')
    return text.replace(old, new, 1)


constants_path = Path('ui/src/audioplayer/lyricsKaraokeConstants.js')
constants = constants_path.read_text()
constants = replace_once(
    constants,
    'export const KARAOKE_CHARACTER_LIFT_PX = 1.4',
    'export const KARAOKE_CHARACTER_LIFT_PX = 1.5',
    'character rise height',
)
constants_path.write_text(constants)


panel_path = Path('ui/src/audioplayer/LyricsPanel.jsx')
panel = panel_path.read_text()
panel = replace_once(
    panel,
    """    '&[data-raised="true"]': {
      transform: `translateY(-${KARAOKE_LINE_LIFT_PX}px)`,
""",
    """    '&[data-raised="true"][data-line-motion="line"]': {
      transform: `translateY(-${KARAOKE_LINE_LIFT_PX}px)`,
""",
    'line-only group rise selector',
)
panel = replace_once(
    panel,
    """            const lineLanes = getLineLanes(line)
            const canSeekLine = Boolean(audioInstance && line.start != null)
""",
    """            const lineLanes = getLineLanes(line)
            const usesCharacterRise = lineLanes.some(
              (lane) => Array.isArray(lane?.tokens) && lane.tokens.length > 0,
            )
            const canSeekLine = Boolean(audioInstance && line.start != null)
""",
    'character rise mode detection',
)
panel = replace_once(
    panel,
    """                className={classes.lineGroup}
                data-active={isStaticLine || isActiveLine ? 'true' : 'false'}
""",
    """                className={classes.lineGroup}
                data-line-motion={usesCharacterRise ? 'character' : 'line'}
                data-active={isStaticLine || isActiveLine ? 'true' : 'false'}
""",
    'line motion attribute',
)
panel_path.write_text(panel)


test_path = Path('ui/src/audioplayer/LyricsPanel.test.jsx')
tests = test_path.read_text()
tests = replace_once(
    tests,
    """    expect(group).toHaveAttribute('data-highlight-active', 'true')
    expect(group).toHaveAttribute('data-raised', 'true')
    expect(activeStyle.transform).toBe(`translateY(-${KARAOKE_LINE_LIFT_PX}px)`)
""",
    """    expect(group).toHaveAttribute('data-highlight-active', 'true')
    expect(group).toHaveAttribute('data-raised', 'true')
    expect(group).toHaveAttribute('data-line-motion', 'line')
    expect(activeStyle.transform).toBe(`translateY(-${KARAOKE_LINE_LIFT_PX}px)`)
""",
    'line rise mode assertion',
)
marker = """  it('lifts timed main and pronunciation graphemes with token progress', () => {
"""
new_test = """  it('uses only the per-character rise for token-timed lyrics', () => {
    renderPanel({
      mainLyric: tokenizedMainLyric,
      audioInstance: { currentTime: 0.25, paused: true },
    })

    const group = screen.getByTestId('lyrics-line-group')
    const firstCharacter = screen
      .getAllByTestId('lyrics-token')[0]
      .querySelector('[data-lyrics-character="true"]')

    expect(group).toHaveAttribute('data-raised', 'true')
    expect(group).toHaveAttribute('data-line-motion', 'character')
    expect(window.getComputedStyle(group).transform).toBe('translateY(0)')
    expect(firstCharacter.style.top).toBe(
      `-${KARAOKE_LINE_LIFT_PX.toFixed(3)}px`,
    )
    expect(KARAOKE_CHARACTER_LIFT_PX).toBe(KARAOKE_LINE_LIFT_PX)
  })

"""
tests = replace_once(tests, marker, new_test + marker, 'character-only rise test')
test_path.write_text(tests)
