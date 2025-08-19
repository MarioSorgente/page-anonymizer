// Page Anonymizer – background service worker (MV3)
const sanitized = applyAll(text, rules || []);
navigator.clipboard.writeText(sanitized).catch(() => {});
}
args: [rules, selectionOnly]
});
}


chrome.runtime.onInstalled.addListener(async () => {
// Context menus
chrome.contextMenus.create({ id: 'pa_copy_page', title: 'Anonymize & Copy Page', contexts: ['page'] });
chrome.contextMenus.create({ id: 'pa_copy_selection', title: 'Anonymize & Copy Selection', contexts: ['selection'] });
});


chrome.contextMenus.onClicked.addListener(async (info) => {
if (info.menuItemId === 'pa_copy_page') {
await anonymizeAndCopy(false);
}
if (info.menuItemId === 'pa_copy_selection') {
await anonymizeAndCopy(true);
}
});


chrome.action.onClicked.addListener(async () => {
// Clicking the toolbar icon toggles current site if you prefer (popup also available)
await toggleForActiveTab();
});


chrome.commands.onCommand.addListener(async (command) => {
if (command === 'toggle-site') return toggleForActiveTab();
if (command === 'copy-page') return anonymizeAndCopy(false);
});


chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
if (changeInfo.status !== 'complete' || !tab.url) return;
const enabled = await isOriginEnabled(tab.url);
if (enabled) {
await injectContent(tabId);
await sendMessageToTab(tabId, { type: 'PA_ENABLE' });
}
});


// Messages from popup
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
if (msg?.type === 'PA_TOGGLE_ACTIVE') {
toggleForActiveTab().then(() => sendResponse({ ok: true })).catch(() => sendResponse({ ok: false }));
return true;
}
if (msg?.type === 'PA_GET_STATE') {
(async () => {
const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
const enabled = tab?.url ? await isOriginEnabled(tab.url) : false;
sendResponse({ enabled });
})();
return true;
}
if (msg?.type === 'PA_COPY') {
anonymizeAndCopy(Boolean(msg.selectionOnly)).then(() => sendResponse({ ok: true })).catch(() => sendResponse({ ok: false }));
return true;
}
});
