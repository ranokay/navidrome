from pathlib import Path


def replace_once(text, old, new, name):
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f'{name}: expected 1 match, got {count}')
    return text.replace(old, new, 1)


path = Path('ui/src/audioplayer/LyricsPanel.jsx')
text = path.read_text()
text = replace_once(
    text,
    """    transition: `color ${KARAOKE_ANIMATION_MS}ms ${KARAOKE_EASING}, -webkit-text-fill-color ${KARAOKE_ANIMATION_MS}ms ${KARAOKE_EASING}`,
    '@media (prefers-reduced-motion: reduce)': {""",
    """    transition: `color ${KARAOKE_ANIMATION_MS}ms ${KARAOKE_EASING}, -webkit-text-fill-color ${KARAOKE_ANIMATION_MS}ms ${KARAOKE_EASING}`,
    '&[data-timed="true"]': {
      transition: 'none',
    },
    '@media (prefers-reduced-motion: reduce)': {""",
    'timed pronunciation transition',
)
path.write_text(text)

path = Path('ui/src/audioplayer/LyricsLineRows.jsx')
text = path.read_text()
text = replace_once(
    text,
    """                data-testid="lyrics-pronunciation-token"
                data-lyrics-state="future"
                ref={""",
    """                data-testid="lyrics-pronunciation-token"
                data-lyrics-state="future"
                data-timed={pronunciationWindow ? 'true' : 'false'}
                ref={""",
    'timed pronunciation marker',
)
path.write_text(text)
