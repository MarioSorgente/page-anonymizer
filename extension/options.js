// ===== Page Anonymizer — Options (v0.4.0, no-regex) =====
const tableBody = document.querySelector('#rulesTable tbody');

function escapeHtml(s) {
  return String(s || '').replace(/[&<>\"']/g, c => (
    { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]
  ));
}

function rowHtml(r, idx) {
  const flags = [r.wholeWord ? 'word' : null, r.caseSensitive ? 'case' : null]
    .filter(Boolean)
    .map(f => `<span class="pill">${f}</span>`)
    .join('');
  return `<tr>
    <td><code>${escapeHtml(r.pattern)}</code></td>
    <td><code>${escapeHtml(r.replacement)}</code></td>
    <td>${flags}</td>
    <td><button data-del="${idx}">Delete</button></td>
  </tr>`;
}

async function load() {
  const { rules } = await chrome.storage.local.get({ rules: [] });
  render(Array.isArray(rules) ? rules : []);
}

function render(rules) {
  tableBody.innerHTML = rules.map(rowHtml).join('');
  tableBody.querySelectorAll('button[data-del]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const idx = Number(btn.dataset.del);
      const data = await chrome.storage.local.get({ rules: [] });
      const rs = data.rules || [];
      rs.splice(idx, 1);
      await chrome.storage.local.set({ rules: rs });
      load();
    });
  });
}

document.getElementById('addForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const pattern = document.getElementById('pattern').value.trim();
  const replacement = document.getElementById('replacement').value;
  const wholeWord = document.getElementById('wholeWord').checked;
  const caseSensitive = document.getElementById('caseSensitive').checked;
  if (!pattern) return;

  const data = await chrome.storage.local.get({ rules: [] });
  const rules = data.rules || [];
  rules.push({ pattern, replacement, wholeWord, caseSensitive });
  await chrome.storage.local.set({ rules });

  e.target.reset();
  document.getElementById('wholeWord').checked = true;
  load();
});

// ---- Export
document.getElementById('exportBtn').addEventListener('click', async () => {
  const { rules } = await chrome.storage.local.get({ rules: [] });
  const blob = new Blob([JSON.stringify({ rules: Array.isArray(rules) ? rules : [] }, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'page-anonymizer-rules.json';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
});

// ---- Import
document.getElementById('importFile').addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    const text = await file.text();
    const json = JSON.parse(text);
    if (Array.isArray(json.rules)) {
      await chrome.storage.local.set({ rules: json.rules });
      load();
    } else {
      alert('Invalid JSON: expected { "rules": [...] }');
    }
  } catch {
    alert('Invalid JSON file.');
  } finally {
    e.target.value = '';
  }
});

load();
