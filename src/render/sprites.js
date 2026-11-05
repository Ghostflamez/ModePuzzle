/* Module visuals: shape matching against the game's kinds, and canvas drawing of this
 * project's own pixel art (module-art.js). If the user allowed it, sprites read from their own
 * local game install (core/game-art.js) replace the generated art. A kind/shape combination the
 * game does not have is drawn with the placeholder style. */
import {SHAPES, ART_CELL, renderArt} from './module-art.js';
import {MODULE_KINDS, UNOFFICIAL_KIND} from '../config/catalog.js';
import {METRICS} from '../config/game-rules.js';
import {BOARD_RENDER, PIXEL_ICONS} from '../config/ui.js';
import {matchKindsByName} from '../core/naming.js';

export const CELL_PIXELS = ART_CELL;
const AXES = METRICS.map((_, k) => k);

/* ---------- shape matching (pure, testable) ---------- */

const norm = cells => {
  const x = Math.min(...cells.map(p => p[0]));
  const y = Math.min(...cells.map(p => p[1]));
  return cells.map(p => [p[0] - x, p[1] - y]).sort((a, b) => a[1] - b[1] || a[0] - b[0]);
};
const key = cells => JSON.stringify(norm(cells));
/** Same transform as the engine: mirror first, then rotate r quarter turns. */
const turn = (cells, r, f) => norm(cells.map(([x, y]) => {
  if (f) x = -x;
  for (let i = 0; i < r; i++) [x, y] = [-y, x];
  return [x, y];
}));

/** Orientation (r, f) that maps the sprite's own cells onto `cells`, or null. */
export function matchSprite(spriteName, cells) {
  const target = key(cells);
  const own = SHAPES[spriteName];
  for (let f = 0; f < 2; f++) for (let r = 0; r < 4; r++) if (key(turn(own, r, f)) === target) return {r, f};
  return null;
}

/** Shape id (with orientation) that a kind may use for `cells`. */
export function kindSpriteFor(kindId, cells) {
  const kind = MODULE_KINDS[kindId];
  if (!kind) return null;
  for (const sprite of kind.sprites) {
    const m = matchSprite(sprite, cells);
    if (m) return {sprite, ...m};
  }
  return null;
}

/** Legal shapes of a kind, one per shape id. */
export function kindShapes(kindId) {
  return MODULE_KINDS[kindId].sprites.map(sprite => ({sprite, cells: norm(SHAPES[sprite])}));
}

const sign = v => Math.sign(v);
const signScore = (item, kind) => AXES.reduce((s, k) => s
  + (sign(item.base[k]) === sign(kind.base[k]) ? 1 : 0)
  + (item.base[k] > 0 && kind.base[k] > 0 ? 1 : 0), 0);

/**
 * Best official kind for an item saved without `kind`, plus how it was found.
 * 1. name: the entered name (or a merged alias) matches an official name/alias
 *    and that kind officially comes in this shape;
 * 2. shape: among kinds that come in this shape, the template whose attribute
 *    signs agree most (ties keep catalogue order).
 * Returns {id: null} when no official kind has this shape.
 */
export function inferKindDetailed(item, cells = item.shape) {
  const pick = ids => {
    let best = null;
    for (const id of ids) {
      if (!kindSpriteFor(id, cells)) continue;
      const score = signScore(item, MODULE_KINDS[id]);
      if (!best || score > best.score) best = {id, score};
    }
    return best?.id ?? null;
  };
  for (const name of [item.name, ...(item.aliases || [])]) {
    const id = pick(matchKindsByName(name, item.type));
    if (id) return {id, source: 'name'};
  }
  const ids = Object.keys(MODULE_KINDS).filter(id => MODULE_KINDS[id].type === item.type);
  const id = pick(ids);
  return {id, source: id ? 'shape' : null};
}

export const inferKind = (item, cells = item.shape) => inferKindDetailed(item, cells).id;

/**
 * Visual description of an item placed with `cells` (defaults to its stored shape).
 * { kindId, inferred, inferredBy ('name' | 'shape' | null), official, sprite, r, f, cells, w, h }
 */
export function resolveVisual(item, cells = item.shape) {
  const inferred = item.kind === undefined;
  const guess = inferred ? inferKindDetailed(item, cells) : null;
  const kindId = inferred ? guess.id : item.kind === UNOFFICIAL_KIND ? null : item.kind;
  const match = kindId ? kindSpriteFor(kindId, cells) : null;
  const shape = norm(cells);
  return {
    kindId, inferred, inferredBy: guess?.source ?? null, official: !!match, sprite: match?.sprite ?? null, r: match?.r ?? 0, f: match?.f ?? 0,
    cells: shape,
    w: Math.max(...shape.map(p => p[0])) + 1,
    h: Math.max(...shape.map(p => p[1])) + 1,
  };
}

/* ---------- canvas drawing (browser only) ---------- */

/* ---------- opt-in game sprites ---------- */

let gameArt = null;
const decoded = new Map();
/** Use a checked sprite pack (or null to go back to the generated art). */
export function setGameArt(pack) {
  gameArt = pack;
  decoded.clear();
}
export const gameArtActive = () => !!gameArt;

function gameSpriteCanvas(name) {
  if (decoded.has(name)) return decoded.get(name);
  const s = gameArt.sprites[name];
  const canvas = document.createElement('canvas');
  canvas.width = s.w;
  canvas.height = s.h;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(s.w, s.h);
  s.rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      if (row[x] === gameArt.transparent) continue;
      const hex = gameArt.palette[gameArt.alphabet.indexOf(row[x])];
      const i = (y * s.w + x) * 4;
      img.data[i] = parseInt(hex.slice(1, 3), 16);
      img.data[i + 1] = parseInt(hex.slice(3, 5), 16);
      img.data[i + 2] = parseInt(hex.slice(5, 7), 16);
      img.data[i + 3] = 255;
    }
  });
  ctx.putImageData(img, 0, 0);
  decoded.set(name, canvas);
  return canvas;
}

const drawn = new Map();
/** Generated art of a kind on these exact cells, as a 1:1 canvas (cached). */
function artCanvas(kindId, cells) {
  const cacheKey = kindId + JSON.stringify(cells);
  if (drawn.has(cacheKey)) return drawn.get(cacheKey);
  const art = renderArt(kindId, cells);
  const canvas = document.createElement('canvas');
  canvas.width = art.w;
  canvas.height = art.h;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(art.w, art.h);
  art.px.forEach((row, y) => row.forEach((hex, x) => {
    if (!hex) return;
    const i = (y * art.w + x) * 4;
    img.data[i] = parseInt(hex.slice(1, 3), 16);
    img.data[i + 1] = parseInt(hex.slice(3, 5), 16);
    img.data[i + 2] = parseInt(hex.slice(5, 7), 16);
    img.data[i + 3] = 255;
  }));
  ctx.putImageData(img, 0, 0);
  drawn.set(cacheKey, canvas);
  return canvas;
}

const cssVar = (name, fallback) => {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
};

/** Placeholder: hatched plate following the exact cells, clearly not official art. */
function drawPlaceholder(ctx, cells, unit) {
  const own = new Set(cells.map(c => c.join(',')));
  const ink = cssVar('--placeholder-ink', '#29222f');
  const a = cssVar('--placeholder-a', '#6b6a63');
  const b = cssVar('--placeholder-b', '#4b4a46');
  const px = unit / CELL_PIXELS;
  const stripe = BOARD_RENDER.placeholderStripe;
  const last = CELL_PIXELS - 1;
  for (const [x, y] of cells) {
    const open = (dx, dy) => !own.has(`${x + dx},${y + dy}`);
    for (let sy = 0; sy < CELL_PIXELS; sy++) {
      for (let sx = 0; sx < CELL_PIXELS; sx++) {
        const edge = (sx === 0 && open(-1, 0)) || (sx === last && open(1, 0)) || (sy === 0 && open(0, -1)) || (sy === last && open(0, 1));
        const gx = x * CELL_PIXELS + sx, gy = y * CELL_PIXELS + sy;
        ctx.fillStyle = edge ? ink : Math.floor((gx + gy) / stripe) % 2 ? a : b;
        ctx.fillRect(x * unit + sx * px, y * unit + sy * px, px, px);
      }
    }
  }
}

/**
 * Draw `visual` into `canvas`, `unit` CSS pixels per cell. Returns the canvas.
 * Art is scaled by whole multiples where possible (nearest neighbour).
 */
export function paintVisual(canvas, visual, unit, {selected = false} = {}) {
  canvas.width = visual.w * unit;
  canvas.height = visual.h * unit;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  if (!visual.official) {
    drawPlaceholder(ctx, visual.cells, unit);
    return canvas;
  }
  ctx.save();
  if (selected) ctx.filter = `brightness(${BOARD_RENDER.selectedBrightness})`;
  if (gameArt?.sprites[visual.sprite]) {
    // Game sprite in its own orientation: rotate / mirror into place.
    const art = gameSpriteCanvas(visual.sprite);
    const scale = unit / CELL_PIXELS;
    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate(visual.r * Math.PI / 2);
    if (visual.f) ctx.scale(-1, 1);
    ctx.drawImage(art, -art.width * scale / 2, -art.height * scale / 2, art.width * scale, art.height * scale);
  } else {
    // Generated art is drawn on the placed cells directly, so no rotation or mirroring is needed.
    ctx.drawImage(artCanvas(visual.kindId, visual.cells), 0, 0, canvas.width, canvas.height);
  }
  ctx.restore();
  return canvas;
}

/** Thumbnail canvas for lists: whole-pixel scale chosen to fit `maxPx`. */
export function thumbnail(visual, maxPx) {
  const unit = Math.max(1, Math.floor(maxPx / Math.max(visual.w, visual.h) / CELL_PIXELS)) * CELL_PIXELS;
  return paintVisual(document.createElement('canvas'), visual, Math.min(unit, maxPx));
}

/* ---------- pixel icons ---------- */

const iconCache = new Map();
/** Code-drawn icon from PIXEL_ICONS; `scale` = CSS pixels per icon pixel. */
export function pixelIcon(name, scale = 2, {ink = '--icon-ink', accent = '--icon-accent'} = {}) {
  const cacheKey = `${name}:${scale}:${ink}:${accent}`;
  const rows = PIXEL_ICONS[name];
  const canvas = document.createElement('canvas');
  canvas.width = rows[0].length * scale;
  canvas.height = rows.length * scale;
  canvas.className = 'pixel-icon';
  canvas.setAttribute('aria-hidden', 'true');
  const ctx = canvas.getContext('2d');
  if (iconCache.has(cacheKey)) {
    ctx.drawImage(iconCache.get(cacheKey), 0, 0);
    return canvas;
  }
  const colors = {'#': cssVar(ink, '#2a2430'), '+': cssVar(accent, '#e8a050')};
  rows.forEach((row, y) => [...row].forEach((ch, x) => {
    if (!colors[ch]) return;
    ctx.fillStyle = colors[ch];
    ctx.fillRect(x * scale, y * scale, scale, scale);
  }));
  const copy = document.createElement('canvas');
  copy.width = canvas.width;
  copy.height = canvas.height;
  copy.getContext('2d').drawImage(canvas, 0, 0);
  iconCache.set(cacheKey, copy);
  return canvas;
}
