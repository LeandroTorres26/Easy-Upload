// ISOLATED world: decide quando interceptar, mostra o popup (Shadow DOM fechado),
// busca os dados (SW para metadados, offscreen para bytes) e preenche o input.
//
// Iframes pequenos demais para o popup delegam a UI ao frame principal:
//   - o pedido vai pelo SW (que conhece o frameId de quem pediu) até o frame 0;
//   - a posição do input sobe por uma cadeia de postMessage, em que cada frame
//     soma o deslocamento do <iframe> filho;
//   - a escolha volta pelo SW direto para o frame de origem, que lê os bytes do
//     offscreen e preenche o input.
(() => {
  'use strict';

  // Sem as APIs da extensão (script órfão durante um recarregamento, ou frames
  // especiais em que o Chrome não as expõe) não há o que fazer: o seletor nativo
  // segue funcionando normalmente. Sai antes de desligar uma instância válida.
  try {
    if (!chrome.runtime?.id || !chrome.storage?.sync) return;
  } catch {
    return;
  }

  // Se a extensão foi recarregada, a instância anterior (órfã, sem acesso às APIs)
  // continua na página. Ela é desligada aqui, e esta assume. Todos os listeners
  // ficam presos a `signal` para poderem ser removidos de uma vez.
  const TAKEOVER_EVENT = 'easyupload:takeover';
  document.dispatchEvent(new CustomEvent(TAKEOVER_EVENT));
  const lifetime = new AbortController();
  const { signal } = lifetime;
  document.addEventListener(
    TAKEOVER_EVENT,
    () => {
      closePopup('substituído por uma nova instância da extensão');
      lifetime.abort();
    },
    { signal }
  );

  const Accept = globalThis.EasyUploadAccept;
  const INTERCEPT_EVENT = 'easyupload:intercept';
  const RECT_MESSAGE = '__easyUploadRect';
  const PORT_NAME = 'easyupload-data';
  const DEFAULTS = { downloadsLimit: 8, clipboardEnabled: true, excludedSites: [], maxFileMB: 100, debug: false };
  const IS_TOP = window === window.top;
  // Frames menores que isso abrem o popup no frame principal.
  const MIN_FRAME_W = 360;
  const MIN_FRAME_H = 340;

  let settings = { ...DEFAULTS };
  let settingsReady = false;
  let bypass = false; // ligado só durante o input.click() do "Escolher do computador"
  let passThroughOnce = null; // input cujo próximo clique deve ir direto ao seletor nativo
  let lastPointer = null;
  let popup = null;
  const remoteInputs = new Map(); // (subframe) requestId -> input aguardando o popup do frame principal
  const rectWaiters = new Map(); // (frame principal) requestId -> { rect } | { resolve }
  const actions = new WeakMap(); // botão do popup -> ação

  function dbg(...args) {
    if (settings.debug) console.debug('[Easy Upload]', ...args);
  }

  // ---------- Configurações ----------

  chrome.storage.sync
    .get(DEFAULTS)
    .then((s) => (settings = s))
    .catch(() => {})
    .finally(() => {
      settingsReady = true;
      // Se nem esta linha aparece no console com o debug ligado, o script não foi injetado
      // (ex.: acesso da extensão ao site restrito em chrome://extensions).
      dbg('ativo em', location.href, IS_TOP ? '(frame principal)' : '(iframe)', isExcluded() ? '— site excluído' : '');
    });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'sync') return;
    for (const [key, { newValue }] of Object.entries(changes)) settings[key] = newValue ?? DEFAULTS[key];
  });

  function extensionAlive() {
    try {
      return !!chrome.runtime?.id; // vira undefined quando a extensão é recarregada
    } catch {
      return false;
    }
  }

  function currentHost() {
    if (location.hostname) return location.hostname.toLowerCase();
    // about:blank / srcdoc herdam a origem do pai
    try {
      return new URL(location.ancestorOrigins?.[0] || '').hostname.toLowerCase();
    } catch {
      return '';
    }
  }

  function isExcluded() {
    const host = currentHost();
    if (!host) return false;
    return (settings.excludedSites || []).some((raw) => {
      const pattern = String(raw)
        .trim()
        .toLowerCase()
        .replace(/^[a-z]+:\/\//, '')
        .replace(/^\*\./, '')
        .replace(/[/:].*$/, '');
      return pattern && (host === pattern || host.endsWith(`.${pattern}`));
    });
  }

  function ineligibleReason(input) {
    if (input.disabled) return 'input desabilitado';
    if (input.webkitdirectory) return 'seleção de pasta (webkitdirectory)';
    if (!settingsReady) return 'configurações ainda não carregadas';
    if (!extensionAlive()) return 'extensão foi recarregada; recarregue a página';
    if (isExcluded()) return 'site excluído nas opções';
    if (!navigator.userActivation?.isActive) return 'sem user activation (o navegador também não abriria o seletor)';
    return '';
  }

  // ---------- Interceptação ----------

  function tryIntercept(input, via) {
    if (bypass || input?.localName !== 'input' || input.type !== 'file') return false;
    if (input === passThroughOnce) {
      passThroughOnce = null;
      dbg(via, '→ liberado para o seletor nativo', input);
      return false;
    }
    const reason = ineligibleReason(input);
    if (reason) {
      dbg(via, '→ não interceptado:', reason, input);
      return false;
    }
    dbg(via, '→ interceptado', input);
    try {
      showFor(input);
    } catch (err) {
      // Na dúvida, deixa o seletor nativo abrir em vez de engolir o clique.
      console.error('[Easy Upload] erro ao abrir o popup; usando o seletor nativo:', err);
      return false;
    }
    return true;
  }

  // Cliques reais (e os sintéticos gerados por <label for>) em inputs conectados.
  window.addEventListener(
    'click',
    (e) => {
      if (tryIntercept(e.composedPath()[0], 'clique no input')) e.preventDefault(); // cancela o seletor nativo
    },
    { capture: true, signal }
  );

  // input.click() / input.showPicker() vindos do script da página (via main-world.js).
  window.addEventListener(
    INTERCEPT_EVENT,
    (e) => {
      const via = e.detail === 2 ? 'input.showPicker()' : 'input.click()';
      if (!e.relatedTarget) return dbg(via, '→ evento do MAIN world chegou sem o input');
      if (tryIntercept(e.relatedTarget, via)) e.preventDefault(); // avisa o MAIN world para não chamar o original
    },
    { capture: true, signal }
  );

  window.addEventListener(
    'pointerdown',
    (e) => {
      lastPointer = { x: e.clientX, y: e.clientY };
      if (popup && e.composedPath()[0] !== popup.host) closePopup('clique fora');
      closeRemotePopup();
    },
    { capture: true, signal }
  );

  window.addEventListener(
    'keydown',
    (e) => {
      if (e.key !== 'Escape') return;
      if (popup) {
        e.preventDefault();
        e.stopImmediatePropagation(); // evita que um modal da página feche junto
        closePopup('Esc');
      }
      closeRemotePopup();
    },
    { capture: true, signal }
  );

  window.addEventListener('scroll', () => popup?.reposition(), { capture: true, passive: true, signal });
  window.addEventListener('resize', () => popup?.reposition(), { passive: true, signal });

  // O popup é invisível para a página. Os eventos dele param aqui, na captura
  // do window, antes de qualquer handler da página (este listener é registrado
  // em document_start, então é o primeiro). Sem isso, menus e modais que fecham
  // ao "clicar fora" (WhatsApp, X…) se fecham e desmontam o input antes de ele
  // ser preenchido. Como o evento não chega aos botões, as ações são disparadas
  // daqui mesmo.
  for (const type of [
    'pointerdown', 'pointerup', 'mousedown', 'mouseup', 'click', 'dblclick',
    'auxclick', 'contextmenu', 'touchstart', 'touchend', 'wheel',
  ]) {
    window.addEventListener(
      type,
      (e) => {
        if (!popup || e.composedPath()[0] !== popup.host) return;
        e.stopImmediatePropagation();
        if (type === 'mousedown') e.preventDefault(); // não tira o foco do elemento atual da página
        if (type === 'click') popup.activate(e);
      },
      { capture: true, passive: false, signal }
    );
  }

  function openNativePicker(input) {
    bypass = true;
    try {
      // O protótipo deste world não tem o patch do MAIN world, e a flag faz o
      // listener de captura acima deixar o clique passar.
      input.click();
    } finally {
      bypass = false;
    }
  }

  function fillInput(input, files) {
    if (!input.isConnected) dbg('aviso: o input não está no DOM; a página pode não perceber a mudança', input);
    const dt = new DataTransfer();
    for (const file of files) dt.items.add(file);
    input.files = dt.files;
    input.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    dbg('preenchido com', files.map((f) => f.name), input);
  }

  // ---------- Comunicação ----------

  async function sendToSW(msg) {
    const res = await chrome.runtime.sendMessage({ target: 'sw', ...msg });
    if (!res || res.error) throw new Error(res?.error || 'Sem resposta do service worker.');
    return res;
  }

  function b64ToBytes(b64) {
    if (Uint8Array.fromBase64) return Uint8Array.fromBase64(b64);
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  // Port direto com o offscreen document (o SW não participa do tráfego de bytes).
  const dataPort = (() => {
    let port = null;
    let seq = 0;
    const pending = new Map();

    function connect() {
      port = chrome.runtime.connect({ name: PORT_NAME });
      port.onMessage.addListener(onMessage);
      port.onDisconnect.addListener(() => {
        void chrome.runtime.lastError;
        port = null;
        for (const p of pending.values()) p.reject(new Error('Conexão com a extensão perdida.'));
        pending.clear();
      });
    }

    function onMessage(msg) {
      const p = pending.get(msg.id);
      if (!p) return;
      if (msg.chunk !== undefined) {
        p.chunks.push(b64ToBytes(msg.chunk));
        return;
      }
      pending.delete(msg.id);
      if (msg.error) p.reject(new Error(msg.error));
      else p.resolve(p.chunks ? { ...msg, chunks: p.chunks } : msg);
    }

    function request(msg, { stream = false } = {}) {
      if (!port) connect();
      const id = ++seq;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject, chunks: stream ? [] : null });
        port.postMessage({ ...msg, id });
      });
    }

    return { request };
  })();

  function maxBytes() {
    return (Number(settings.maxFileMB) || DEFAULTS.maxFileMB) * 1024 * 1024;
  }

  async function loadFiles(items) {
    const files = [];
    for (const item of items) {
      const res = await dataPort.request(
        item.source === 'clipboard'
          ? { op: 'read', source: 'clipboard', key: item.key, maxBytes: maxBytes() }
          : { op: 'read', source: 'download', path: item.path, maxBytes: maxBytes() },
        { stream: true }
      );
      files.push(new File(res.chunks, item.name, { type: item.type, lastModified: item.lastModified }));
    }
    return files;
  }

  // ---------- Alvos do popup ----------
  // O popup só conhece esta interface; não sabe se o input está neste frame ou num iframe.

  function localTarget(input) {
    return {
      accept: input.accept,
      multiple: input.multiple,
      anchorRect: () => anchorRect(input),
      container: () => pickContainer(input),
      async deliver(items) {
        fillInput(input, await loadFiles(items));
      },
      // Síncrono até o input.click(), para aproveitar a user activation do clique no botão.
      async openNative() {
        openNativePicker(input);
        return {};
      },
    };
  }

  function remoteTarget(req) {
    const command = (cmd, extra = {}) =>
      sendToSW({ type: 'frameCommand', frameId: req.frameId, requestId: req.requestId, cmd, ...extra });
    return {
      requestId: req.requestId,
      accept: req.accept,
      multiple: req.multiple,
      anchorRect: () => (req.rect ? new DOMRect(req.rect.x, req.rect.y, req.rect.w, req.rect.h) : null),
      container: () => document.querySelector('dialog:modal') || document.fullscreenElement || document.documentElement,
      async deliver(items) {
        // Só o necessário para o frame de origem buscar os bytes (sem thumbnails).
        const slim = items.map(({ source, key, path, name, type, lastModified }) => ({ source, key, path, name, type, lastModified }));
        await command('deliver', { items: slim });
      },
      openNative: () => command('native'),
    };
  }

  // ---------- Frames ----------

  function showFor(input) {
    if (IS_TOP || (innerWidth >= MIN_FRAME_W && innerHeight >= MIN_FRAME_H)) {
      openPopup(localTarget(input));
      return;
    }
    const requestId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    remoteInputs.clear();
    remoteInputs.set(requestId, input);
    const r = anchorRect(input);
    window.parent.postMessage({ [RECT_MESSAGE]: 1, requestId, rect: r && { x: r.left, y: r.top, w: r.width, h: r.height } }, '*');
    dbg('frame pequeno: abrindo o popup no frame principal', requestId);
    sendToSW({ type: 'openInTop', requestId, accept: input.accept, multiple: input.multiple }).catch((err) => {
      dbg('falha ao abrir no frame principal; abrindo aqui mesmo:', err.message);
      remoteInputs.delete(requestId);
      openPopup(localTarget(input));
    });
  }

  // (subframe) um clique ou Esc aqui dentro fecha o popup aberto no frame principal.
  function closeRemotePopup() {
    if (IS_TOP || !remoteInputs.size) return;
    for (const requestId of remoteInputs.keys()) sendToSW({ type: 'closeTop', requestId }).catch(() => {});
    remoteInputs.clear();
  }

  // A posição do input sobe frame a frame; cada um soma o deslocamento do <iframe> filho.
  window.addEventListener(
    'message',
    (e) => {
      const d = e.data;
      if (!d || d[RECT_MESSAGE] !== 1 || typeof d.requestId !== 'string') return;
      e.stopImmediatePropagation();
      const frameEl = [...document.querySelectorAll('iframe, frame')].find((f) => f.contentWindow === e.source);
      if (!frameEl) return;
      const fr = frameEl.getBoundingClientRect();
      const cs = getComputedStyle(frameEl);
      const dx = fr.left + frameEl.clientLeft + parseFloat(cs.paddingLeft || 0);
      const dy = fr.top + frameEl.clientTop + parseFloat(cs.paddingTop || 0);
      const rect = d.rect
        ? { x: d.rect.x + dx, y: d.rect.y + dy, w: d.rect.w, h: d.rect.h }
        : { x: fr.left, y: fr.top, w: fr.width, h: fr.height };
      if (IS_TOP) receiveRect(d.requestId, rect);
      else window.parent.postMessage({ ...d, rect }, '*');
    },
    { capture: true, signal }
  );

  function receiveRect(requestId, rect) {
    const waiter = rectWaiters.get(requestId);
    if (waiter?.resolve) waiter.resolve(rect);
    else rectWaiters.set(requestId, { rect });
    setTimeout(() => rectWaiters.delete(requestId), 5000);
  }

  function waitRect(requestId, timeout = 300) {
    const known = rectWaiters.get(requestId);
    if (known?.rect) return Promise.resolve(known.rect);
    return new Promise((resolve) => {
      rectWaiters.set(requestId, { resolve });
      setTimeout(() => resolve(null), timeout);
    });
  }

  async function handleFrameCommand(msg) {
    const input = remoteInputs.get(msg.requestId);
    if (!input) throw new Error('O campo de upload não está mais disponível.');
    if (msg.cmd === 'deliver') {
      fillInput(input, await loadFiles(msg.items));
      remoteInputs.delete(msg.requestId);
      return { ok: true };
    }
    if (msg.cmd === 'native') {
      // Iframes de mesma origem recebem a activation do clique no frame principal;
      // nos de outra origem só resta a activation do clique original (~5 s).
      if (navigator.userActivation?.isActive) {
        remoteInputs.delete(msg.requestId);
        openNativePicker(input);
        return { ok: true };
      }
      passThroughOnce = input;
      return { ok: true, needsClick: true };
    }
    throw new Error(`Comando desconhecido: ${msg.cmd}`);
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    switch (msg?.type) {
      case 'eu:openRemote':
        if (!IS_TOP) return false;
        sendResponse({ ok: true });
        waitRect(msg.requestId).then((rect) => openPopup(remoteTarget({ ...msg, rect })));
        return false;
      case 'eu:close':
        if (popup?.requestId && popup.requestId === msg.requestId) closePopup('clique no iframe');
        sendResponse({ ok: true });
        return false;
      case 'eu:command':
        handleFrameCommand(msg).then(sendResponse, (err) => sendResponse({ error: err.message }));
        return true;
      default:
        return false;
    }
  });

  // ---------- Formatação ----------

  function formatBytes(n) {
    if (!(n > 0)) return '';
    const units = ['B', 'KB', 'MB', 'GB'];
    let i = 0;
    while (n >= 1024 && i < units.length - 1) {
      n /= 1024;
      i++;
    }
    return `${n.toLocaleString('pt-BR', { maximumFractionDigits: n < 10 && i > 0 ? 1 : 0 })} ${units[i]}`;
  }

  const rtf = new Intl.RelativeTimeFormat('pt-BR', { numeric: 'auto' });
  function formatWhen(iso) {
    const t = new Date(iso).getTime();
    if (!t) return '';
    const diff = (t - Date.now()) / 1000;
    const steps = [
      [60, 'second'],
      [3600, 'minute', 60],
      [86400, 'hour', 3600],
      [86400 * 7, 'day', 86400],
    ];
    for (const [limit, unit, div = 1] of steps) {
      if (Math.abs(diff) < limit) return rtf.format(Math.round(diff / div), unit);
    }
    return new Date(t).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
  }

  function glyphFor(type, kind) {
    if (kind === 'text') return '📝';
    if (type.startsWith('image/')) return '🖼️';
    if (type.startsWith('video/')) return '🎞️';
    if (type.startsWith('audio/')) return '🎵';
    if (type === 'application/pdf') return '📕';
    if (/zip|rar|7z|tar|gzip/.test(type)) return '🗜️';
    return '📄';
  }

  // ---------- UI ----------

  // `onclick` não vira listener: fica registrado em `actions` e é disparado pelo
  // escudo de eventos acima.
  function h(tag, props = {}, ...children) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'onclick') actions.set(el, v);
      else if (k in el && k !== 'type') el[k] = v;
      else el.setAttribute(k, v === true ? '' : v);
    }
    el.append(...children.flat().filter((c) => c != null && c !== false));
    return el;
  }

  let sheet = null;
  function getSheet() {
    if (!sheet) {
      sheet = new CSSStyleSheet();
      sheet.replaceSync(globalThis.EasyUploadPopupCSS);
    }
    return sheet;
  }

  // Thumbnail com fallback: se a CSP da página bloquear data: em img-src,
  // decodifica os bytes e desenha num canvas (que não passa pela CSP).
  function makeThumb(dataUrl, glyph) {
    const box = h('span', { class: 'thumb' });
    if (!dataUrl) {
      box.textContent = glyph;
      return box;
    }
    const img = new Image();
    img.alt = '';
    img.onerror = () => {
      img.remove();
      drawDataUrl(box, dataUrl).catch(() => (box.textContent = glyph));
    };
    img.src = dataUrl;
    box.append(img);
    return box;
  }

  async function drawDataUrl(box, dataUrl) {
    const comma = dataUrl.indexOf(',');
    const type = dataUrl.slice(5, dataUrl.indexOf(';'));
    const bmp = await createImageBitmap(new Blob([b64ToBytes(dataUrl.slice(comma + 1))], { type }));
    const canvas = document.createElement('canvas');
    canvas.width = bmp.width;
    canvas.height = bmp.height;
    canvas.getContext('2d').drawImage(bmp, 0, 0);
    bmp.close();
    box.append(canvas);
  }

  function closePopup(reason) {
    if (!popup) return;
    const p = popup;
    popup = null;
    p.closed = true;
    try {
      if (p.host.matches(':popover-open')) p.host.hidePopover();
    } catch {}
    p.host.remove();
    dbg('popup fechado:', reason || 'concluído');
  }

  function pickContainer(input) {
    // Um <dialog> modal deixa todo o resto da página inerte: o popup precisa ficar dentro dele.
    const modal = input.isConnected ? input.closest('dialog') : document.querySelector('dialog:modal');
    if (modal?.matches(':modal')) return modal;
    return document.fullscreenElement || document.documentElement;
  }

  function anchorRect(input) {
    const vw = document.documentElement.clientWidth || innerWidth;
    const vh = innerHeight;
    const visible = (r) => r && (r.width > 0 || r.height > 0) && r.bottom > 0 && r.right > 0 && r.top < vh && r.left < vw;
    if (input.isConnected) {
      const r = input.getBoundingClientRect();
      // Inputs "escondidos" de 1px (truque comum de dropzones) não servem de âncora.
      if (visible(r) && r.width >= 8 && r.height >= 8) return r;
      for (const label of input.labels || []) {
        const lr = label.getBoundingClientRect();
        if (visible(lr)) return lr;
      }
    }
    if (lastPointer) return new DOMRect(lastPointer.x, lastPointer.y, 0, 0);
    return null;
  }

  function openPopup(target) {
    closePopup('substituído');
    popup = createPopup(target);
  }

  function createPopup(target) {
    const acceptTokens = Accept.parse(target.accept);
    const isAccepted = (item) => Accept.matches(acceptTokens, item.name, item.type);
    const multiple = target.multiple;
    const limit = Number(settings.downloadsLimit) || DEFAULTS.downloadsLimit;
    const selected = new Map(); // key -> item

    const host = document.createElement('easy-upload-popup');
    const important = (k, v) => host.style.setProperty(k, v, 'important');
    for (const [k, v] of Object.entries({
      all: 'initial', display: 'block', position: 'fixed', inset: 'auto', top: '0px', left: '0px',
      margin: '0', padding: '0', border: '0', background: 'transparent', overflow: 'visible',
      width: 'auto', height: 'auto', 'max-width': 'none', 'max-height': 'none',
      'z-index': '2147483647', visibility: 'hidden',
    })) important(k, v);

    const root = host.attachShadow({ mode: 'closed' });
    root.adoptedStyleSheets = [getSheet()];

    const clipboardList = h('div', { class: 'list' }, skeleton());
    const downloadsList = h('div', { class: 'list' }, skeleton(3));
    const banner = h('div', { class: 'banner', hidden: true });
    const status = h('div', { class: 'status', role: 'status' });
    const attachBtn = h('button', { class: 'btn primary', hidden: !multiple, disabled: true, onclick: () => attachSelected() }, 'Anexar');
    const nativeBtn = h('button', { class: multiple ? 'btn' : 'btn primary', onclick: () => chooseNative() }, 'Escolher do computador…');

    const acceptLabel = Accept.isRestrictive(acceptTokens) ? target.accept.replace(/\s*,\s*/g, ', ') : '';
    const panel = h(
      'div',
      { class: 'panel', role: 'dialog', 'aria-label': 'Easy Upload' },
      h(
        'header',
        {},
        h('span', { class: 'title' }, multiple ? 'Enviar arquivos' : 'Enviar arquivo'),
        acceptLabel && h('span', { class: 'chip', title: `accept="${target.accept}"` }, acceptLabel),
        h('span', { class: 'spacer' }),
        h('button', { class: 'icon', title: 'Opções', 'aria-label': 'Opções', onclick: () => sendToSW({ type: 'openOptions' }).catch(() => {}) }, '⚙'),
        h('button', { class: 'icon', title: 'Fechar (Esc)', 'aria-label': 'Fechar', onclick: () => closePopup('botão fechar') }, '✕')
      ),
      h(
        'div',
        { class: 'body' },
        settings.clipboardEnabled && h('section', {}, h('h3', {}, 'Área de transferência'), clipboardList),
        h('section', {}, h('h3', {}, 'Downloads recentes'), banner, downloadsList)
      ),
      status,
      h('footer', {}, nativeBtn, attachBtn)
    );
    root.append(panel);

    target.container().append(host);
    try {
      host.popover = 'manual';
      host.showPopover(); // top layer: fica acima de dialogs/popovers da página
    } catch {}

    const state = {
      host,
      requestId: target.requestId || null,
      closed: false,
      reposition,
      // Chamado pelo escudo de eventos: acha o botão sob o cursor (ou focado, se veio do teclado).
      activate(e) {
        const el = e.detail === 0 ? root.activeElement : root.elementFromPoint(e.clientX, e.clientY);
        const btn = el?.closest('button');
        if (btn && !btn.disabled) actions.get(btn)?.();
      },
    };
    reposition();
    important('visibility', 'visible');
    dbg('popup aberto', target.requestId ? `(para iframe, ${target.requestId})` : '');
    loadData();
    return state;

    // ----- posicionamento -----

    function reposition() {
      const vw = document.documentElement.clientWidth || innerWidth;
      const vh = innerHeight;
      const { width: w, height: hgt } = panel.getBoundingClientRect();
      const r = target.anchorRect();
      let top;
      let left;
      if (r) {
        top = r.bottom + 6;
        if (top + hgt > vh - 8 && r.top - 6 - hgt >= 8) top = r.top - 6 - hgt;
        left = r.left;
      } else {
        top = vh * 0.18;
        left = (vw - w) / 2;
      }
      top = Math.max(8, Math.min(top, vh - hgt - 8));
      left = Math.max(8, Math.min(left, vw - w - 8));
      important('top', `${Math.round(top)}px`);
      important('left', `${Math.round(left)}px`);
    }

    // ----- dados -----

    async function loadData() {
      let prep;
      try {
        prep = await sendToSW({ type: 'prepare' });
      } catch (err) {
        clipboardList.replaceChildren(empty('Indisponível.'));
        downloadsList.replaceChildren(empty('Indisponível.'));
        setStatus(`Erro ao falar com a extensão: ${err.message}`, true);
        return;
      }
      if (state.closed) return;
      await Promise.allSettled([settings.clipboardEnabled && loadClipboard(), loadDownloads(prep.fileAccess)]);
    }

    async function loadClipboard() {
      try {
        const res = await dataPort.request({ op: 'clipboard' });
        if (state.closed) return;
        const all = res.items.map((it) => ({ ...it, source: 'clipboard' }));
        const items = all.filter(isAccepted);
        let message = 'Nenhuma imagem, arquivo ou texto no clipboard.';
        if (!res.ok) message = 'Não foi possível ler o clipboard.';
        else if (all.length) message = `O conteúdo do clipboard não é aceito por este campo (${acceptLabel}).`;
        clipboardList.replaceChildren(...(items.length ? items.map((it) => renderItem(it)) : [empty(message)]));
      } catch (err) {
        clipboardList.replaceChildren(empty(`Erro: ${err.message}`));
      }
      reposition();
    }

    async function loadDownloads(fileAccess) {
      try {
        // O SW devolve todos os downloads compatíveis com `accept`, do mais recente
        // para o mais antigo (só metadados).
        const { items: candidates, scanned } = await sendToSW({ type: 'downloads', accept: target.accept });
        if (state.closed) return;
        const noneMessage = Accept.isRestrictive(acceptTokens) ? `Nenhum download recente compatível (${acceptLabel}).` : 'Nenhum download recente.';
        const withIcons = async (list) => {
          const { icons } = await sendToSW({ type: 'icons', ids: list.map((d) => d.id) }).catch(() => ({ icons: {} }));
          return list.map((d) => ({ ...d, icon: icons[d.id] || null }));
        };

        if (fileAccess === false) {
          showFileAccessBanner('Para anexar downloads, ative "Permitir acesso a URLs de arquivo" nos detalhes da extensão.');
          const shown = await withIcons(candidates.slice(0, limit));
          if (state.closed) return;
          downloadsList.replaceChildren(
            ...(shown.length ? shown.map((d) => renderItem(toDownloadItem(d), 'Requer acesso a URLs de arquivo')) : [empty(noneMessage)])
          );
          return;
        }

        // Verifica em lotes quais ainda existem no disco, até completar `limit`.
        // Arquivos apagados ou movidos não "gastam" vagas da lista.
        const BATCH = 20;
        const found = [];
        let checked = 0;
        for (let i = 0; i < candidates.length && found.length < limit; i += BATCH) {
          const batch = candidates.slice(i, i + BATCH);
          const { results } = await dataPort.request({
            op: 'probe',
            files: batch.map((d) => ({ path: d.path, size: d.size, thumb: false })),
          });
          if (state.closed) return;
          checked += batch.length;
          batch.forEach((d, j) => results[j].exists && found.push(d));
        }
        dbg(`downloads: ${scanned} no histórico, ${candidates.length} compatíveis, ${checked} verificados, ${found.length} existem no disco`);

        const shown = found.slice(0, limit);
        const [{ results: thumbs }, iconed] = await Promise.all([
          dataPort.request({
            op: 'probe',
            files: shown.map((d) => ({ path: d.path, size: d.size, thumb: Accept.mimeFor(d.name, d.mime).startsWith('image/') })),
          }),
          withIcons(shown),
        ]);
        if (state.closed) return;
        const existing = iconed.map((d, i) => ({ ...toDownloadItem(d), thumb: thumbs[i]?.thumb || null }));

        if (!existing.length && candidates.length && fileAccess == null) {
          showFileAccessBanner('Nenhum download pôde ser lido. Verifique se "Permitir acesso a URLs de arquivo" está ativado.');
        }
        downloadsList.replaceChildren(...(existing.length ? existing.map((d) => renderItem(d)) : [empty(noneMessage)]));
      } catch (err) {
        downloadsList.replaceChildren(empty(`Erro: ${err.message}`));
      }
      reposition();
    }

    function toDownloadItem(d) {
      return {
        key: `d${d.id}`,
        source: 'download',
        kind: 'file',
        name: d.name,
        path: d.path,
        type: Accept.mimeFor(d.name, d.mime),
        size: d.size,
        lastModified: new Date(d.time).getTime() || Date.now(),
        when: d.time,
        icon: d.icon,
      };
    }

    function showFileAccessBanner(text) {
      banner.replaceChildren(
        h('span', {}, text),
        h('button', { class: 'link', onclick: () => sendToSW({ type: 'openExtensionsPage' }).catch(() => {}) }, 'Abrir configurações')
      );
      banner.hidden = false;
    }

    // ----- itens -----

    function renderItem(item, forcedDisabledReason) {
      let reason = forcedDisabledReason || '';
      if (!reason && item.size > maxBytes()) reason = `Maior que o limite de ${settings.maxFileMB} MB`;

      const sub = [item.kind === 'text' ? item.preview : null, formatBytes(item.size), item.when ? formatWhen(item.when) : null].filter(Boolean);

      const btn = h(
        'button',
        {
          class: 'item',
          disabled: !!reason,
          title: reason || item.path || item.name,
          'aria-pressed': multiple ? 'false' : null,
          onclick: () => onItemClick(item, btn),
        },
        makeThumb(item.thumb || item.icon, glyphFor(item.type, item.kind)),
        h('span', { class: 'meta' }, h('span', { class: 'name' }, item.name), h('span', { class: 'sub' }, sub.join(' · '))),
        multiple && h('span', { class: 'check', 'aria-hidden': 'true' }, '✓')
      );
      return btn;
    }

    function onItemClick(item, btn) {
      if (multiple) {
        if (selected.has(item.key)) selected.delete(item.key);
        else selected.set(item.key, item);
        btn.setAttribute('aria-pressed', String(selected.has(item.key)));
        attachBtn.disabled = selected.size === 0;
        attachBtn.textContent = selected.size ? `Anexar (${selected.size})` : 'Anexar';
        return;
      }
      btn.classList.add('loading');
      deliver([item]).finally(() => btn.classList.remove('loading'));
    }

    function attachSelected() {
      if (!selected.size) return;
      attachBtn.disabled = true;
      deliver([...selected.values()]).finally(() => (attachBtn.disabled = selected.size === 0));
    }

    async function deliver(items) {
      setStatus(items.length > 1 ? `Carregando ${items.length} arquivos…` : 'Carregando…');
      try {
        await target.deliver(items);
        if (!state.closed) closePopup();
      } catch (err) {
        setStatus(err.message, true);
      }
    }

    async function chooseNative() {
      try {
        const res = await target.openNative();
        if (state.closed) return;
        if (res?.needsClick) setStatus('Clique no campo de novo para abrir o seletor do sistema.');
        else closePopup('seletor nativo');
      } catch (err) {
        setStatus(err.message, true);
      }
    }

    function setStatus(text, isError = false) {
      status.textContent = text;
      status.classList.toggle('error', isError);
      reposition();
    }

    function empty(text) {
      return h('div', { class: 'empty' }, text);
    }

    function skeleton(n = 1) {
      return Array.from({ length: n }, () => h('div', { class: 'skeleton' }));
    }
  }
})();
