// Service worker: só metadados e orquestração. Nunca trafega bytes de arquivo
// (isso vai direto entre content script e offscreen document via Port).
'use strict';

const OFFSCREEN_PATH = 'offscreen.html';
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
      // Corrida entre duas chamadas: se o documento já existe, está tudo certo.
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

async function listDownloads(limit) {
  // Busca mais itens do que o necessário: alguns podem não existir mais no
  // disco (o campo `exists` do Chrome pode estar desatualizado) e são
  // descartados depois pela checagem do offscreen.
  const results = await chrome.downloads.search({
    orderBy: ['-startTime'],
    state: 'complete',
    exists: true,
    limit: Math.max(limit * 3, 20),
  });

  const items = [];
  for (const d of results) {
    if (!d.filename || d.exists === false) continue;
    items.push({
      id: d.id,
      path: d.filename,
      name: basename(d.filename),
      mime: d.mime || '',
      size: d.fileSize > 0 ? d.fileSize : d.totalBytes > 0 ? d.totalBytes : 0,
      time: d.endTime || d.startTime,
      icon: null,
    });
    if (items.length >= limit * 2) break;
  }

  await Promise.all(
    items.map(async (item) => {
      try {
        item.icon = await chrome.downloads.getFileIcon(item.id, { size: 32 });
      } catch {
        // sem ícone, a UI usa um glifo genérico
      }
    })
  );
  return items;
}

// Repassa para um frame específico da aba de origem (tabs.sendMessage não exige a permissão "tabs").
function toFrame(sender, frameId, message) {
  if (!sender.tab) throw new Error('Mensagem fora de uma aba.');
  return chrome.tabs.sendMessage(sender.tab.id, message, { frameId });
}

async function handle(msg, sender) {
  switch (msg.type) {
    // Iframe pequeno pede para o frame principal mostrar o popup.
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
    // Frame principal devolve a escolha (ou o pedido de seletor nativo) ao iframe de origem.
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
      return { ok: true, items: await listDownloads(Math.min(Math.max(msg.limit | 0, 1), 30)) };
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

// Quando a extensão é instalada ou recarregada, as abas já abertas ficam com um
// content script órfão (sem acesso às APIs) até serem recarregadas. Isso afeta
// justamente abas que ficam abertas o tempo todo, como WhatsApp e redes sociais.
// Reinjeta os mesmos scripts do manifest; a nova instância desliga a antiga.
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
        .catch(() => {}); // páginas protegidas, Web Store, etc.
    }
  }
}

chrome.runtime.onInstalled.addListener(({ reason }) => {
  ensureOffscreen().catch(() => {}); // pré-aquece para o primeiro popup abrir mais rápido
  if (reason === 'install' || reason === 'update') injectIntoOpenTabs().catch(() => {});
});
chrome.runtime.onStartup.addListener(() => ensureOffscreen().catch(() => {}));
