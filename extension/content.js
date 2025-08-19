// Page Anonymizer – content script
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
if (observer) observer.disconnect();
observer = null;
clearAnonymization(document.body);
}


chrome.runtime.onMessage.addListener((msg) => {
if (msg?.type === 'PA_ENABLE') enable();
if (msg?.type === 'PA_DISABLE') disable();
});


// Also react to rule updates live
chrome.storage.onChanged.addListener((changes, area) => {
if (area === 'local' && changes.rules) {
currentRules = (changes.rules.newValue || []).sort((a, b) => (b.pattern||'').length - (a.pattern||'').length);
if (enabled) {
// Re-apply: clear then apply with new rules
clearAnonymization(document.body);
walkAndReplace(document.body, currentRules);
}
}
});


// Minimal CSS injected for visual hint (tooltip already set via title)
const style = document.createElement('style');
style.textContent = `.pa-anon{background:rgba(0,0,0,0.06); border-radius:3px; padding:0 2px;}
.pa-anon:hover{filter:brightness(0.95);}`;
document.documentElement.appendChild(style);
