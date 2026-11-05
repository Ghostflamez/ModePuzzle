"""Rebuild the UI fonts in src/assets/fonts/ from their public upstream releases (not from the game).

  WDXL Lubrifont SC (SIL OFL 1.1): https://github.com/google/fonts/tree/main/ofl/wdxllubrifontsc
      -> wdxl-lubrifont-sc.subset.woff2, subset to the characters the UI uses (name table kept,
         including the license records). No Reserved Font Name is declared, so the name may stay.
  Mx437 Tandy2K (CC BY-SA 4.0, VileR): https://int10h.org/oldschool-pc-fonts/
      -> mx437-tandy2k.woff2, converted unchanged (pass the Mx437_Tandy2K .ttf from the pack).

Requirements: fonttools, brotli. Re-run after changing UI text so new characters are covered.
Usage: python scripts/build_fonts.py --wdxl WDXLLubrifontSC-Regular.ttf [--tandy Mx437_Tandy2K.ttf]
"""
from __future__ import annotations

import argparse
from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parent.parent
FONT_DIR = ROOT / 'src' / 'assets' / 'fonts'
EXTRA_CHARS = '０１２３４５６７８９，。：；！？（）【】《》、—…·×÷±≤≥～'


def ui_characters() -> str:
    chars = set(chr(c) for c in range(32, 127))
    for path in (ROOT / 'src').rglob('*'):
        if path.suffix in {'.html', '.js'}:
            chars.update(path.read_text(encoding='utf-8'))
    chars.update(EXTRA_CHARS)
    return ''.join(sorted(c for c in chars if ord(c) >= 32))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--wdxl', required=True, help='upstream WDXLLubrifontSC-Regular.ttf')
    parser.add_argument('--tandy', help='upstream Mx437_Tandy2K.ttf (optional; the committed woff2 is already v2.2)')
    args = parser.parse_args()
    options = subset.Options()
    options.flavor = 'woff2'
    options.name_IDs = ['*']          # keep copyright / license / license URL records
    options.name_languages = ['*']
    font = TTFont(args.wdxl)
    subsetter = subset.Subsetter(options)
    subsetter.populate(text=ui_characters())
    subsetter.subset(font)
    font.flavor = 'woff2'
    font.save(FONT_DIR / 'wdxl-lubrifont-sc.subset.woff2')
    if args.tandy:
        tandy = TTFont(args.tandy)
        tandy.flavor = 'woff2'
        tandy.save(FONT_DIR / 'mx437-tandy2k.woff2')
    for f in sorted(FONT_DIR.glob('*.woff2')):
        print('font', f.name, f.stat().st_size, 'bytes')


if __name__ == '__main__':
    main()
