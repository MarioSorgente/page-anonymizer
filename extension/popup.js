// ===== Page Anonymizer — Popup (v0.3.0) =====
// All critical actions are handled here (popup has the user gesture).
const el = (id) => document.getElementById(id);
const $status = el('status');
const $toggle = el('toggle');
const $list = el('rulesList');
const $empty = el('emptyRules');

function setStatus(msg) {
  $status.textContent = msg || '';
  if (msg) setTimeout(() => { $status.textContent = ''; }, 1500);
}

function pill(text) { return `<span class="pill">${text}</span>`; }
function esc(s='') { return s.replace(/[&<>\"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs?.[0] || null;
}
function originFromUrl(url) { try { return new URL(url).origin; } catch { return null; } }

async function loadRules() {
  const { rules } = await chrome.storage.local.get({ rules: [] });
  const arr = Array.isArray(rules) ? rules : [];
  if (arr.length === 0) {
    $empty.style.display = 'block';
    $list.innerHTML = '';
  } else {
    $empty.style.display = 'none';
    $list.innerHTML = arr.map((r, idx) => {
      const flags = [r.wholeWord ? 'word' : null, r.caseSensitive ? 'case' : null, r.isRegex ? 'regex' : null]
        .filter(Boolean).map(pill).join('');
      return `
        <li class="rule">
          <div class="meta">
            <div><code>${esc(r.pattern)}</code> → <code>${esc(r.replacement)}</code></div>
            <div class="pills">${flags}</div>
          </div>
          <button class="delete" data-del="${idx}">Delete</button>
        </li>`;
    }).join('');
    // bind deletes
    $list.querySelectorAll('button[data-del]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const idx = Number(btn.dataset.del);
        const data = await chrome.storage.local.get({ rules: [] });
        const rs = data.rules || [];
        rs.splice(idx, 1);
        await chrome.storage.local.set({ rules: rs });
        await loadRules();
        setStatus('Rule deleted.');
      });
    });
  }
}

async function refreshToggle() {
  const tab = await getActiveTab();
  const origin = tab?.url ? originFromUrl(tab.url) : null;
  if (!origin) { $toggle.checked = false; return; }
  const { enabledOrigins } = await chrome.storage.local.get({ enabledOrigins: {} });
  $toggle.checked = !!enabledOrigins[origin];
}

async function addRule(e) {
  e.preventDefault();
  const pattern = el('pattern').value.trim();
  const replacement = el('replacement').value;
  const wholeWord = el('wholeWord').checked;
  const caseSensitive = el('caseSensitive').checked;
  const isRegex = el('isRegex').checked;
  if (!pattern) return;

  const data = await chrome.storage.local.get({ rules: [] });
  const rules = data.rules || [];
  rules.push({ pattern, replacement, wholeWord, caseSensitive, isRegex });
  await chrome.storage.local.set({ rules });

  el('addForm').reset();
  el('wholeWord').checked = true;
  await loadRules();
  setStatus('Rule added.');
}

// Inject content script if not present
async function ensureContent(tabId) {
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
  } catch { /* ignore */ }
}

async function toggleSite() {
  const tab = await getActiveTab();
  const origin = tab?.url ? originFromUrl(tab.url) : null;
  if (!tab || !origin) { $toggle.checked = false; return; }

  const data = await chrome.storage.local.get({ enabledOrigins: {} });
  const map = data.enabledOrigins || {};
  const currently = !!map[origin];

  if (currently) {
    // disable
    delete map[origin];
    await chrome.storage.local.set({ enabledOrigins: map });
    try { await chrome.tabs.sendMessage(tab.id, { type: 'PA_DISABLE' }); } catch {}
    try { await chrome.permissions.remove({ origins: [origin + '/*'] }); } catch {}
    $toggle.checked = false;
    setStatus('Disabled on this site.');
  } else {
    // request permission, then enable
    const granted = await chrome.permissions.request({ origins: [origin + '/*'] }).catch(() => false);
    if (!granted) { $toggle.checked = false; return; }
    map[origin] = true;
    await chrome.storage.local.set({ enabledOrigins: map });
    await ensureContent(tab.id);
    try { await chrome.tabs.sendMessage(tab.id, { type: 'PA_ENABLE' }); } catch {}
    $toggle.checked = true;
    setStatus('Enabled on this site.');
  }
}

async function anonymizeAndCopyPage() {
  // 1) Get rules in popup (has user gesture)
  const { rules } = await chrome.storage.local.get({ rules: [] });
  const tab = await getActiveTab();
  if (!tab) return;

  // 2) Ask the page to return sanitized text (NOT copying there)
  const results = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: (rulesArg) => {
      function escapeRegExp(str) { return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
      function buildRegex(rule) {
        const base = rule.isRegex ? rule.pattern : escapeRegExp(rule.pattern);
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
      const text = document.body ? (document.body.innerText || '') : '';
      return applyAll(text, rulesArg || []);
    },
    args: [Array.isArray(rules) ? rules : []]
  });

  const sanitized = results?.[0]?.result ?? '';
  // 3) Copy FROM THE POPUP (clipboardWrite + user gesture = ✅)
  try {
    await navigator.clipboard.writeText(sanitized);
    setStatus('Page copied (anonymized).');
  } catch {
    // Fallback: temporary textarea
    const ta = document.createElement('textarea');
    ta.value = sanitized;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
    setStatus('Page copied (anonymized).');
  }
}

// Events
el('addForm').addEventListener('submit', addRule);
$toggle.addEventListener('change', toggleSite);
el('copyPage').addEventListener('click', anonymizeAndCopyPage);
el('openOptions').addEventListener('click', () => chrome.runtime.openOptionsPage());

// Init
loadRules();
refreshToggle();
