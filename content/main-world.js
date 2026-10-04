// Roda no MAIN world (mesmo contexto JS da página), em document_start.
// Intercepta input.click() e input.showPicker() chamados pelo script da página,
// inclusive em inputs que nunca foram inseridos no DOM.
//
// Protocolo com o content script (ISOLATED world):
//   dispara um MouseEvent cancelável 'easyupload:intercept' no document, com o
//   input em `relatedTarget` (nós do DOM são compartilhados entre worlds, então
//   a referência chega intacta mesmo para inputs desanexados).
//   dispatchEvent é síncrono: se o content script chamar preventDefault(), ele
//   assumiu o controle; caso contrário (site excluído, extensão recarregada,
//   erro), chamamos o método original e o seletor nativo abre normalmente.
(() => {
  'use strict';

  const EVENT = 'easyupload:intercept';
  const proto = HTMLInputElement.prototype;

  // A extensão reinjeta este script nas abas abertas quando é instalada/recarregada;
  // o patch antigo continua válido (só dispara o evento), então não aplica de novo.
  const MARK = Symbol.for('easyUpload.patched');
  if (proto[MARK]) return;
  Object.defineProperty(proto, MARK, { value: true });
  const originalClick = proto.click;
  const originalShowPicker = proto.showPicker;

  // detail: 1 = click(), 2 = showPicker() (só para os logs de debug)
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

  // Métodos com o mesmo nome/aridade dos originais, para não chamar atenção
  // de código que inspeciona `fn.name` / `fn.length`.
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
