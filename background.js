// Service worker: metadados e orquestração. Os bytes dos arquivos não passam por
// aqui; vão direto do offscreen para o content script.
'use strict';

importScripts('content/accept.js');

const OFFSCREEN_PATH = 'offscreen.html';
const HISTORY_SCAN = 300;
let creatingOffscreen = null;

async function hasOffscreen() {
  if (chrome.offscreen.hasDocument) return chrome.offscreen.hasDocument();
  const contexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
  return contexts.length > 0;
}

async function ensureOffscreen() {
  if (await hasOffscreen()) return;
  creatingOffscreen ??= chrome.offscreen
    .createDocument({
      url: OFFSCREEN_PATH,
      reasons: ['CLIPBOARD', 'BLOBS'],
      justification: 'Ler o clipboard e os arquivos baixados para oferecê-los em campos de upload.',
    })
    .catch(async (err) => {
      // Duas chamadas simultâneas: a segunda falha, mas o documento existe.
      if (!(await hasOffscreen())) throw err;
    })
    .finally(() => {
      creatingOffscreen = null;
    });
  await creatingOffscreen;
}

function getFileAccess() {
  return new Promise((resolve) => {
    try {
      if (!chrome.extension?.isAllowedFileSchemeAccess) return resolve(null);
      chrome.extension.isAllowedFileSchemeAccess((allowed) => resolve(!!allowed));
    } catch {
      resolve(null);
    }
  });
}

function basename(path) {
  return path.split(/[\\/]/).pop() || path;
}

// Downloads compatíveis com `accept`, do mais recente ao mais antigo. Quais ainda
// existem no disco é verificado depois pelo content script, via offscreen.
async function listDownloads(accept) {
  const tokens = EasyUploadAccept.parse(accept);
  const results = await chrome.downloads.search({
    orderBy: ['-startTime'],
    state: 'complete',
    exists: true,
    limit: HISTORY_SCAN,
  });

  const items = [];
  for (const d of results) {
    if (!d.filename || d.exists === false) continue;
    const name = basename(d.filename);
    if (!EasyUploadAccept.matches(tokens, name, d.mime)) continue;
    items.push({
      id: d.id,
      path: d.filename,
      name,
      mime: d.mime || '',
      size: d.fileSize > 0 ? d.fileSize : d.totalBytes > 0 ? d.totalBytes : 0,
      time: d.endTime || d.startTime,
    });
  }
  return { items, scanned: results.length };
}

async function getIcons(ids) {
  const icons = {};
  await Promise.all(
    ids.map(async (id) => {
      try {
        icons[id] = await chrome.downloads.getFileIcon(id, { size: 32 });
      } catch {}
    })
  );
  return icons;
}

function toFrame(sender, frameId, message) {
  if (!sender.tab) throw new Error('Mensagem fora de uma aba.');
  return chrome.tabs.sendMessage(sender.tab.id, message, { frameId });
}

async function handle(msg, sender) {
  switch (msg.type) {
    // Iframes pequenos: o popup abre no frame principal e a escolha volta ao iframe.
    case 'openInTop':
      await toFrame(sender, 0, {
        type: 'eu:openRemote',
        frameId: sender.frameId,
        requestId: msg.requestId,
        accept: msg.accept,
        multiple: msg.multiple,
      });
      return { ok: true };
    case 'closeTop':
      await toFrame(sender, 0, { type: 'eu:close', requestId: msg.requestId }).catch(() => {});
      return { ok: true };
    case 'frameCommand': {
      const res = await toFrame(sender, msg.frameId, {
        type: 'eu:command',
        requestId: msg.requestId,
        cmd: msg.cmd,
        items: msg.items,
      });
      if (!res) throw new Error('O frame do campo de upload não respondeu.');
      if (res.error) throw new Error(res.error);
      return res;
    }
    case 'prepare':
      await ensureOffscreen();
      return { ok: true, fileAccess: await getFileAccess() };
    case 'downloads':
      return { ok: true, ...(await listDownloads(msg.accept)) };
    case 'icons':
      return { ok: true, icons: await getIcons((msg.ids || []).slice(0, 50)) };
    case 'openOptions':
      await chrome.runtime.openOptionsPage();
      return { ok: true };
    case 'openExtensionsPage':
      await chrome.tabs.create({ url: `chrome://extensions/?id=${chrome.runtime.id}` });
      return { ok: true };
    default:
      throw new Error(`Mensagem desconhecida: ${msg.type}`);
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.target !== 'sw') return false;
  handle(msg, sender).then(sendResponse, (err) => sendResponse({ error: String(err?.message || err) }));
  return true;
});

// Ao instalar ou recarregar a extensão, os content scripts das abas abertas ficam
// órfãos até a aba ser recarregada. Reinjeta; a nova instância desliga a antiga.
async function injectIntoOpenTabs() {
  const scripts = chrome.runtime.getManifest().content_scripts;
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (!tab.id || tab.discarded || !/^(https?|file):/.test(tab.url || '')) continue;
    for (const cs of scripts) {
      chrome.scripting
        .executeScript({
          target: { tabId: tab.id, allFrames: true },
          files: cs.js,
          world: cs.world || 'ISOLATED',
          injectImmediately: true,
        })
        .catch(() => {}); // páginas onde extensões não podem rodar
    }
  }
}

chrome.runtime.onInstalled.addListener(({ reason }) => {
  ensureOffscreen().catch(() => {});
  if (reason === 'install' || reason === 'update') injectIntoOpenTabs().catch(() => {});
});
chrome.runtime.onStartup.addListener(() => ensureOffscreen().catch(() => {}));
