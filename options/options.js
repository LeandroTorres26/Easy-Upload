'use strict';

const DEFAULTS = { downloadsLimit: 8, clipboardEnabled: true, excludedSites: [], maxFileMB: 100, debug: false };
const $ = (id) => document.getElementById(id);

// ---------- Configurações ----------

async function load() {
  const s = await chrome.storage.sync.get(DEFAULTS);
  $('downloadsLimit').value = s.downloadsLimit;
  $('clipboardEnabled').checked = s.clipboardEnabled;
  $('debug').checked = s.debug;
  $('maxFileMB').value = s.maxFileMB;
  $('excludedSites').value = s.excludedSites.join('\n');
}

let savedTimer;
async function save() {
  const clamp = (v, min, max, def) => {
    const n = Math.round(Number(v));
    return Number.isFinite(n) ? Math.min(Math.max(n, min), max) : def;
  };
  await chrome.storage.sync.set({
    downloadsLimit: clamp($('downloadsLimit').value, 1, 30, DEFAULTS.downloadsLimit),
    clipboardEnabled: $('clipboardEnabled').checked,
    debug: $('debug').checked,
    maxFileMB: clamp($('maxFileMB').value, 1, 2000, DEFAULTS.maxFileMB),
    excludedSites: $('excludedSites')
      .value.split('\n')
      .map((s) => s.trim())
      .filter(Boolean),
  });
  $('saved').textContent = 'Salvo.';
  clearTimeout(savedTimer);
  savedTimer = setTimeout(() => ($('saved').textContent = ''), 1500);
}

for (const id of ['downloadsLimit', 'clipboardEnabled', 'maxFileMB', 'excludedSites', 'debug']) {
  $(id).addEventListener('change', save);
}

// ---------- Acesso a file URLs ----------

async function checkFileAccess() {
  const el = $('fileAccess');
  const allowed = await chrome.extension.isAllowedFileSchemeAccess();
  el.textContent = allowed ? 'Ativado: os downloads podem ser anexados.' : 'Desativado: os downloads aparecem, mas não podem ser anexados.';
  el.className = `status ${allowed ? 'ok' : 'bad'}`;
}

$('openExtensions').addEventListener('click', () => {
  chrome.tabs.create({ url: `chrome://extensions/?id=${chrome.runtime.id}` });
});

// Reconfere ao voltar da página de detalhes da extensão.
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) checkFileAccess();
});

load();
checkFileAccess();
