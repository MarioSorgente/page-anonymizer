const tableBody = document.querySelector('#rulesTable tbody');
const pattern = document.getElementById('pattern').value.trim();
const replacement = document.getElementById('replacement').value;
const wholeWord = document.getElementById('wholeWord').checked;
const caseSensitive = document.getElementById('caseSensitive').checked;
const isRegex = document.getElementById('isRegex').checked;
if (!pattern) return;
const data = await chrome.storage.local.get({ rules: [] });
const rules = data.rules || [];
rules.push({ pattern, replacement, wholeWord, caseSensitive, isRegex });
await chrome.storage.local.set({ rules });
(e.target).reset();
document.getElementById('wholeWord').checked = true;
load();
});


// Export
document.getElementById('exportBtn').addEventListener('click', async () => {
const { rules } = await chrome.storage.local.get({ rules: [] });
const blob = new Blob([JSON.stringify({ rules }, null, 2)], { type: 'application/json' });
const url = URL.createObjectURL(blob);
const a = document.createElement('a');
a.href = url;
a.download = 'page-anonymizer-rules.json';
document.body.appendChild(a);
a.click();
a.remove();
URL.revokeObjectURL(url);
});


// Import
document.getElementById('importFile').addEventListener('change', async (e) => {
const file = e.target.files[0];
if (!file) return;
const text = await file.text();
try {
const json = JSON.parse(text);
if (Array.isArray(json.rules)) {
await chrome.storage.local.set({ rules: json.rules });
load();
} else {
alert('Invalid JSON: expected { "rules": [...] }');
}
} catch (err) {
alert('Invalid JSON file.');
} finally {
e.target.value = '';
}
});


load();
