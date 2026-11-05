"""Desktop shell: shows dist/module-layout-offline.html in a WebView2 window (pywebview).

The page is served by pywebview's built-in server on a local port: 42173 when free, otherwise any
free port. The page's data therefore does not live in localStorage (which is tied to the port) but
in %APPDATA%/ModePuzzle/storage.json, read and written through this launcher (src/core/app-store.js).
Only one instance runs at a time (named mutex), so the file has a single writer.
"""
from __future__ import annotations

import ctypes
import json
import os
import socket
import sys
import threading

import webview

from app_info import APP_NAME, APP_VERSION
import game_sprites

PREFERRED_PORT = 42173
APP_DIR = os.path.join(os.environ.get('APPDATA') or os.path.expanduser('~'), 'ModePuzzle')
WEBVIEW_DIR = os.path.join(APP_DIR, 'webview')
STORAGE_FILE = os.path.join(APP_DIR, 'storage.json')
MUTEX_NAME = 'Local\\ModePuzzleDesktopSingleInstance'
ERROR_ALREADY_EXISTS = 183


def resource(name: str) -> str:
    base = getattr(sys, '_MEIPASS', os.path.dirname(os.path.abspath(__file__)))
    return os.path.join(base, name)


def free_port(preferred: int = PREFERRED_PORT) -> int:
    """`preferred` if it can be bound on 127.0.0.1, otherwise a free port chosen by the OS."""
    for port in (preferred, 0):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            try:
                s.bind(('127.0.0.1', port))
            except OSError:
                continue
            return s.getsockname()[1]
    raise OSError('no free local port')


def message(text: str) -> None:
    ctypes.windll.user32.MessageBoxW(None, text, APP_NAME, 0x30)


def single_instance():
    """Hold a named mutex for the process lifetime; None if another instance already holds it."""
    kernel32 = ctypes.windll.kernel32
    handle = kernel32.CreateMutexW(None, False, MUTEX_NAME)
    if not handle or kernel32.GetLastError() == ERROR_ALREADY_EXISTS:
        return None
    return handle


class FileStorage:
    """Key/value strings in one JSON file, written atomically after every change."""

    def __init__(self, path: str) -> None:
        self.path = path
        self.lock = threading.Lock()
        self.data: dict[str, str] = {}
        try:
            with open(path, encoding='utf-8') as fh:
                loaded = json.load(fh)
            if isinstance(loaded, dict):
                self.data = {str(k): str(v) for k, v in loaded.items()}
        except FileNotFoundError:
            pass
        except (OSError, ValueError):
            # Unreadable file: keep it aside instead of overwriting it.
            os.replace(path, path + '.broken')

    def _write(self) -> None:
        tmp = self.path + '.tmp'
        with open(tmp, 'w', encoding='utf-8') as fh:
            json.dump(self.data, fh, ensure_ascii=False)
        os.replace(tmp, self.path)

    def load(self) -> dict:
        with self.lock:
            return dict(self.data)

    def set(self, key: str, value: str) -> None:
        with self.lock:
            self.data[str(key)] = str(value)
            self._write()

    def remove(self, key: str) -> None:
        with self.lock:
            if self.data.pop(str(key), None) is not None:
                self._write()

    def import_all(self, entries: dict) -> None:
        with self.lock:
            for k, v in entries.items():
                self.data.setdefault(str(k), str(v))
            self._write()


class Api:
    """Exposed to the page as window.pywebview.api."""

    def __init__(self, storage: FileStorage) -> None:
        self._window = None
        self._storage = storage

    # --- app data (src/core/app-store.js) ---
    def storage_load(self):
        return self._storage.load()

    def storage_set(self, key, value):
        self._storage.set(key, value)

    def storage_remove(self, key):
        self._storage.remove(key)

    def storage_import(self, entries):
        self._storage.import_all(entries or {})

    # --- opt-in game sprites, only after the user allows it ---
    def find_game_dir(self):
        return game_sprites.find_game_dir()

    def choose_game_dir(self):
        picked = self._window.create_file_dialog(webview.FileDialog.FOLDER)
        return picked[0] if picked else None

    def read_game_sprites(self, game_dir):
        try:
            return {'ok': True, 'pack': game_sprites.extract_pack(game_dir)}
        except Exception as err:                      # shown to the user as-is
            return {'ok': False, 'error': str(err)}


def self_check(out_path: str) -> None:
    """Build verification: `exe --check-game-sprites <file>` writes how many sprites the bundled
    reader finds in the local install (nothing else is written)."""
    try:
        game = game_sprites.find_game_dir()
        pack = game_sprites.extract_pack(game) if game else None
        text = f'ok {len(pack["sprites"])}' if pack else 'no game dir'
    except Exception:
        import traceback
        text = 'error ' + traceback.format_exc()
    with open(out_path, 'w', encoding='utf-8') as fh:
        fh.write(text)


def main() -> None:
    if len(sys.argv) == 3 and sys.argv[1] == '--check-game-sprites':
        self_check(sys.argv[2])
        return
    mutex = single_instance()
    if mutex is None:
        message(f'{APP_NAME} 已经在运行，请切换到已打开的窗口。')
        return
    os.makedirs(WEBVIEW_DIR, exist_ok=True)
    port = free_port()
    webview.settings['ALLOW_DOWNLOADS'] = True   # 导出配置 / 导出结果 open a save dialog
    api = Api(FileStorage(STORAGE_FILE))
    api._window = webview.create_window(f'{APP_NAME} v{APP_VERSION}', url=resource('app.html'), js_api=api,
                                       width=1440, height=920, min_size=(900, 600))
    webview.start(gui='edgechromium', private_mode=False, storage_path=WEBVIEW_DIR, http_port=port)


if __name__ == '__main__':
    main()
