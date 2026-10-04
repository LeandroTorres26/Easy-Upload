// Interpretação do atributo `accept` e inferência de MIME por extensão.
// Carregado antes de content.js no mesmo ISOLATED world.
globalThis.EasyUploadAccept = (() => {
  'use strict';

  const MIME_BY_EXT = {
    png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', jfif: 'image/jpeg', gif: 'image/gif',
    webp: 'image/webp', avif: 'image/avif', svg: 'image/svg+xml', bmp: 'image/bmp', ico: 'image/x-icon',
    heic: 'image/heic', heif: 'image/heif', tif: 'image/tiff', tiff: 'image/tiff',
    pdf: 'application/pdf', txt: 'text/plain', md: 'text/markdown', csv: 'text/csv', tsv: 'text/tab-separated-values',
    json: 'application/json', xml: 'application/xml', html: 'text/html', htm: 'text/html', css: 'text/css',
    js: 'text/javascript', rtf: 'application/rtf',
    zip: 'application/zip', rar: 'application/vnd.rar', '7z': 'application/x-7z-compressed',
    gz: 'application/gzip', tar: 'application/x-tar',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ppt: 'application/vnd.ms-powerpoint',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    odt: 'application/vnd.oasis.opendocument.text', ods: 'application/vnd.oasis.opendocument.spreadsheet',
    mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime', mkv: 'video/x-matroska', avi: 'video/x-msvideo',
    mp3: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', m4a: 'audio/mp4', flac: 'audio/flac',
  };

  const GENERIC = new Set(['', 'application/octet-stream', 'binary/octet-stream', 'application/x-msdownload']);

  function extOf(name) {
    const m = /\.([^.\\/]+)$/.exec(name || '');
    return m ? m[1].toLowerCase() : '';
  }

  // MIME efetivo: usa o informado se for específico, senão infere pela extensão.
  function mimeFor(name, mime) {
    const m = (mime || '').toLowerCase().split(';')[0].trim();
    if (!GENERIC.has(m)) return m;
    return MIME_BY_EXT[extOf(name)] || m || 'application/octet-stream';
  }

  function parse(accept) {
    return String(accept || '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
  }

  function matches(tokens, name, mime) {
    if (!tokens.length) return true;
    const lower = (name || '').toLowerCase();
    const type = mimeFor(name, mime);
    return tokens.some((t) => {
      if (t.startsWith('.')) return lower.endsWith(t);
      if (t.endsWith('/*')) return type.startsWith(t.slice(0, -1));
      return type === t;
    });
  }

  return { parse, matches, mimeFor, extOf };
})();
