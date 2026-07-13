from pathlib import Path
import re


def extract_prepared_script() -> str:
    workflow = Path('.github/workflows/fix-lyrics-gradient-once.yml').read_text()
    start_marker = "          python3 <<'PY'\n"
    end_marker = "\n          PY\n"
    if start_marker not in workflow or end_marker not in workflow:
        raise RuntimeError('Could not find embedded Python fix in prepared workflow')
    embedded = workflow.split(start_marker, 1)[1].split(end_marker, 1)[0]
    return '\n'.join(
        line[10:] if line.startswith('          ') else line
        for line in embedded.splitlines()
    )


def remove_fragile_sections(script: str) -> str:
    script, removed_timeline = re.subn(
        r"\n\s*timeline_path = 'ui/src/audioplayer/useLyricsTimeline\.js'.*?\n\s*write\(timeline_path, timeline\)\n",
        '\n',
        script,
        count=1,
        flags=re.S,
    )
    script, removed_tests = re.subn(
        r"\n\s*test_path = 'ui/src/audioplayer/LyricsPanel\.test\.jsx'.*?\n\s*write\(test_path, tests\)\n",
        '\n',
        script,
        count=1,
        flags=re.S,
    )
    if removed_timeline != 1 or removed_tests != 1:
        raise RuntimeError(
            'Expected one timeline and one test patch, '
            f'removed {removed_timeline} and {removed_tests}'
        )
    return script


def patch_token_rendering() -> None:
    path = Path('ui/src/audioplayer/LyricsLineRows.jsx')
    content = path.read_text()
    old_signature = 'const buildTokenData = (token, rgb, window, text) => {'
    if content.count(old_signature) != 1:
        raise RuntimeError(
            f'Expected one buildTokenData signature, found {content.count(old_signature)}'
        )
    content = content.replace(
        old_signature,
        'const buildTokenData = (token, rgb) => {',
        1,
    )
    marker = "      '--lyrics-progress': 0,\n      color: futureColor,"
    transition = (
        "      '--lyrics-progress': 0,\n"
        "      transition: 'opacity 220ms cubic-bezier(0.22, 1, 0.36, 1), "
        "color 220ms cubic-bezier(0.22, 1, 0.36, 1), "
        "-webkit-text-fill-color 220ms cubic-bezier(0.22, 1, 0.36, 1)',\n"
        "      color: futureColor,"
    )
    if content.count(marker) != 1:
        raise RuntimeError(f'Expected one token style marker, found {content.count(marker)}')
    path.write_text(content.replace(marker, transition, 1))


def patch_tests() -> None:
    path = Path('ui/src/audioplayer/LyricsPanel.test.jsx')
    content = path.read_text()
    marker = "    expect(screen.getByText('translation line')).toBeInTheDocument()\n  })\n"
    unique_test = """

  it('renders each translation line under only its closest main line', () => {
    renderPanel({
      mainLyric: {
        synced: true,
        line: [
          { start: 0, end: 1000, value: 'First main line' },
          { start: 1000, end: 2000, value: 'Closest main line' },
          { start: 2000, end: 3000, value: 'Later main line' },
        ],
      },
      translationLyric: {
        synced: true,
        line: [{ start: 1100, end: 2800, value: 'One translated line' }],
      },
      showTranslation: true,
    })

    const translations = screen.getAllByText('One translated line')
    expect(translations).toHaveLength(1)
    expect(
      translations[0].closest('[data-testid="lyrics-line-group"]'),
    ).toHaveTextContent('Closest main line')
  })
"""
    if content.count(marker) != 1:
        raise RuntimeError(f'Unique translation test marker count: {content.count(marker)}')
    content = content.replace(marker, marker + unique_test, 1)

    short_test = """  it('uses a soft gradient wipe for short fast cues', () => {
    renderPanel({
      mainLyric: {
        synced: true,
        line: [{ start: 0, end: 180, value: 'go' }],
        cueLine: [
          {
            index: 0,
            start: 0,
            end: 180,
            value: 'go',
            cue: [{ start: 0, end: 180, value: 'go' }],
          },
        ],
      },
      audioInstance: { currentTime: 0.02, paused: true },
    })

    const token = screen.getByTestId('lyrics-token')
    expect(token).toHaveAttribute('data-lyrics-state', 'active')
    expect(token.style.backgroundImage).toContain('linear-gradient')
    expect(token.style.color).toBe('transparent')
  })
"""
    content, count = re.subn(
        r"  it\('crossfades short cues without adding a gradient paint', \(\) => \{.*?^  \}\)\n",
        short_test,
        content,
        count=1,
        flags=re.S | re.M,
    )
    if count != 1:
        raise RuntimeError(f'Short cue test replacement count: {count}')
    path.write_text(content)


def main() -> None:
    script = remove_fragile_sections(extract_prepared_script())
    exec(compile(script, 'embedded-lyrics-fix.py', 'exec'))
    patch_token_rendering()
    patch_tests()


if __name__ == '__main__':
    main()
