// ===== Page Anonymizer — Popup (v0.2.0) =====

const el = (id) => document.getElementById(id);
const $status = el('status');
const $toggle = el('toggle');
const $list = el('rulesList');
const $empty = el('emptyRules');

function send(msg) { return chrome.runtime.sendMessage(msg); }

function setStatus(msg) {
  $status.textContent = msg || '';
  if (msg) setTimeout(() => { $status.textContent = ''; }, 1500);
}

function pill(text) { return `<span class="pill">${text}</span>`; }

function ruleItem(r, idx) {
  const flags = [
    r.wholeWord ? 'word' : null,
    r.caseSensitive ? 'case' : null,
    r.isRegex ? 'regex' : null
  ].filter(Boolean).map(pill).join('');
  const esc = (s='') => s.replace(/[&<>\"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  return `
    <li class="rule">
      <div class="meta">
        <div><code>${esc(r.pattern)}</code> → <code>${esc(r.replacement)}</code></div>
        <div class="pills">${flags}</div>
      </div>
      <button class="delete" data-del="${idx}">Delete</button>
    </li>
  `;
}

async function loadRules() {
  const { rules } = await chrome.storage.local.get({ rules: [] });
  const arr = Array.isArray(rules) ? rules : [];
  if (arr.length === 0) {
    $empty.style.display = 'block';
    $list.innerHTML = '';
  } else {
    $empty.style.display = 'none';
    $list.innerHTML = arr.map(ruleItem).join('');
  }
  // Bind deletes
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

async function refreshState() {
  const res = await send({ type: 'PA_GET_STATE' });
  $toggle.checked = !!res?.enabled;
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

async function toggleSite() {
  // Request toggle and trust the new state returned by SW to prevent “bounce”
  const res = await send({ type: 'PA_TOGGLE_ACTIVE' });
  $toggle.checked = !!res?.enabled;
  setStatus(res?.enabled ? 'Enabled on this site.' : 'Disabled on this site.');
}

async function copyPage(selectionOnly) {
  await send({ type: 'PA_COPY', selectionOnly: !!selectionOnly });
  setStatus(selectionOnly ? 'Selection copied (anonymized).' : 'Page copied (anonymized).');
}

// Events
el('addForm').addEventListener('submit', addRule);
$toggle.addEventListener('change', toggleSite);
el('copyPage').addEventListener('click', () => copyPage(false));
el('copySel').addEventListener('click', () => copyPage(true));
el('openOptions').addEventListener('click', () => chrome.runtime.openOptionsPage());

// Init
loadRules();
refreshState();
