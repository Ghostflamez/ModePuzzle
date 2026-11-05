/* UI language. The Chinese source text is the key: tl('导入配置') returns the English text from
 * en.js when the language is English, the Chinese text otherwise (also when a key is missing).
 * Placeholders {0}, {1}… are filled from the extra arguments; named ones like {mount} are left
 * for fillRuleText. The language is fixed for a page load: switching stores the choice and
 * reloads, so every module evaluates its text once in the right language. */
import {EN} from './en.js';

export const LANGS = Object.freeze(['zh', 'en']);
export const LANG_STORAGE_KEY = 'modepuzzle-lang';
export const LANG_PARAM = 'lang';

function detect() {
  const valid = v => (LANGS.includes(v) ? v : null);
  // Workers and Node (tests) have no document: Chinese unless told otherwise via setLang.
  if (typeof document === 'undefined') return 'zh';
  try {
    const fromUrl = valid(new URLSearchParams(location.search).get(LANG_PARAM));
    if (fromUrl) return fromUrl;
  } catch { /* no location */ }
  try {
    const saved = valid(localStorage.getItem(LANG_STORAGE_KEY));
    if (saved) return saved;
  } catch { /* storage blocked */ }
  return /^zh\b/i.test(navigator.language || 'zh') ? 'zh' : 'en';
}

let lang = detect();

export const getLang = () => lang;
/** Set the language without reloading (workers / tests). The page uses switchLang instead. */
export function setLang(next) {
  if (LANGS.includes(next)) lang = next;
}

export function tl(text, ...args) {
  const out = lang === 'en' && Object.prototype.hasOwnProperty.call(EN, text) ? EN[text] : text;
  return args.length ? out.replace(/\{(\d+)\}/g, (m, i) => (args[i] === undefined ? m : String(args[i]))) : out;
}

/** Remember the choice and reload the page in that language. */
export function switchLang(next) {
  if (!LANGS.includes(next) || next === lang) return;
  try { localStorage.setItem(LANG_STORAGE_KEY, next); } catch { /* storage blocked: the URL still carries it */ }
  const url = new URL(location.href);
  url.searchParams.set(LANG_PARAM, next);
  location.replace(url.toString());
}

const ATTRS = ['title', 'placeholder', 'aria-label', 'alt'];
/** Translate the static page (index.html): text nodes and a few attributes whose trimmed text is a key. */
export function translateDom(root) {
  if (lang === 'zh') return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const node of nodes) {
    const raw = node.nodeValue;
    const key = raw.trim();
    if (key && Object.prototype.hasOwnProperty.call(EN, key)) node.nodeValue = raw.replace(key, EN[key]);
  }
  for (const el of root.querySelectorAll('*')) {
    for (const attr of ATTRS) {
      const v = el.getAttribute(attr);
      if (v && Object.prototype.hasOwnProperty.call(EN, v.trim())) el.setAttribute(attr, EN[v.trim()]);
    }
  }
}
