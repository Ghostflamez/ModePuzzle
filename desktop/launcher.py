"""Desktop shell: shows dist/module-layout-offline.html in a WebView2 window (pywebview).

The page is served by pywebview's built-in server on a FIXED local port, so the page origin and
therefore localStorage (the user's inventory) stay the same between runs. Data lives in
%APPDATA%/ModePuzzle/webview and is separate from the browser version: move it with 导出/导入配置.
"""
from __future__ import annotations

import ctypes
import os
import socket
import sys

import webview

from app_info import APP_NAME, APP_VERSION

# Changing the port changes the page origin and hides earlier saved data. Keep it fixed.
HTTP_PORT = 42173
DATA_DIR = os.path.join(os.environ.get('APPDATA') or os.path.expanduser('~'), 'ModePuzzle', 'webview')


def resource(name: str) -> str:
    base = getattr(sys, '_MEIPASS', os.path.dirname(os.path.abspath(__file__)))
    return os.path.join(base, name)


def port_in_use(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        return s.connect_ex(('127.0.0.1', port)) == 0


def message(text: str) -> None:
    ctypes.windll.user32.MessageBoxW(None, text, APP_NAME, 0x30)


def main() -> None:
    if port_in_use(HTTP_PORT):
        message(f'{APP_NAME} 似乎已经在运行（本地端口 {HTTP_PORT} 已被占用）。\n'
                '如果没有打开的窗口，请关闭占用该端口的程序后重试。')
        return
    os.makedirs(DATA_DIR, exist_ok=True)
    webview.settings['ALLOW_DOWNLOADS'] = True   # 导出配置 / 导出结果 open a save dialog
    webview.create_window(f'{APP_NAME} v{APP_VERSION}', url=resource('app.html'),
                          width=1440, height=920, min_size=(900, 600))
    webview.start(gui='edgechromium', private_mode=False, storage_path=DATA_DIR, http_port=HTTP_PORT)


if __name__ == '__main__':
    main()
