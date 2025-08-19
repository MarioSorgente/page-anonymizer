'use strict';

// === Page Anonymizer – MV3 Service Worker (clean, tested) ===

// Storage helpers
async function getRules() {
  const out = await chrome.storage.local.get({ rules: [] });
  return out.rules || [];
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
  try { return new URL(url).origin; } catch (e) { return null; }
}
async function isOriginEnabled(url) {
  const origin = originFromUrl(url);
  if (!origin) return false;
  const map = await getEnabledOrigins();
  return !!map[origin];
}

// Permissions (request per-site, remove when disabled)
async function requestOriginPermission(origin) {
  try {
    return await chrome.permissions.request({ origins: [origin + '/*'] });
  } catch (e) {
    return false;
  }
}
async function removeOriginPermission(origin) {
  try {
    await chrome.permissions.remove({ origins: [origin + '/*'] });
  } catch (e) {
    // ignore
  }
}

// Script injection + messaging
async function injectContent(tabId) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tabId },
      files: ['content.js']
    });
  } catch (e) {
    // ignore
  }
}
async function sendMessageToTab(tabId, msg) {
  try {
    await chrome.tabs.sendMessage(tabId, msg);
  } catch (e) {
    // Try injecting then retry once
    try {
      await injectContent(tabId);
      await chrome.tabs.sendMessage(tabId, msg);
    } catch (e2) {
      // ignore
    }
  }
}

// Toggle per active tab's origin
async function toggleForActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tabs || !tabs[0] || !tabs[0].url) return;
  const tab = tabs[0];
  const origin = originFromUrl(tab.url);
  if (!origin) return;

  const map = await getEnabledOrigins();
  const currently = !!map[origin];

  if (currently) {
    delete map[origin];
    await setEnabledOrigins(map);
    await sendMessageToTab(tab.id, { type: 'PA_DISABLE' });
    await removeOriginPermission(origin);
  } else {
    const granted = await requestOriginPermission(origin);
    if (!granted) return;
    map[origin] = true;
    await setEnabledOrigins(map);
    await injectContent(tab.id);
    await sendMessageToTab(tab.id, { type: 'PA_ENABLE' });
  }
}

// Anonymize & copy (page or selection)
async function anonymizeAndCopy(selectionOnly) {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tabs || !tabs[0]) return;
  const tab = tabs[0];
  const rules = await getRules();

  await injectContent(tab.id);
  await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: (rulesArg, selectionOnlyArg) => {
      function escapeRegExp(str) {
        return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      }
      function buildRegex(rule) {
        const base = rule.isRegex ? rule.pattern : escapeRegExp(rule.pattern);
        const wrapped = rule.wholeWord ? '\\b(?:' + base + ')\\b' : base;
        const flags = rule.caseSensitive ? 'g' : 'gi';
        return new RegExp(wrapped, flags);
      }
      function applyAll(text, rulesList) {
        let out = text;
        const sorted = (rulesList || []).slice().sort((a, b) => {
          const al = (a.pattern || '').length;
          const bl = (b.pattern || '').length;
          return bl - al;
        });
        for (let i = 0; i < sorted.length; i++) {
          const r = sorted[i];
          if (!r || !r.pattern) continue;
          const re = buildRegex(r);
          try { out = out.replace(re, r.replacement || ''); } catch (e) {}
        }
        return out;
      }
      const sel = (window.getSelection && window.getSelection().toString()) || '';
      const text = selectionOnlyArg && sel ? sel : document.body.innerText;
      const sanitized = applyAll(text, rulesArg || []);
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(sanitized).catch(() => {});
      }
    },
    args: [rules, !!selectionOnly]
  });
}

// Install handler (context menus)
chrome.runtime.onInstalled.addListener(() => {
  try {
    chrome.contextMenus.create({
      id: 'pa_copy_page',
      title: 'Anonymize & Copy Page',
      contexts: ['page']
    });
  } catch (e) {}
  try {
    chrome.contextMenus.create({
      id: 'pa_copy_selection',
      title: 'Anonymize & Copy Selection',
      contexts: ['selection']
    });
  } catch (e) {}
});

// Context menu actions
chrome.contextMenus.onClicked.addListener(async (info) => {
  if (info.menuItemId === 'pa_copy_page') await anonymizeAndCopy(false);
  if (info.menuItemId === 'pa_copy_selection') await anonymizeAndCopy(true);
});

// Toolbar click (note: if popup is set, this may not fire in some UIs)
chrome.action.onClicked.addListener(async () => {
  await toggleForActiveTab();
});

// Keyboard shortcuts
chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'toggle-site') await toggleForActiveTab();
  if (command === 'copy-page') await anonymizeAndCopy(false);
});

// Re-enable on navigation complete (for enabled origins)
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete' || !tab || !tab.url) return;
  const enabled = await isOriginEnabled(tab.url);
  if (enabled) {
    await injectContent(tabId);
    await sendMessageToTab(tabId, { type: 'PA_ENABLE' });
  }
});

// Messages from popup
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.type === 'PA_TOGGLE_ACTIVE') {
    toggleForActiveTab().then(() => sendResponse({ ok: true })).catch(() => sendResponse({ ok: false }));
    return true;
  }
  if (msg && msg.type === 'PA_GET_STATE') {
    (async () => {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const tab = tabs && tabs[0];
      const enabled = tab && tab.url ? await isOriginEnabled(tab.url) : false;
      sendResponse({ enabled: !!enabled });
    })();
    return true;
  }
  if (msg && msg.type === 'PA_COPY') {
    anonymizeAndCopy(!!msg.selectionOnly).then(() => sendResponse({ ok: true })).catch(() => sendResponse({ ok: false }));
    return true;
  }
  return false;
});
