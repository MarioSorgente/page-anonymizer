'use strict';
// ===== DataMask — MV3 Service Worker (v0.6.5) =====
// Context menus + keyboard command. Number-aware matching inc. decimals.

async function getRules() {
  const out = await chrome.storage.local.get({ rules: [] });
  return Array.isArray(out.rules) ? out.rules : [];
}

// ---- Number-aware helpers (also used inside injected page func)
function escapeRegExp(str) { return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
const SEP_CLASS = "[\\s,\\.\\u00A0\\u202F\\u2009\\u2007'’]";
function isDigit(ch) { return ch >= '0' && ch <= '9'; }
function isPatSep(ch) { return /[,\.\u00A0\u202F\u2009\u2007'’\s]/.test(ch); }
function flexibleDigits(digits) { return digits.split('').join(`(?:${SEP_CLASS})?`); }

function parseNumberToken(pat, i) {
  let intDigits = '';
  let fracDigits = null;
  const n = pat.length;

  // integer with in-pattern separators skipped
  while (i < n) {
    const ch = pat[i];
    if (isDigit(ch)) { intDigits += ch; i++; continue; }
    if (isPatSep(ch)) { i++; continue; }
    break;
  }

  // optional decimal in pattern
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

async function anonymizeAndCopy(selectionOnly) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;
  const rules = await getRules();

  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: (rulesArg, selectionOnlyArg) => {
      function escapeRegExp(str) { return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
      const SEP_CLASS = "[\\s,\\.\\u00A0\\u202F\\u2009\\u2007'’]";
      function isDigit(ch) { return ch >= '0' && ch <= '9'; }
      function isPatSep(ch) { return /[,\.\u00A0\u202F\u2009\u2007'’\s]/.test(ch); }
      function flexibleDigits(d) { return d.split('').join(`(?:${SEP_CLASS})?`); }
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
      if (navigator.clipboard?.writeText) navigator.clipboard.writeText(sanitized).catch(()=>{});
    },
    args: [rules, !!selectionOnly]
  });
}

chrome.runtime.onInstalled.addListener(() => {
  try {
    chrome.contextMenus.create({ id: 'pa_copy_page', title: 'Anonymize & Copy Page', contexts: ['page'] });
    chrome.contextMenus.create({ id: 'pa_copy_selection', title: 'Anonymize & Copy Selection', contexts: ['selection'] });
  } catch {}
});

chrome.contextMenus.onClicked.addListener(async (info) => {
  if (info.menuItemId === 'pa_copy_page') await anonymizeAndCopy(false);
  if (info.menuItemId === 'pa_copy_selection') await anonymizeAndCopy(true);
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'copy-page') await anonymizeAndCopy(false);
});
