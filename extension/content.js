// ===== DataMask — Content Script (v0.6.5) =====
// Number-aware matching with thousands separators and optional decimals.

let enabled = false;
let observer = null;
let currentRules = [];

const EXCLUDE_SELECTOR = [
  'script','style','noscript','textarea','input','select',
  'pre','code','kbd','samp',
  '[contenteditable="true"]',
  '.pa-anon'
].join(',');

// ---- Number-aware helpers
function escapeRegExp(str) { return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
const SEP_CLASS = "[\\s,\\.\\u00A0\\u202F\\u2009\\u2007'’]";
function isDigit(ch) { return ch >= '0' && ch <= '9'; }
function isPatSep(ch) { return /[,\.\u00A0\u202F\u2009\u2007'’\s]/.test(ch); }
function flexibleDigits(digits) { return digits.split('').join(`(?:${SEP_CLASS})?`); }

function parseNumberToken(pat, i) {
  let intDigits = '';
  let fracDigits = null;
  const n = pat.length;

  while (i < n) {
    const ch = pat[i];
    if (isDigit(ch)) { intDigits += ch; i++; continue; }
    if (isPatSep(ch)) { i++; continue; }
    break;
  }

  if (i < n && (pat[i] === '.' || pat[i] === ',') && (i + 1 < n) && isDigit(pat[i + 1])) {
    i++;
    let f = '';
    while (i < n && isDigit(pat[i])) { f += pat[i]; i++; }
    fracDigits = f;
  }

  const intFlex = flexibleDigits(intDigits);
  const decimalPart = (fracDigits !== null)
    ? `(?:[.,]${fracDigits})`
    : `(?:[.,]\\d{1,2})?`;

  return { regexSrc: `${intFlex}${decimalPart}`, nextIndex: i };
}

function buildFlexibleBase(pat) {
  let out = '';
  for (let i = 0; i < pat.length; ) {
    const ch = pat[i];
    if (isDigit(ch)) {
      const tok = parseNumberToken(pat, i);
      out += tok.regexSrc;
      i = tok.nextIndex;
    } else {
      out += escapeRegExp(ch);
      i++;
    }
  }
  return out;
}

function buildRegex(rule) {
  const base = buildFlexibleBase(String(rule.pattern || ''));
  const body = rule.wholeWord
    ? `(?<![A-Za-z0-9_])(?:${base})(?![A-Za-z0-9_])`
    : `(?:${base})`;
  const flags = rule.caseSensitive ? 'g' : 'gi';
  return new RegExp(body, flags);
}

function replaceInTextNode(node, rule) {
  const re = buildRegex(rule);
  const text = node.nodeValue || '';
  if (!text || !re.test(text)) return;
  re.lastIndex = 0;

  const frag = document.createDocumentFragment();
  let last = 0, m;
  while ((m = re.exec(text)) !== null) {
    const start = m.index, end = start + m[0].length;
    if (start > last) frag.appendChild(document.createTextNode(text.slice(last, start)));
    const span = document.createElement('span');
    span.className = 'pa-anon';
    span.textContent = (rule.replacement ?? '');
    span.dataset.original = m[0];
    frag.appendChild(span);
    last = end;
  }
  if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
  node.parentNode.replaceChild(frag, node);
}

function walkAndReplace(root, rules) {
  for (const rule of rules) {
    if (!rule?.pattern) continue;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => {
        if (!n.nodeValue || !n.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
        const p = n.parentElement;
        if (!p) return NodeFilter.FILTER_REJECT;
        if (p.closest(EXCLUDE_SELECTOR)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const tn of nodes) replaceInTextNode(tn, rule);
  }
}

function clearAnonymization(root) {
  const spans = root.querySelectorAll('span.pa-anon');
  for (const s of spans) s.replaceWith(document.createTextNode(s.dataset.original || ''));
}

async function loadRules() {
  const { rules } = await chrome.storage.local.get({ rules: [] });
  currentRules = (rules || []).slice().sort((a, b) => (b.pattern || '').length - (a.pattern || '').length);
}

async function enable() {
  if (enabled) return;
  enabled = true;
  await loadRules();
  walkAndReplace(document.body, currentRules);
  observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      for (const n of m.addedNodes) {
        if (n.nodeType === Node.ELEMENT_NODE) {
          const el = /** @type {Element} */ (n);
          if (el.matches(EXCLUDE_SELECTOR)) continue;
          walkAndReplace(el, currentRules);
        }
      }
    }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
}

function disable() {
  if (!enabled) return;
  enabled = false;
  observer?.disconnect();
  observer = null;
  clearAnonymization(document.body);
}

// Apply updates when rules change
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.rules) {
    currentRules = (changes.rules.newValue || []).slice().sort((a, b) => (b.pattern || '').length - (a.pattern || '').length);
    if (enabled) {
      clearAnonymization(document.body);
      walkAndReplace(document.body, currentRules);
    }
  }
});

// Messages (kept for future use)
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === 'PA_ENABLE') enable();
  if (msg?.type === 'PA_DISABLE') disable();
});

// Minimal styling for inline replacements
const style = document.createElement('style');
style.textContent = `
  .pa-anon{
    background: rgba(0,0,0,0.06);
    border-radius: 6px;
    padding: 0 4px;
    transition: opacity .15s ease;
  }
  .pa-anon:hover{ opacity: .85; }
`;
document.documentElement.appendChild(style);
