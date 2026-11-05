"""Build dist/module-layout-offline.html: one self-contained file that works from file://.

ES modules under src/ are wrapped into a tiny module registry (no third-party tools).
Supported module syntax (keep source within it):
  import {a, b as c} from './x.js';
  export const|let|function|class name ...
  export {a, b as c};
Usage: python scripts/build.py
"""
from __future__ import annotations

import base64
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / 'src'
DIST = ROOT / 'dist'
OUT = DIST / 'module-layout-offline.html'

IMPORT_RE = re.compile(r"^import\s*\{([^}]*)\}\s*from\s*'([^']+)';\s*$", re.M | re.S)
EXPORT_DECL_RE = re.compile(r'^export\s+(?:async\s+)?(const|let|function\*?|class)\s+([A-Za-z_$][\w$]*)', re.M)
EXPORT_LIST_RE = re.compile(r'^export\s*\{([^}]*)\};?\s*$', re.M)


def module_id(path: Path) -> str:
    return path.relative_to(SRC).as_posix()


def parse(path: Path):
    text = path.read_text(encoding='utf-8')
    deps, prelude = [], []
    for names, spec in IMPORT_RE.findall(text):
        dep = (path.parent / spec).resolve()
        deps.append(dep)
        binds = []
        for part in names.split(','):
            part = part.strip()
            if not part:
                continue
            src, _, alias = part.partition(' as ')
            binds.append(f'{src.strip()}: {alias.strip()}' if alias else src.strip())
        prelude.append(f"const {{{', '.join(binds)}}} = __require({json.dumps(module_id(dep))});")
    body = IMPORT_RE.sub('', text)
    exports = [name for _, name in EXPORT_DECL_RE.findall(body)]
    body = EXPORT_DECL_RE.sub(lambda m: m.group(0).replace('export ', '', 1), body)
    for names in EXPORT_LIST_RE.findall(body):
        for part in names.split(','):
            part = part.strip()
            if part:
                src, _, alias = part.partition(' as ')
                exports.append(f'{alias.strip()}: {src.strip()}' if alias else src.strip())
    body = EXPORT_LIST_RE.sub('', body)
    if re.search(r'^\s*(import|export)\b', body, re.M):
        raise SystemExit(f'unsupported module syntax in {path}')
    return deps, '\n'.join(prelude) + '\n' + body, exports


def bundle(entry: Path) -> str:
    order, seen, parsed = [], set(), {}

    def visit(path: Path):
        if path in seen:
            return
        seen.add(path)
        deps, body, exports = parse(path)
        parsed[path] = (body, exports)
        for dep in deps:
            visit(dep)
        order.append(path)

    visit(entry.resolve())
    out = ['(() => {', 'const __defs = {}, __cache = {};',
           'const __require = id => __cache[id] || (__cache[id] = __defs[id]());']
    for path in order:
        body, exports = parsed[path]
        out.append(f'__defs[{json.dumps(module_id(path))}] = () => {{\n{body}\nreturn {{{", ".join(exports)}}};\n}};')
    out.append(f'__require({json.dumps(module_id(entry.resolve()))});')
    out.append('})();')
    return '\n'.join(out)


def inline_css() -> str:
    css = (SRC / 'style.css').read_text(encoding='utf-8')

    def font(match):
        data = base64.b64encode((SRC / match.group(1)).read_bytes()).decode()
        return f"url('data:font/woff2;base64,{data}')"
    return re.sub(r"url\('(assets/fonts/[^']+)'\)", font, css)


def main():
    worker = bundle(SRC / 'core' / 'worker.js')
    app = bundle(SRC / 'app.js').replace('import.meta.url', 'location.href')
    html = (SRC / 'index.html').read_text(encoding='utf-8')
    worker_boot = ('<script>globalThis.OFFLINE_WORKER_URL = URL.createObjectURL(new Blob(['
                   + json.dumps(worker, ensure_ascii=False).replace('</', '<\\/')
                   + "], {type: 'text/javascript'}));</script>")
    html = html.replace('<link rel="stylesheet" href="style.css">', '<style>\n' + inline_css() + '\n</style>')
    html = html.replace('<script type="module" src="app.js"></script>',
                        worker_boot + '\n<script>\n' + app.replace('</script', '<\\/script') + '\n</script>')
    DIST.mkdir(exist_ok=True)
    OUT.write_text(html, encoding='utf-8')
    print('built', OUT.relative_to(ROOT), f'{OUT.stat().st_size // 1024} KB')


if __name__ == '__main__':
    main()
