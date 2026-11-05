/* Opt-in game sprites ("sprite pack"), read from the user's own local game install.
 * Stored only in this browser / desktop app under its own key: never part of the config,
 * exports or any build. Pure functions plus a tiny storage wrapper; no DOM. */
import {SHAPES} from '../render/module-art.js';
import {tl} from '../i18n/index.js';

export const GAME_ART_KEY = 'module-layout-game-art-v1';
export const GAME_ART_FORMAT = 'modepuzzle-game-sprites-1';

const norm = cells => {
  const x = Math.min(...cells.map(p => p[0]));
  const y = Math.min(...cells.map(p => p[1]));
  return JSON.stringify(cells.map(p => [p[0] - x, p[1] - y]).sort((a, b) => a[1] - b[1] || a[0] - b[0]));
};

/**
 * Validate a pack and keep only sprites whose cells equal the shape the app expects for that id
 * (same orientation), so rotation/mirroring computed from SHAPES stays correct.
 * Returns {pack, used, skipped} or throws.
 */
export function checkGameArt(raw) {
  if (!raw || raw.format !== GAME_ART_FORMAT) throw Error(tl('不是本工具生成的贴图包'));
  const {alphabet, transparent, palette, sprites} = raw;
  if (typeof alphabet !== 'string' || typeof transparent !== 'string' || !Array.isArray(palette)
    || palette.length > alphabet.length || !palette.every(c => /^#[0-9a-f]{6}$/i.test(c)) || !sprites || typeof sprites !== 'object') {
    throw Error(tl('贴图包格式无效'));
  }
  const kept = {};
  const skipped = [];
  for (const [name, s] of Object.entries(sprites)) {
    const ok = SHAPES[name] && Number.isInteger(s?.w) && Number.isInteger(s?.h) && Array.isArray(s.rows) && s.rows.length === s.h
      && s.rows.every(r => typeof r === 'string' && r.length === s.w && [...r].every(ch => ch === transparent || alphabet.indexOf(ch) > -1 && alphabet.indexOf(ch) < palette.length))
      && Array.isArray(s.cells) && s.cells.length && norm(s.cells) === norm(SHAPES[name]);
    if (ok) kept[name] = {w: s.w, h: s.h, cells: s.cells, rows: s.rows};
    else skipped.push(name);
  }
  if (!Object.keys(kept).length) throw Error(tl('贴图包里没有可用的模组贴图'));
  return {pack: {format: GAME_ART_FORMAT, alphabet, transparent, palette, sprites: kept}, used: Object.keys(kept).length, skipped};
}

export function loadGameArt(storage) {
  try {
    const text = storage.getItem(GAME_ART_KEY);
    return text ? checkGameArt(JSON.parse(text)).pack : null;
  } catch {
    return null;
  }
}

export function saveGameArt(storage, pack) {
  storage.setItem(GAME_ART_KEY, JSON.stringify(pack));
}

export function clearGameArt(storage) {
  storage.removeItem(GAME_ART_KEY);
}
