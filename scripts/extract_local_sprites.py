"""For the browser version: read the module sprites from YOUR OWN local game install into a
sprite pack that only lives on your computer, then load it via 「游戏贴图 → 选择贴图包…」.

Read-only: nothing in the game folder or saves is changed. Do not share or commit the output;
it contains game assets. The desktop build does the same thing from inside the app.

Requires: pip install UnityPy pillow
Usage: python scripts/extract_local_sprites.py [--game "<install dir>"] [--out <file>]
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'desktop'))
import game_sprites  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--game', help='install dir (default: found from Steam)')
    parser.add_argument('--out', default=str(Path.home() / 'Downloads' / 'modepuzzle-game-sprites.json'))
    args = parser.parse_args()
    game = args.game or game_sprites.find_game_dir()
    if not game:
        raise SystemExit('没有在 Steam 库中找到游戏，请用 --game 指定安装目录')
    pack = game_sprites.extract_pack(game)
    Path(args.out).write_text(json.dumps(pack, ensure_ascii=False), encoding='utf-8')
    print(f'已读取 {len(pack["sprites"])} 张贴图 -> {args.out}（仅供本机使用，请勿分享或提交）')


if __name__ == '__main__':
    main()
