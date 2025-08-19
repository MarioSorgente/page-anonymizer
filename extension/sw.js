'use strict';
// ===== Page Anonymizer — MV3 Service Worker (v0.4.0, no-regex) =====
// Minimal worker: context-menu + keyboard command to anonymize & copy.
// Clipboard write runs in the page via executeScript (works with user gesture).

// ---- Storage helpers
async function getRules() {
  const out = await chrome.storage.local.get({ rules: [] });
  return Array.isArray(out.rules) ? out.rules : [];
}

// ---- Utils (no-regex: always escape)
function escapeRegExp(str) { return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function buildRegex(rule) {
  const base = escapeRegExp(rule.pattern || '');
  const wrapped = rule.wholeWord ? '\\b(?:' + base + ')\\b' : base;
  const flags = rule.caseSensitive ? 'g' : 'gi';
  return new RegExp(wrapped, flags);
}

// ---- Main: Anonymize & Copy (page or selection)
async function anonymizeAndCopy(selectionOnly) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;
  const rules = await getRules();

  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: (rulesArg, selectionOnlyArg) => {
      function escapeRegExp(str) { return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
      function buildRegex(rule) {
        const base = escapeRegExp(rule.pattern || '');
        const wrapped = rule.wholeWord ? '\\b(?:' + base + ')\\b' : base;
        const flags = rule.caseSensitive ? 'g' : 'gi';
        return new RegExp(wrapped, flags);
      }
      function applyAll(text, list) {
        let out = text || '';
        const sorted = (list || []).slice().sort((a, b) => (b.pattern || '').length - (a.pattern || '').length);
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

// ---- Install menus
chrome.runtime.onInstalled.addListener(() => {
  try {
    chrome.contextMenus.create({ id: 'pa_copy_page', title: 'Anonymize & Copy Page', contexts: ['page'] });
    chrome.contextMenus.create({ id: 'pa_copy_selection', title: 'Anonymize & Copy Selection', contexts: ['selection'] });
  } catch {}
});

// ---- Menu actions
chrome.contextMenus.onClicked.addListener(async (info) => {
  if (info.menuItemId === 'pa_copy_page') await anonymizeAndCopy(false);
  if (info.menuItemId === 'pa_copy_selection') await anonymizeAndCopy(true);
});

// ---- Keyboard command (optional)
chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'copy-page') await anonymizeAndCopy(false);
});
