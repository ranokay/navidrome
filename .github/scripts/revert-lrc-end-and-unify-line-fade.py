from pathlib import Path
import re


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f'{label}: expected one match, found {count}')
    return text.replace(old, new, 1)


# Restore start-only line timing semantics: active until the next timestamp.
path = Path('ui/src/audioplayer/lyricsTimeline.js')
text = path.read_text()
text, count = re.subn(
    r"\nconst estimateLineSpokenDuration = \(line\) => \{.*?\n\}\n\nconst inferLineTimedEnd = \(line, start, nextStart, trackEnd\) => \{.*?\n\}\n",
    '\n',
    text,
    count=1,
    flags=re.S,
)
if count != 1:
    raise RuntimeError(f'line duration inference removal: expected one match, found {count}')
text = replace_once(
    text,
    """    let end = finiteTime(line?.end) ?? latestExplicitTokenEnd(line)
    if (end == null && start != null && line?.timingMode === 'line') {
      end = inferLineTimedEnd(line, start, nextTimedStarts[lineIndex], trackEnd)
    }
    if (end == null) end = nextTimedStarts[lineIndex]
""",
    """    let end = finiteTime(line?.end) ?? latestExplicitTokenEnd(line)
    if (end == null) end = nextTimedStarts[lineIndex]
""",
    'timeline next-start fallback',
)
path.write_text(text)

# Remove the now-unused timing mode markers.
path = Path('ui/src/audioplayer/lyrics.js')
text = path.read_text()
text = replace_once(text, "  timingMode: 'line',\n", '', 'base timing mode')
text = replace_once(
    text,
    "    timingMode: tokens.length > 0 ? 'token' : 'line',\n",
    '',
    'cue timing mode',
)
path.write_text(text)

# Use one identical color-transition definition for main, pronunciation and translation.
path = Path('ui/src/audioplayer/LyricsPanel.jsx')
text = path.read_text()
marker = "import useLyricsTimeline from './useLyricsTimeline'\n\n"
constant = """import useLyricsTimeline from './useLyricsTimeline'

const KARAOKE_LAYER_COLOR_TRANSITION = `color ${KARAOKE_ANIMATION_MS}ms ${KARAOKE_EASING}, -webkit-text-fill-color ${KARAOKE_ANIMATION_MS}ms ${KARAOKE_EASING}`

"""
text = replace_once(text, marker, constant, 'shared layer transition constant')
old_main_or_translation = '    transition: `opacity ${KARAOKE_ANIMATION_MS}ms ${KARAOKE_EASING}, color ${KARAOKE_ANIMATION_MS}ms ${KARAOKE_EASING}, -webkit-text-fill-color ${KARAOKE_ANIMATION_MS}ms ${KARAOKE_EASING}`,\n'
if text.count(old_main_or_translation) != 2:
    raise RuntimeError(
        'main/translation transitions: expected two matches, '
        f'found {text.count(old_main_or_translation)}'
    )
text = text.replace(
    old_main_or_translation,
    '    transition: KARAOKE_LAYER_COLOR_TRANSITION,\n',
    2,
)
text = replace_once(
    text,
    '    transition: `color ${KARAOKE_ANIMATION_MS}ms ${KARAOKE_EASING}, -webkit-text-fill-color ${KARAOKE_ANIMATION_MS}ms ${KARAOKE_EASING}`,\n',
    '    transition: KARAOKE_LAYER_COLOR_TRANSITION,\n',
    'pronunciation line transition',
)
path.write_text(text)

# Replace the inferred-end regression test with the restored LRC behavior.
path = Path('ui/src/audioplayer/lyricsTimeline.test.js')
text = path.read_text()
pattern = r"  it\('ends line-timed lyrics before the next timestamp when no end exists', \(\) => \{.*?^  \}\)\n\n"
replacement = """  it('keeps a start-only line active until the next timestamp', () => {
    const timeline = buildLyricsTimeline([
      { start: 1000, value: 'A lyric line', tokens: [] },
      { start: 5000, end: 6000, tokens: [] },
    ])
    const cursor = new LyricTimelineCursor(timeline)

    expect(timeline.windows[0].end).toBe(5000)
    expect(cursor.update(4999, true).indexes).toEqual([0])
    expect(cursor.update(5000).indexes).toEqual([1])
  })

"""
text, count = re.subn(pattern, replacement, text, count=1, flags=re.S | re.M)
if count != 1:
    raise RuntimeError(f'LRC timing test replacement: expected one match, found {count}')
path.write_text(text)
