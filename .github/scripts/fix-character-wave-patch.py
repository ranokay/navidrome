from pathlib import Path

path = Path('.github/scripts/apply-persistent-line-lift-and-character-wave.py')
text = path.read_text()
old = '''text = replace_once(
    text,
    """                >
                  {segment.pronunciation}
                </span>
""",
    """                  aria-label={
                    pronunciationWindow ? segment.pronunciation : undefined
                  }
                >
                  {renderWaveText(
                    segment.pronunciation,
                    Boolean(pronunciationWindow),
                    waveCharacterClassName,
                  )}
                </span>
""",
    'stacked pronunciation wave text',
)
'''
new = '''text = replace_once(
    text,
    """                data-timed={pronunciationWindow ? 'true' : 'false'}
""",
    """                data-timed={pronunciationWindow ? 'true' : 'false'}
                aria-label={
                  pronunciationWindow ? segment.pronunciation : undefined
                }
""",
    'stacked pronunciation aria label',
)
text = replace_once(
    text,
    """                {segment.pronunciation}
""",
    """                {renderWaveText(
                  segment.pronunciation,
                  Boolean(pronunciationWindow),
                  waveCharacterClassName,
                )}
""",
    'stacked pronunciation wave text',
)
'''
if text.count(old) != 1:
    raise RuntimeError(f'expected one pronunciation patch block, found {text.count(old)}')
path.write_text(text.replace(old, new, 1))
