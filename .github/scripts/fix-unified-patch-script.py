from pathlib import Path

path = Path('.github/scripts/apply-unified-lyrics-animation.py')
content = path.read_text()
old = '''    content = replace_once(
        content,
        ''' + "'''" + '''    letterSpacing: 0,
    transition: `opacity ${KARAOKE_ANIMATION_MS}ms ${KARAOKE_EASING}, color ${KARAOKE_ANIMATION_MS}ms ${KARAOKE_EASING}`,''' + "'''" + ''',
        ''' + "'''" + '''    letterSpacing: 0,
    color: 'var(--lyrics-main-current-color, currentColor)',
    WebkitTextFillColor: 'var(--lyrics-main-current-color, currentColor)',
    transition: `opacity ${KARAOKE_ANIMATION_MS}ms ${KARAOKE_EASING}, color ${KARAOKE_ANIMATION_MS}ms ${KARAOKE_EASING}, -webkit-text-fill-color ${KARAOKE_ANIMATION_MS}ms ${KARAOKE_EASING}`,''' + "'''" + ''',
        'main line current color',
    )

    content = replace_once(
        content,
        ''' + "'''" + '''    letterSpacing: 0,
    transition: `opacity ${KARAOKE_ANIMATION_MS}ms ${KARAOKE_EASING}, color ${KARAOKE_ANIMATION_MS}ms ${KARAOKE_EASING}`,
    '@media (prefers-reduced-motion: reduce)': {
      transition: 'none',
    },
  },
  stackedToken:''' + "'''" + ''',
        ''' + "'''" + '''    letterSpacing: 0,
    color: 'var(--lyrics-translation-current-color, currentColor)',
    WebkitTextFillColor:
      'var(--lyrics-translation-current-color, currentColor)',
    transition: `opacity ${KARAOKE_ANIMATION_MS}ms ${KARAOKE_EASING}, color ${KARAOKE_ANIMATION_MS}ms ${KARAOKE_EASING}, -webkit-text-fill-color ${KARAOKE_ANIMATION_MS}ms ${KARAOKE_EASING}`,
    '@media (prefers-reduced-motion: reduce)': {
      transition: 'none',
    },
  },
  stackedToken:''' + "'''" + ''',
        'translation current color',
    )
'''
new = '''    old_line = ''' + "'''" + '''  line: {
    display: 'inline-block',
    maxWidth: '100%',
    fontWeight: 700,
    fontSize: 24,
    lineHeight: 1.18,
    overflowWrap: 'anywhere',
    whiteSpace: 'pre-wrap',
    letterSpacing: 0,
    transition: `opacity ${KARAOKE_ANIMATION_MS}ms ${KARAOKE_EASING}, color ${KARAOKE_ANIMATION_MS}ms ${KARAOKE_EASING}`,
    '@media (prefers-reduced-motion: reduce)': {
      transition: 'none',
    },
  },''' + "'''" + '''
    new_line = ''' + "'''" + '''  line: {
    display: 'inline-block',
    maxWidth: '100%',
    fontWeight: 700,
    fontSize: 24,
    lineHeight: 1.18,
    overflowWrap: 'anywhere',
    whiteSpace: 'pre-wrap',
    letterSpacing: 0,
    color: 'var(--lyrics-main-current-color, currentColor)',
    WebkitTextFillColor: 'var(--lyrics-main-current-color, currentColor)',
    transition: `opacity ${KARAOKE_ANIMATION_MS}ms ${KARAOKE_EASING}, color ${KARAOKE_ANIMATION_MS}ms ${KARAOKE_EASING}, -webkit-text-fill-color ${KARAOKE_ANIMATION_MS}ms ${KARAOKE_EASING}`,
    '@media (prefers-reduced-motion: reduce)': {
      transition: 'none',
    },
  },''' + "'''" + '''
    content = replace_once(content, old_line, new_line, 'main line current color')

    old_aux = ''' + "'''" + '''  auxLine: {
    display: 'block',
    marginTop: theme.spacing(0.8),
    fontWeight: 600,
    fontSize: 15,
    lineHeight: KARAOKE_AUX_LINE_HEIGHT,
    overflowWrap: 'anywhere',
    whiteSpace: 'pre-wrap',
    letterSpacing: 0,
    transition: `opacity ${KARAOKE_ANIMATION_MS}ms ${KARAOKE_EASING}, color ${KARAOKE_ANIMATION_MS}ms ${KARAOKE_EASING}`,
    '@media (prefers-reduced-motion: reduce)': {
      transition: 'none',
    },
  },''' + "'''" + '''
    new_aux = ''' + "'''" + '''  auxLine: {
    display: 'block',
    marginTop: theme.spacing(0.8),
    fontWeight: 600,
    fontSize: 15,
    lineHeight: KARAOKE_AUX_LINE_HEIGHT,
    overflowWrap: 'anywhere',
    whiteSpace: 'pre-wrap',
    letterSpacing: 0,
    color: 'var(--lyrics-translation-current-color, currentColor)',
    WebkitTextFillColor:
      'var(--lyrics-translation-current-color, currentColor)',
    transition: `opacity ${KARAOKE_ANIMATION_MS}ms ${KARAOKE_EASING}, color ${KARAOKE_ANIMATION_MS}ms ${KARAOKE_EASING}, -webkit-text-fill-color ${KARAOKE_ANIMATION_MS}ms ${KARAOKE_EASING}`,
    '@media (prefers-reduced-motion: reduce)': {
      transition: 'none',
    },
  },''' + "'''" + '''
    content = replace_once(content, old_aux, new_aux, 'translation current color')
'''
if content.count(old) != 1:
    raise RuntimeError(f'Expected one ambiguous style patch, found {content.count(old)}')
path.write_text(content.replace(old, new, 1))
