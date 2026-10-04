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

// ---------- Diagnóstico ----------

function show(report) {
  const out = $('diagOutput');
  out.hidden = false;
  out.textContent = JSON.stringify(report, null, 2);
}

$('diagOffscreen').addEventListener('click', async () => {
  try {
    const prep = await chrome.runtime.sendMessage({ target: 'sw', type: 'prepare' });
    if (!prep?.ok) throw new Error(prep?.error || 'Falha ao preparar o offscreen.');
    const port = chrome.runtime.connect({ name: 'easyupload-data' });
    const report = await new Promise((resolve, reject) => {
      port.onMessage.addListener((m) => (m.error ? reject(new Error(m.error)) : resolve(m.report)));
      port.onDisconnect.addListener(() => reject(new Error(chrome.runtime.lastError?.message || 'Desconectado.')));
      port.postMessage({ id: 1, op: 'diagnose' });
    });
    port.disconnect();
    show(report);
  } catch (err) {
    show({ erro: err.message });
  }
});

$('diagLocal').addEventListener('click', async () => {
  const report = { context: 'options (página com foco)' };

  const target = $('paste-target');
  let captured = null;
  const onPaste = (e) => {
    e.preventDefault();
    const dt = e.clipboardData;
    captured = {
      types: [...dt.types],
      items: [...dt.items].map((i) => ({ kind: i.kind, type: i.type })),
      files: [...dt.files].map((f) => ({ name: f.name, type: f.type, size: f.size })),
    };
  };
  target.addEventListener('paste', onPaste);
  target.focus();
  report.execCommandPaste = document.execCommand('paste');
  target.removeEventListener('paste', onPaste);
  target.textContent = '';
  report.pasteEvent = captured || 'não disparou';

  try {
    const entries = await navigator.clipboard.read();
    report.asyncClipboardRead = entries.map((e) => e.types);
  } catch (err) {
    report.asyncClipboardRead = `erro: ${err.name}: ${err.message}`;
  }
  show(report);
});

load();
checkFileAccess();
