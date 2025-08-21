'use strict';
// ===== DataMask — MV3 Service Worker (v0.6.5) =====
// Context menus, keyboard command, and locale-friendly number matching (thousands + decimals).
// Adds a guard to avoid running on chrome://, chrome-extension://, devtools://, etc.

function isRestrictedUrl(url = '') {
  return /^(chrome|chrome-extension|edge|devtools|about|view-source):/i.test(url);
}

async function getRules() {
  const out = await chrome.storage.local.get({ rules: [] });
  return Array.isArray(out.rules) ? out.rules : [];
}

// (Optional) Helpers kept here for parity; main matching happens in the injected function.
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

// ---- Core action
async function anonymizeAndCopy(selectionOnly) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || isRestrictedUrl(tab.url)) {
    // Silently ignore restricted pages like chrome://extensions
    return;
  }
  const rules = await getRules();

  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: (rulesArg, selectionOnlyArg) => {
      // This code runs in the page context
      function escapeRegExp(str) { return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
      const SEP_CLASS = "[\\s,\\.\\u00A0\\u202F\\u2009\\u2007'’]";
      function isDigit(ch) { return ch >= '0' && ch <= '9'; }
      function isPatSep(ch) { return /[,\.\u00A0\u202F\u2009\u2007'’\s]/.test(ch); }
      function flexibleDigits(d) { return d.split('').join(`(?:${SEP_CLASS})?`); }
      function parseNumberToken(pat, i) {
        let intDigits = '', fracDigits = null;
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
        const dec = (fracDigits !== null) ? `(?:[.,]${fracDigits})` : `(?:[.,]\\d{1,2})?`;
        return { regexSrc: `${intFlex}${dec}`, nextIndex: i };
      }
      function buildFlexibleBase(p) {
        let out = '';
        for (let i = 0; i < p.length; ) {
          const ch = p[i];
          if (isDigit(ch)) {
            const t = parseNumberToken(p, i);
            out += t.regexSrc;
            i = t.nextIndex;
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
      function applyAll(text, list) {
        let out = text || '';
        const sorted = (list || []).slice().sort((a, b) => (b.pattern||'').length - (a.pattern||'').length);
        for (const r of sorted) {
          if (!r || !r.pattern) continue;
          try { out = out.replace(buildRegex(r), r.replacement || ''); } catch {}
        }
        return out;
      }

      const sel = (window.getSelection && window.getSelection().toString()) || '';
      const text = (selectionOnlyArg && sel) ? sel : (document.body ? (document.body.innerText || '') : '');
      const sanitized = applyAll(text, rulesArg || []);

      // Clipboard write (best-effort)
      if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(sanitized).catch(() => {});
      } else {
        const ta = document.createElement('textarea');
        ta.value = sanitized;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
      }
    },
    args: [rules, !!selectionOnly]
  });
}

// ---- Menus & commands
chrome.runtime.onInstalled.addListener(() => {
  try {
    chrome.contextMenus.create({
      id: 'pa_copy_page',
      title: 'Anonymize & Copy Page',
      contexts: ['page']
    });
    chrome.contextMenus.create({
      id: 'pa_copy_selection',
      title: 'Anonymize & Copy Selection',
      contexts: ['selection']
    });
  } catch (e) {
    // Ignore if already exists
  }
});

chrome.contextMenus.onClicked.addListener(async (info) => {
  if (info.menuItemId === 'pa_copy_page') await anonymizeAndCopy(false);
  if (info.menuItemId === 'pa_copy_selection') await anonymizeAndCopy(true);
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'copy-page') await anonymizeAndCopy(false);
});
