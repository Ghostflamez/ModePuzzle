"""Build the Windows release: release/ModePuzzle-v<version>.exe (one file, WebView2 window).

Steps: offline HTML (scripts/build.py) -> icon + version info -> PyInstaller --onefile.
Needs: pip install pyinstaller pywebview pillow. Usage: python scripts/build_exe.py
"""
from __future__ import annotations

import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WORK = ROOT / 'build' / 'exe'
RELEASE = ROOT / 'release'
# Icon: the generated art (src/render/module-art.js) of one kind, scaled up without smoothing.
ICON_KIND = 'neuralUncapped'
ICON_SIZES = [16, 24, 32, 48, 64, 128, 256]


def app_info() -> tuple[str, str]:
    text = (ROOT / 'src' / 'config' / 'app-info.js').read_text(encoding='utf-8')
    version = re.search(r"APP_VERSION = '([\d.]+)'", text).group(1)
    name = re.search(r"APP_NAME = '([^']+)'", text).group(1)
    return name, version


def art_image(kind: str):
    """Render the kind's first shape with the same JS code the app uses (needs Node)."""
    from PIL import Image
    script = ("import {renderArt} from './src/render/module-art.js';"
              "import {kindShapes} from './src/render/sprites.js';"
              f"console.log(JSON.stringify(renderArt({kind!r}, kindShapes({kind!r})[0].cells)));")
    out = subprocess.run(['node', '--input-type=module', '-e', script], cwd=ROOT, check=True,
                         capture_output=True, text=True).stdout
    art = json.loads(out)
    img = Image.new('RGBA', (art['w'], art['h']), (0, 0, 0, 0))
    for y, row in enumerate(art['px']):
        for x, c in enumerate(row):
            if c:
                img.putpixel((x, y), tuple(int(c[i:i + 2], 16) for i in (1, 3, 5)) + (255,))
    return img


def make_icon(path: Path) -> None:
    from PIL import Image
    img = art_image(ICON_KIND)
    side = max(img.size)
    square = Image.new('RGBA', (side, side), (0, 0, 0, 0))
    square.paste(img, ((side - img.width) // 2, (side - img.height) // 2))
    big = square.resize((256, 256), Image.NEAREST)
    big.save(path, sizes=[(s, s) for s in ICON_SIZES])


def version_file(path: Path, name: str, version: str) -> None:
    nums = tuple(int(n) for n in (version.split('.') + ['0'] * 4)[:4])
    path.write_text(f"""VSVersionInfo(
  ffi=FixedFileInfo(filevers={nums}, prodvers={nums}, mask=0x3f, flags=0x0, OS=0x40004, fileType=0x1, subtype=0x0, date=(0, 0)),
  kids=[
    StringFileInfo([StringTable('080404b0', [
      StringStruct('FileDescription', '{name}'),
      StringStruct('ProductName', '{name}'),
      StringStruct('FileVersion', '{version}'),
      StringStruct('ProductVersion', '{version}'),
      StringStruct('OriginalFilename', 'ModePuzzle-v{version}.exe'),
      StringStruct('Comments', 'Unofficial fan tool for Probably Stolen. Not affiliated with Questing Goose Studio.'),
    ])]),
    VarFileInfo([VarStruct('Translation', [0x0804, 1200])]),
  ]
)
""", encoding='utf-8')


def main() -> None:
    name, version = app_info()
    subprocess.run([sys.executable, str(ROOT / 'scripts' / 'build.py')], check=True)
    shutil.rmtree(WORK, ignore_errors=True)
    WORK.mkdir(parents=True)
    shutil.copy(ROOT / 'dist' / 'module-layout-offline.html', WORK / 'app.html')
    (WORK / 'app_info.py').write_text(f'APP_NAME = {name!r}\nAPP_VERSION = {version!r}\n', encoding='utf-8')
    make_icon(WORK / 'icon.ico')
    version_file(WORK / 'version.txt', name, version)
    exe_name = f'ModePuzzle-v{version}'
    subprocess.run([
        sys.executable, '-m', 'PyInstaller', '--noconfirm', '--clean', '--onefile', '--windowed',
        '--name', exe_name, '--icon', str(WORK / 'icon.ico'), '--version-file', str(WORK / 'version.txt'),
        '--add-data', f'{WORK / "app.html"};.', '--paths', str(WORK),
        '--distpath', str(RELEASE), '--workpath', str(WORK / 'pyi'), '--specpath', str(WORK),
        str(ROOT / 'desktop' / 'launcher.py'),
    ], check=True)
    # Licenses travel with the exe: MIT for the code, full texts for the two bundled fonts.
    for src, dst in [('THIRD_PARTY_NOTICES.md', 'THIRD_PARTY_NOTICES.md'), ('LICENSE', 'LICENSE.txt'),
                     ('src/assets/fonts/OFL-WDXL-Lubrifont-SC.txt', 'OFL-WDXL-Lubrifont-SC.txt'),
                     ('src/assets/fonts/LICENSE-Oldschool-PC-Fonts-CC-BY-SA-4.0.txt', 'LICENSE-Oldschool-PC-Fonts-CC-BY-SA-4.0.txt')]:
        shutil.copy(ROOT / src, RELEASE / dst)
    out = RELEASE / f'{exe_name}.exe'
    print('built', out.relative_to(ROOT), f'{out.stat().st_size // 1024 // 1024} MB')


if __name__ == '__main__':
    main()
