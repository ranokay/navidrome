from pathlib import Path

path = Path('ui/src/audioplayer/lyricsTimeline.js')
text = path.read_text()
old = """  const estimate = 480 + words * 285 + compactLength * 18
  return Math.max(800, Math.min(6000, estimate))"""
new = """  const cjkLength = (
    String(line?.value || '').match(/[\\u3040-\\u30ff\\u3400-\\u9fff\\uac00-\\ud7af]/g) || []
  ).length
  const wordEstimate = 480 + words * 285 + compactLength * 18
  const cjkEstimate = 480 + cjkLength * 145
  return Math.max(800, Math.min(6000, Math.max(wordEstimate, cjkEstimate)))"""
if text.count(old) != 1:
    raise RuntimeError(f'expected one duration estimate, found {text.count(old)}')
path.write_text(text.replace(old, new, 1))
