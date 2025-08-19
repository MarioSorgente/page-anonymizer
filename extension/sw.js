'use strict';

// ===== Page Anonymizer — MV3 Service Worker (v0.2.0) =====

// Storage helpers
async function getRules() {
  const out = await chrome.storage.local.get({ rules: [] });
  return Array.isArray(out.rules) ? out.rules : [];
}
async function getEnabledOrigins() {
  const out = await chrome.storage.local.get({ enabledOrigins: {} });
  return out.enabledOrigins || {};
}
async function setEnabledOrigins(map) {
  await chrome.storage.local.set({ enabledOrigins: map || {} });
}

// URL helpers
function originFromUrl(url) {
  try { return new URL(url).origin; } catch { return null; }
}
async function isOriginEnabled(url) {
  const origin = originFromUrl(url);
  if (!origin) return false;
  const map = await getEnabledOrigins();
  return !!map[origin];
}

// Permissions (per-site)
async function requestOriginPermission(origin) {
  try { return await chrome.permissions.request({ origins: [origin + '/*'] }); }
  catch { return false; }
}
async function removeOriginPermission(origin) {
  try { await chrome.permissions.remove({ origins: [origin + '/*'] }); }
  catch { /* ignore */ }
}

// Scripting helpers
async function injectContent(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content.js']
    });
  } catch { /* ignore */ }
}
async function sendMessageToTab(tabId, msg) {
  try {
    await chrome.tabs.sendMessage(tabId, msg);
  } catch {
    await injectContent(tabId);
    try { await chrome.tabs.sendMessage(tabId, msg); } catch { /* ignore */ }
  }
}

// Toggle enabled state for active tab's origin.
// Returns the NEW enabled state (true = enabled).
async function toggleForActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.url) return false;
  const origin = originFromUrl(tab.url);
  if (!origin) return false;

  const map = await getEnabledOrigins();
  const currently = !!map[origin];

  if (currently) {
    delete map[origin];
    await setEnabledOrigins(map);
    await sendMessageToTab(tab.id, { type: 'PA_DISABLE' });
    await removeOriginPermission(origin);
    return false;
  } else {
    const granted = await requestOriginPermission(origin);
    if (!granted) return false;
    map[origin] = true;
    await setEnabledOrigins(map);
    await injectContent(tab.id);
    await sendMessageToTab(tab.id, { type: 'PA_ENABLE' });
    return true;
  }
}

// Anonymize & Copy (page or selection)
async function anonymizeAndCopy(selectionOnly) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab) return;
  const rules = await getRules();

  await injectContent(tab.id);
  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: (rulesArg, selectionOnlyArg) => {
      function escapeRegExp(str) { return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
      function buildRegex(rule) {
        function escapeRegExp(str) { return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
        const base = escapeRegExp(rule.pattern);
        const wrapped = rule.wholeWord ? '\\b(?:' + base + ')\\b' : base;
        const flags = rule.caseSensitive ? 'g' : 'gi';
        return new RegExp(wrapped, flags);
        }    

      function applyAll(text, list) {
        let out = text;
        const sorted = (list || []).slice().sort((a, b) => (b.pattern||'').length - (a.pattern||'').length);
        for (const r of sorted) {
          if (!r || !r.pattern) continue;
          try { out = out.replace(buildRegex(r), r.replacement || ''); } catch {}
        }
        return out;
      }
      const sel = (window.getSelection && window.getSelection().toString()) || '';
      const text = (selectionOnlyArg && sel) ? sel : document.body.innerText;
      const sanitized = applyAll(text, rulesArg || []);
      if (navigator.clipboard?.writeText) navigator.clipboard.writeText(sanitized).catch(()=>{});
    },
    args: [rules, !!selectionOnly]
  });
}

// Install: create context menus
chrome.runtime.onInstalled.addListener(() => {
  try {
    chrome.contextMenus.create({ id: 'pa_copy_page', title: 'Anonymize & Copy Page', contexts: ['page'] });
    chrome.contextMenus.create({ id: 'pa_copy_selection', title: 'Anonymize & Copy Selection', contexts: ['selection'] });
  } catch {}
});

// Context menu actions
chrome.contextMenus.onClicked.addListener(async (info) => {
  if (info.menuItemId === 'pa_copy_page') await anonymizeAndCopy(false);
  if (info.menuItemId === 'pa_copy_selection') await anonymizeAndCopy(true);
});

// Keyboard shortcuts
chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'toggle-site') await toggleForActiveTab();
  if (command === 'copy-page') await anonymizeAndCopy(false);
});

// Re-enable on navigation for enabled origins
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete' || !tab?.url) return;
  if (await isOriginEnabled(tab.url)) {
    await injectContent(tabId);
    await sendMessageToTab(tabId, { type: 'PA_ENABLE' });
  }
});

// Messages from popup (return definitive state to avoid UI “bounce”)
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || !msg.type) return false;

  if (msg.type === 'PA_TOGGLE_ACTIVE') {
    (async () => {
      const enabled = await toggleForActiveTab();
      sendResponse({ ok: true, enabled });
    })();
    return true;
  }

  if (msg.type === 'PA_GET_STATE') {
    (async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const enabled = tab?.url ? await isOriginEnabled(tab.url) : false;
      sendResponse({ enabled: !!enabled });
    })();
    return true;
  }

  if (msg.type === 'PA_COPY') {
    anonymizeAndCopy(!!msg.selectionOnly).then(() => sendResponse({ ok: true })).catch(() => sendResponse({ ok: false }));
    return true;
  }

  return false;
});
