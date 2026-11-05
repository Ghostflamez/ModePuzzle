"""Opt-in: read the module sprites from the user's OWN local Probably Stolen install.

Nothing here ships any game asset. The sprites are read (read-only) from the player's install
on their machine, only after they allow it in the app, and the result is cached only on that
machine. It is never committed, bundled into a build, or included in exported configs.

Output (JSON, "sprite pack"):
  {format, cellPixels, alphabet, transparent, palette: ['#rrggbb'], sprites: {name: {w, h, cells, rows}}}
rows are strings of palette indices (alphabet characters); `cells` are the occupied 16 px cells.

Used by desktop/launcher.py (js_api) and scripts/extract_local_sprites.py (browser users).
Requires: UnityPy, Pillow.
"""
from __future__ import annotations

import os
import re
from pathlib import Path

PACK_FORMAT = 'modepuzzle-game-sprites-1'
STEAM_APP_DIR = 'Probably Stolen'
DATA_DIR = 'Probably Stolen_Data'
ASSET_FILES = ('resources.assets', 'sharedassets0.assets', 'sharedassets1.assets')
CELL_PIXELS = 16
ALPHA_MIN = 128
CELL_COVERAGE = 0.5
# Printable characters usable as palette indices inside a JSON string.
ALPHABET = ''.join(chr(c) for c in range(35, 127) if chr(c) not in '\\`$')
TRANSPARENT = '.'
# Sprite names inside the game data, one per shape id in src/render/module-art.js (SHAPES).
SPRITE_NAMES = (
    'module_red', 'module_red_l', 'module_red_t', 'module_red_c', 'module_red_2', 'module_red_2_h', 'module_red_2_s',
    'module_green', 'module_green_l', 'module_green_t', 'module_green_c', 'module_green_2', 'module_green_2_h', 'module_green_2_s', 'module_green_3',
    'module_yellow', 'module_yellow_l', 'module_yellow_t', 'module_yellow_c', 'module_yellow_2', 'module_yellow_2_h', 'module_yellow_2_s',
    'module_black_4', 'module_black_5', 'module_white', 'module_ruined', 'module_corrupt',
    'node_m', 'node_s',
    'farm_module_l1', 'farm_module_l2', 'farm_module_l4', 'farm_module_l5', 'farm_module_l6', 'farm_module5', 'farm_module6',
    'long_module1', 'long_module2', 'long_module3', 'farm_module_l7', 'farm_module_l8',
)


def is_game_dir(path: str | os.PathLike | None) -> bool:
    return bool(path) and (Path(path) / DATA_DIR / ASSET_FILES[0]).is_file()


def steam_libraries() -> list[Path]:
    """Steam library folders from the registry and libraryfolders.vdf (Windows; best effort)."""
    roots: list[Path] = []
    try:
        import winreg
        for hive, key in ((winreg.HKEY_CURRENT_USER, r'Software\Valve\Steam'),
                          (winreg.HKEY_LOCAL_MACHINE, r'SOFTWARE\WOW6432Node\Valve\Steam')):
            try:
                with winreg.OpenKey(hive, key) as k:
                    for value in ('SteamPath', 'InstallPath'):
                        try:
                            roots.append(Path(winreg.QueryValueEx(k, value)[0]))
                        except OSError:
                            pass
            except OSError:
                pass
    except ImportError:
        pass
    libraries: list[Path] = []
    for root in roots:
        libraries.append(root)
        vdf = root / 'steamapps' / 'libraryfolders.vdf'
        if vdf.is_file():
            for m in re.finditer(r'"path"\s+"([^"]+)"', vdf.read_text(encoding='utf-8', errors='replace')):
                libraries.append(Path(m.group(1).replace('\\\\', '\\')))
    seen, out = set(), []
    for lib in libraries:
        key = str(lib).lower()
        if key not in seen:
            seen.add(key)
            out.append(lib)
    return out


def find_game_dir() -> str | None:
    for lib in steam_libraries():
        candidate = lib / 'steamapps' / 'common' / STEAM_APP_DIR
        if is_game_dir(candidate):
            return str(candidate)
    return None


def _occupied_cells(img) -> list[list[int]]:
    cells = []
    for cy in range(img.height // CELL_PIXELS):
        for cx in range(img.width // CELL_PIXELS):
            solid = sum(1 for y in range(CELL_PIXELS) for x in range(CELL_PIXELS)
                        if img.getpixel((cx * CELL_PIXELS + x, cy * CELL_PIXELS + y))[3] >= ALPHA_MIN)
            if solid >= CELL_COVERAGE * CELL_PIXELS * CELL_PIXELS:
                cells.append([cx, cy])
    return cells


def extract_pack(game_dir: str | os.PathLike) -> dict:
    """Read the sprites (read-only) and return a sprite pack. Raises ValueError with a readable message."""
    import UnityPy
    if not is_game_dir(game_dir):
        raise ValueError(f'不是《Probably Stolen》的安装目录：{game_dir}')
    data = Path(game_dir) / DATA_DIR
    wanted = set(SPRITE_NAMES)
    images = {}
    for name in ASSET_FILES:
        path = data / name
        if not path.is_file():
            continue
        with open(path, 'rb') as fh:                      # read-only; the game may be running
            env = UnityPy.load(fh.read())
        for obj in env.objects:
            if obj.type.name != 'Sprite':
                continue
            sprite = obj.read()
            if sprite.m_Name in wanted and sprite.m_Name not in images:
                images[sprite.m_Name] = sprite.image.convert('RGBA')
    if not images:
        raise ValueError('在游戏文件中没有找到模组贴图（游戏版本可能已变化）')
    palette: list[str] = []
    index: dict[str, int] = {}
    sprites = {}
    for name, img in sorted(images.items()):
        rows = []
        for y in range(img.height):
            row = []
            for x in range(img.width):
                r, g, b, a = img.getpixel((x, y))
                if a < ALPHA_MIN:
                    row.append(TRANSPARENT)
                    continue
                key = f'#{r:02x}{g:02x}{b:02x}'
                if key not in index:
                    if len(palette) >= len(ALPHABET):
                        raise ValueError('贴图颜色过多，无法编码')
                    index[key] = len(palette)
                    palette.append(key)
                row.append(ALPHABET[index[key]])
            rows.append(''.join(row))
        sprites[name] = {'w': img.width, 'h': img.height, 'cells': _occupied_cells(img), 'rows': rows}
    return {'format': PACK_FORMAT, 'cellPixels': CELL_PIXELS, 'alphabet': ALPHABET, 'transparent': TRANSPARENT,
            'palette': palette, 'sprites': sprites}
