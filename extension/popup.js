// ===== DataMask — Popup (guard for chrome:// pages + number-aware matching) =====

const el = (id) => document.getElementById(id);
const $status = el('status');
const $list = el('rulesList');
const $empty = el('emptyRules');

function setStatus(msg) {
  $status.textContent = msg || '';
  if (msg) setTimeout(() => { $status.textContent = ''; }, 1800);
}
function pill(text) { return `<span class="pill">${text}</span>`; }
function esc(s='') { return s.replace(/[&<>\"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

// ---- active tab + restricted check
async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab || null;
}
function isRestrictedUrl(url = '') {
  return /^(chrome|chrome-extension|edge|devtools|about|view-source):/i.test(url);
}

async function loadRules() {
  const { rules } = await chrome.storage.local.get({ rules: [] });
  const arr = Array.isArray(rules) ? rules : [];
  if (arr.length === 0) {
    $empty.style.display = 'block';
    $list.innerHTML = '';
  } else {
    $empty.style.display = 'none';
    $list.innerHTML = arr.map((r, idx) => {
      const flags = [r.wholeWord ? 'word' : null, r.caseSensitive ? 'case' : null]
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

// Unique-by-pattern (case-insensitive)
function hasPattern(rules, pattern) {
  const key = String(pattern).trim().toLowerCase();
  return (rules || []).some(r => String(r.pattern || '').trim().toLowerCase() === key);
}

async function addRule(e) {
  e.preventDefault();
  const pattern = el('pattern').value.trim();
  const replacement = el('replacement').value;
  const wholeWord = el('wholeWord').checked;
  const caseSensitive = el('caseSensitive').checked;
  if (!pattern) return;

  const data = await chrome.storage.local.get({ rules: [] });
  const rules = data.rules || [];

  if (hasPattern(rules, pattern)) {
    setStatus(`Rule exists: “${pattern}”. Delete it to change.`);
    const btn = e.target.querySelector('.btn.add');
    if (btn) { btn.animate([{ transform: 'translateX(0)' }, { transform: 'translateX(-3px)' }, { transform: 'translateX(3px)' }, { transform: 'translateX(0)' }], { duration: 180, iterations: 1 }); }
    return;
  }

  rules.push({ pattern, replacement, wholeWord, caseSensitive });
  await chrome.storage.local.set({ rules });

  el('addForm').reset();
  el('wholeWord').checked = true;
  await loadRules();
  setStatus('Rule added.');
}

// ===== Number-aware regex builder (thousands + decimals) =====
function pageFuncFactory() {
  return (rulesArg, selectionOnlyArg) => {
    function escapeRegExp(str) { return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
    const SEP_CLASS = "[\\s,\\.\\u00A0\\u202F\\u2009\\u2007'’]"; // spaces, comma, dot, apostrophe
    function isDigit(ch) { return ch >= '0' && ch <= '9'; }
    function isPatSep(ch) { return /[,\.\u00A0\u202F\u2009\u2007'’\s]/.test(ch); }
    function flexibleDigits(digits) { return digits.split('').join(`(?:${SEP_CLASS})?`); }

    function parseNumberToken(pat, i) {
      let intDigits = '', fracDigits = null;
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
      const decimalPart = (fracDigits !== null) ? `(?:[.,]${fracDigits})` : `(?:[.,]\\d{1,2})?`;
      return { regexSrc: `${intFlex}${decimalPart}`, nextIndex: i };
    }

    function buildFlexibleBase(pat) {
      let out = '';
      for (let i = 0; i < pat.length; ) {
        const ch = pat[i];
        if (isDigit(ch)) { const t = parseNumberToken(pat, i); out += t.regexSrc; i = t.nextIndex; }
        else { out += escapeRegExp(ch); i++; }
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
    const src = selectionOnlyArg ? sel : (document.body ? (document.body.innerText || '') : '');
    return applyAll(src, rulesArg || []);
  };
}

async function copySanitized(selectionOnly) {
  const tab = await activeTab();
  if (!tab) { setStatus('No active tab.'); return; }
  if (isRestrictedUrl(tab.url)) {
    setStatus('Cannot run on chrome:// or internal pages. Open a normal website.');
    return;
  }

  const { rules } = await chrome.storage.local.get({ rules: [] });

  let results;
  try {
    results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: pageFuncFactory(),
      args: [Array.isArray(rules) ? rules : [], !!selectionOnly]
    });
  } catch (err) {
    console.error(err);
    setStatus('Cannot access this page. Try another tab.');
    return;
  }

  const sanitized = (results && results[0] && results[0].result) || '';
  if (selectionOnly && !sanitized.trim()) { setStatus('No selection found.'); return; }

  try {
    await navigator.clipboard.writeText(sanitized);
    setStatus(selectionOnly ? 'Selection copied (anonymized).' : 'Page copied (anonymized).');
  } catch {
    // Fallback
    try {
      const ta = document.createElement('textarea');
      ta.value = sanitized;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
      setStatus(selectionOnly ? 'Selection copied (anonymized).' : 'Page copied (anonymized).');
    } catch {
      setStatus('Clipboard blocked by this page.');
    }
  }
}

// Events
el('addForm').addEventListener('submit', addRule);
document.getElementById('copyPage').addEventListener('click', () => copySanitized(false));
document.getElementById('copySel').addEventListener('click', () => copySanitized(true));

// Init
loadRules();
