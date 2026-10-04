// Offscreen document: o único contexto com DOM + permissões da extensão.
// - Lê o clipboard via execCommand('paste') num contenteditable. A permissão
//   clipboardRead dispensa o prompt por site. navigator.clipboard.read() não
//   serve aqui porque exige documento com foco.
// - Lê arquivos baixados via XHR em file:// (fetch() não suporta o esquema file:).
// - Gera thumbnails e transmite bytes para o content script.
//
// Transporte: runtime Ports só serializam JSON (Blob/ArrayBuffer viram {}).
// Os bytes vão em chunks base64 de 1 MiB, cada um uma mensagem separada, bem
// abaixo do limite de ~64 MB por mensagem. O overhead do base64 é de ~33%,
// contra ~300% de um array de números.
'use strict';

const PORT_NAME = 'easyupload-data';
const CHUNK_SIZE = 1024 * 1024;
const THUMB_PX = 160;
const MAX_THUMB_SOURCE = 25 * 1024 * 1024;

let clipboardCache = new Map(); // key -> File (válido até a próxima leitura)

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== PORT_NAME) return;
  // A página do outro lado pode navegar ou ir para o back/forward cache; o Chrome
  // fecha o Port e registra um erro "Unchecked runtime.lastError" se ninguém o ler.
  port.onDisconnect.addListener(() => void chrome.runtime.lastError);
  port.onMessage.addListener((msg) => {
    handle(port, msg).catch((err) => post(port, { id: msg.id, error: String(err?.message || err) }));
  });
});

function post(port, msg) {
  try {
    port.postMessage(msg);
    return true;
  } catch {
    return false; // o content script fechou (aba navegou, popup fechado)
  }
}

async function handle(port, msg) {
  const { id } = msg;
  switch (msg.op) {
    case 'clipboard':
      return post(port, { id, ...(await listClipboard()) });
    case 'diagnose':
      return post(port, { id, report: await diagnoseClipboard() });
    case 'probe':
      return post(port, { id, results: await Promise.all(msg.files.map(probeFile)) });
    case 'read': {
      const blob =
        msg.source === 'clipboard'
          ? clipboardCache.get(msg.key)
          : await readFileUrl(pathToFileUrl(msg.path));
      if (!blob) throw new Error('O item não está mais disponível. Reabra o popup.');
      if (msg.maxBytes && blob.size > msg.maxBytes) throw new Error('Arquivo maior que o limite configurado.');
      await streamBlob(port, id, blob);
      return post(port, { id, done: true, size: blob.size });
    }
    default:
      throw new Error(`Operação desconhecida: ${msg.op}`);
  }
}

// ---------- Clipboard ----------

function pasteIntoTarget() {
  const target = document.getElementById('paste-target');
  target.textContent = '';
  let captured = null;

  const onPaste = (e) => {
    e.preventDefault();
    const dt = e.clipboardData;
    let files = Array.from(dt.files);
    if (!files.length) {
      for (const item of dt.items) {
        if (item.kind !== 'file') continue;
        const f = item.getAsFile();
        if (f) files.push(f);
      }
    }
    captured = {
      types: Array.from(dt.types),
      items: Array.from(dt.items, (i) => ({ kind: i.kind, type: i.type })),
      files,
      text: dt.getData('text/plain'),
      html: dt.getData('text/html'),
    };
  };

  target.addEventListener('paste', onPaste);
  target.focus();
  let ok = false;
  try {
    ok = document.execCommand('paste'); // o evento 'paste' dispara de forma síncrona aqui
  } finally {
    target.removeEventListener('paste', onPaste);
    target.blur();
    target.textContent = '';
  }
  return { ok, captured };
}

// Algumas fontes (ex.: "copiar imagem" em certos apps) só colocam um <img src="data:...">
// no HTML, sem arquivo. Recupera essas imagens como File.
function filesFromHtml(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const out = [];
  for (const img of doc.querySelectorAll('img[src^="data:image/"]')) {
    const m = /^data:(image\/[\w.+-]+);base64,(.*)$/s.exec(img.getAttribute('src'));
    if (!m) continue;
    const bytes = Uint8Array.from(atob(m[2]), (c) => c.charCodeAt(0));
    out.push(new File([bytes], '', { type: m[1] }));
  }
  return out;
}

function timestamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

const EXT_BY_IMAGE_MIME = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp',
  'image/bmp': 'bmp', 'image/svg+xml': 'svg', 'image/avif': 'avif',
};

async function listClipboard() {
  clipboardCache = new Map();
  const { ok, captured } = pasteIntoTarget();
  if (!captured) return { ok, items: [] };

  let files = captured.files;
  if (!files.length && captured.html) files = filesFromHtml(captured.html);

  const stamp = timestamp();
  const items = [];

  for (const [i, f] of files.entries()) {
    const isImage = f.type.startsWith('image/');
    let name = f.name;
    // Prints e imagens copiadas chegam como "image.png": dá um nome útil.
    if (!name || (isImage && /^image\.\w+$/i.test(name))) {
      const ext = EXT_BY_IMAGE_MIME[f.type] || 'png';
      name = `clipboard-${stamp}${files.length > 1 ? `-${i + 1}` : ''}.${ext}`;
    }
    const key = `c${i}-${stamp}`;
    const file = name === f.name ? f : new File([f], name, { type: f.type, lastModified: f.lastModified });
    clipboardCache.set(key, file);
    items.push({
      key,
      kind: isImage ? 'image' : 'file',
      name,
      type: file.type,
      size: file.size,
      lastModified: file.lastModified,
      thumb: isImage ? await makeThumbnail(file).catch(() => null) : null,
    });
  }

  const text = captured.text || '';
  if (!files.length && text.trim()) {
    const key = `t-${stamp}`;
    const file = new File([text], `clipboard-${stamp}.txt`, { type: 'text/plain' });
    clipboardCache.set(key, file);
    items.push({
      key,
      kind: 'text',
      name: file.name,
      type: file.type,
      size: file.size,
      lastModified: file.lastModified,
      preview: text.trim().replace(/\s+/g, ' ').slice(0, 90),
    });
  }

  return { ok, items };
}

async function diagnoseClipboard() {
  const { ok, captured } = pasteIntoTarget();
  const report = {
    context: 'offscreen',
    execCommandPaste: ok,
    pasteEventFired: !!captured,
    types: captured?.types || [],
    items: captured?.items || [],
    files: (captured?.files || []).map((f) => ({ name: f.name, type: f.type, size: f.size })),
    textLength: captured?.text?.length || 0,
    htmlLength: captured?.html?.length || 0,
  };
  try {
    const entries = await navigator.clipboard.read();
    report.asyncClipboardRead = entries.map((e) => e.types);
  } catch (err) {
    report.asyncClipboardRead = `erro: ${err.name}: ${err.message}`;
  }
  return report;
}

// ---------- Arquivos locais ----------

function pathToFileUrl(path) {
  const s = path.replace(/\\/g, '/');
  if (s.startsWith('//')) {
    // UNC: \\servidor\share\arquivo -> file://servidor/share/arquivo
    const [, , host, ...rest] = s.split('/');
    return `file://${host}/${rest.map(encodeURIComponent).join('/')}`;
  }
  const segments = s.split('/').map((seg, i) => (i === 0 && /^[a-z]:$/i.test(seg) ? seg : encodeURIComponent(seg)));
  return s.startsWith('/') ? `file://${segments.join('/')}` : `file:///${segments.join('/')}`;
}

function readFileUrl(url) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', url);
    xhr.responseType = 'arraybuffer';
    xhr.onload = () => {
      if (xhr.response) resolve(new Blob([xhr.response]));
      else reject(new Error('Leitura vazia.'));
    };
    xhr.onerror = () =>
      reject(new Error('Não foi possível ler o arquivo (removido, ou "Permitir acesso a URLs de arquivo" desativado).'));
    xhr.send();
  });
}

// Verifica se o arquivo existe sem ler o conteúdo: aborta assim que a
// resposta começa a chegar.
function probeUrl(url) {
  return new Promise((resolve) => {
    const xhr = new XMLHttpRequest();
    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      resolve(value);
      if (value) xhr.abort();
    };
    xhr.open('GET', url);
    xhr.onreadystatechange = () => {
      if (xhr.readyState >= XMLHttpRequest.HEADERS_RECEIVED) done(true);
    };
    xhr.onload = () => done(true);
    xhr.onerror = () => done(false);
    xhr.send();
  });
}

async function probeFile({ path, thumb, size }) {
  const url = pathToFileUrl(path);
  if (!(await probeUrl(url))) return { exists: false };
  if (!thumb || size > MAX_THUMB_SOURCE) return { exists: true };
  try {
    return { exists: true, thumb: await makeThumbnail(await readFileUrl(url)) };
  } catch {
    return { exists: true };
  }
}

// ---------- Utilidades ----------

async function makeThumbnail(blob) {
  const bmp = await createImageBitmap(blob);
  const scale = Math.min(1, THUMB_PX / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bmp.width * scale));
  canvas.height = Math.max(1, Math.round(bmp.height * scale));
  canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close();
  return canvas.toDataURL('image/webp', 0.8);
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).slice(String(reader.result).indexOf(',') + 1));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

async function streamBlob(port, id, blob) {
  for (let offset = 0; offset < blob.size; offset += CHUNK_SIZE) {
    const chunk = await blobToBase64(blob.slice(offset, offset + CHUNK_SIZE));
    if (!post(port, { id, chunk })) throw new Error('Conexão encerrada.');
  }
}
