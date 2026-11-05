/* Name matching against the official catalogue. Pure functions, no DOM.
 * A user-entered name that matches an official name (Chinese or the current language) or alias
 * identifies the kind;
 * the display name is always the official one and the entered name becomes a tag. */
import {MODULE_KINDS, PLACEHOLDER} from '../config/catalog.js';

const FULLWIDTH = {'（': '(', '）': ')', '　': ''};

/** Canonical form for comparison: no whitespace or brackets, ASCII case-folded. */
export function normalizeName(text) {
  return String(text ?? '')
    .replace(/[（）　]/g, ch => FULLWIDTH[ch])
    .replace(/[\s()·\-_]/g, '')
    .toLowerCase();
}

const termsCache = new Map();
function terms(kindId) {
  if (!termsCache.has(kindId)) {
    const kind = MODULE_KINDS[kindId];
    // Display name (current language), the Chinese name and aliases, and the display name without
    // "module" so English users can type "Overclock" as Chinese users type 超频.
    const short = normalizeName(kind.name).replace(/module$/, '');
    termsCache.set(kindId, [kind.name, kind.zhName, short, ...(kind.aliases || [])].map(normalizeName).filter(Boolean));
  }
  return termsCache.get(kindId);
}

/**
 * Kinds whose official name or alias best matches `name`.
 * Exact matches outrank containment; among containments the longest term wins,
 * so "超频模组 2" → 超频模组 and "AI" → both neural cores (shape decides later).
 */
export function matchKindsByName(name, type) {
  const n = normalizeName(name);
  if (!n) return [];
  let best = 0;
  let out = [];
  for (const [id, kind] of Object.entries(MODULE_KINDS)) {
    if (type && kind.type !== type) continue;
    let score = 0;
    for (const t of terms(id)) {
      if (n === t) score = Math.max(score, t.length * 2 + 1);
      else if (n.includes(t)) score = Math.max(score, t.length * 2);
    }
    if (score > best) {
      best = score;
      out = [id];
    } else if (score && score === best) out.push(id);
  }
  return out;
}

/** Official display name for an item with resolved kind, else its own name. */
export function displayName(item, kindId) {
  if (kindId && MODULE_KINDS[kindId]) return MODULE_KINDS[kindId].name;
  return item.name || PLACEHOLDER.name;
}

/** The user's own name as an extra tag, or '' when it only repeats the official name. */
export function nameTag(item, kindId) {
  const name = (item.name ?? '').trim();
  if (!name || !kindId || !MODULE_KINDS[kindId]) return '';
  return terms(kindId).includes(normalizeName(name)) ? '' : name;
}
