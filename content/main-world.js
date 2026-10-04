// MAIN world, document_start: intercepta input.click() e input.showPicker()
// chamados pela página, inclusive em inputs fora do DOM.
//
// Avisa o content script com um evento cancelável no document, levando o input
// em `relatedTarget` (nós do DOM são compartilhados entre worlds). O dispatch é
// síncrono: se o content script chamar preventDefault(), ele assume; senão, o
// método original roda e o seletor nativo abre.
(() => {
  'use strict';

  const EVENT = 'easyupload:intercept';
  const proto = HTMLInputElement.prototype;

  // Evita aplicar o patch duas vezes quando a extensão reinjeta os scripts.
  const MARK = Symbol.for('easyUpload.patched');
  if (proto[MARK]) return;
  Object.defineProperty(proto, MARK, { value: true });

  const originalClick = proto.click;
  const originalShowPicker = proto.showPicker;

  // detail: 1 = click(), 2 = showPicker(); usado nos logs de debug.
  function offer(input, detail) {
    if (input.type !== 'file' || input.disabled || input.webkitdirectory) return false;
    try {
      const ev = new MouseEvent(EVENT, { cancelable: true, relatedTarget: input, detail });
      document.dispatchEvent(ev);
      return ev.defaultPrevented;
    } catch {
      return false;
    }
  }

  // Definidos como métodos para manter `name` e `length` iguais aos originais.
  const patched = {
    click() {
      if (this instanceof HTMLInputElement && offer(this, 1)) return;
      return originalClick.apply(this, arguments);
    },
    showPicker() {
      if (this instanceof HTMLInputElement && offer(this, 2)) return;
      return originalShowPicker.apply(this, arguments);
    },
  };

  proto.click = patched.click;
  if (typeof originalShowPicker === 'function') proto.showPicker = patched.showPicker;
})();
