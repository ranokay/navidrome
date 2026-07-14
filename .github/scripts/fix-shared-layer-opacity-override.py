from pathlib import Path


def replace_once(text, old, new, label):
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f'{label}: expected one match, found {count}')
    return text.replace(old, new, 1)


rows_path = Path('ui/src/audioplayer/LyricsLineRows.jsx')
rows = rows_path.read_text()
rows = replace_once(
    rows,
    """  delete result.color
  delete result.WebkitTextFillColor
  delete result['--lyrics-active-color']
""",
    """  delete result.opacity
  delete result.color
  delete result.WebkitTextFillColor
  delete result['--lyrics-active-color']
""",
    'strip inline opacity',
)
rows_path.write_text(rows)


test_path = Path('ui/src/audioplayer/LyricsPanel.test.jsx')
tests = test_path.read_text()
old = """    expect(mainRow).toHaveAttribute('data-tokenized', 'false')
    expect(translationRow).toHaveAttribute('data-tokenized', 'false')
  })
"""
new = """    expect(mainRow).toHaveAttribute('data-tokenized', 'false')
    expect(translationRow).toHaveAttribute('data-tokenized', 'false')
    expect(mainRow.style.opacity).toBe('')
    expect(translationRow.style.opacity).toBe('')
  })
"""
tests = replace_once(tests, old, new, 'shared opacity regression assertions')
test_path.write_text(tests)
