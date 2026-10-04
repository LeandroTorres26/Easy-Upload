# Easy Upload

Extensão pessoal (Manifest V3, sem dependências e sem build) que replica o "Easy Files" do Opera. Ao clicar num campo `<input type="file">`, abre um popup com o conteúdo do clipboard, os downloads recentes e um botão para o seletor nativo.

## Instalação no Helium

1. Abra `chrome://extensions` (ou `helium://extensions`).
2. Ative o **Modo do desenvolvedor**.
3. Clique em **Carregar sem compactação** (Load unpacked) e selecione esta pasta.
4. Em **Detalhes** da extensão, ative **Permitir acesso a URLs de arquivo**. Isso é necessário para ler o conteúdo dos downloads e para a extensão rodar em `file://`, inclusive no `test/test.html`.

5. Ainda em **Detalhes**, confira se **Acesso ao site** está em **Em todos os sites**. Se estiver em "Ao clicar" ou "Em sites específicos", a extensão não roda nas páginas.

Requer Chromium 116+.

## Testando

Abra `test/test.html` direto do disco, com o acesso a URLs de arquivo ativado, e clique em cada caso. O log ao lado mostra os eventos `input`/`change` e os arquivos recebidos.

Na página de opções há um **Diagnóstico do clipboard**: copie algo (print, imagem, arquivos no Explorer) e veja o que cada método de leitura enxerga.

## Arquitetura

| Contexto | Arquivo | Responsabilidade |
|---|---|---|
| MAIN world | `content/main-world.js` | Patch de `HTMLInputElement.prototype.click` / `showPicker`. Avisa o ISOLATED com um evento síncrono e cancelável, levando o input em `relatedTarget`; funciona até com input fora do DOM. Se ninguém chamar `preventDefault()`, chama o método original. |
| ISOLATED world | `content/content.js`, `content/accept.js`, `content/popup-css.js` | Listener de `click` em captura, decisão de interceptar, popup em Shadow DOM fechado (top layer via `popover`) e preenchimento via `DataTransfer` + eventos `input`/`change`. |
| Service worker | `background.js` | `downloads.search`, `getFileIcon`, `isAllowedFileSchemeAccess`, ciclo de vida do offscreen. Nunca trafega bytes. |
| Offscreen document | `offscreen.html/js` | Lê o clipboard (`execCommand('paste')` num contenteditable), lê arquivos via XHR em `file://` e gera thumbnails. |

**Popup invisível para a página**: os eventos de mouse, toque e roda do popup param num listener de captura no `window`, registrado em `document_start` (antes de qualquer script da página). As ações dos botões são disparadas a partir dali, e o `mousedown` tem `preventDefault()` para não tirar o foco da página. Sem isso, menus e modais que fecham ao "clicar fora" ou ao perder o foco (WhatsApp, X) desmontam o input antes do preenchimento.

**Iframes pequenos** (menos de 360×340): o popup abre no frame principal. O pedido vai pelo SW, que conhece o `frameId` de quem pediu, até o frame 0. A posição do input sobe por uma cadeia de `postMessage`, em que cada frame soma o deslocamento do `<iframe>` filho. A escolha volta pelo SW direto ao frame de origem, que lê os bytes e preenche o input.

**"Escolher do computador"**: o clique no popup gera uma user activation nova. A extensão então liga uma flag de bypass e chama `input.click()` pelo protótipo do ISOLATED world, que não tem o patch. O listener de captura ignora esse clique por causa da flag.

**Transporte de bytes**: `runtime.sendMessage`/`Port` só serializam JSON (Blob e ArrayBuffer viram `{}`). Por isso:
- o content script abre um `Port` **direto com o offscreen**, sem passar pelo SW;
- os arquivos trafegam em chunks **base64 de 1 MiB**, cada um numa mensagem, bem abaixo do limite de ~64 MB por mensagem;
- o overhead do base64 é de ~33%, contra ~300% de um array de números; `blob:` URLs do offscreen não servem porque têm origem da extensão e o content script não consegue fazer fetch delas;
- a listagem envia só metadados e thumbnails, e os bytes completos só vão quando o item é escolhido.

## Permissões

```jsonc
"permissions": [
  "clipboardRead", // ler o clipboard no offscreen via execCommand('paste'), sem o prompt de permissão por site
  "offscreen",     // criar o documento offscreen (DOM + clipboard + XHR em file://)
  "downloads",     // listar downloads recentes (search) e obter ícones (getFileIcon)
  "storage",       // salvar as opções (storage.sync)
  "scripting"      // reinjetar os content scripts nas abas já abertas quando a extensão é instalada/recarregada
],
"host_permissions": [
  "<all_urls>"     // (1) executeScript nas abas abertas, que exige permissão explícita de host
                   //     (os matches de content_scripts não bastam);
                   // (2) XHR nos arquivos baixados em file://, que também exige o toggle
                   //     "Permitir acesso a URLs de arquivo"
],
"content_scripts": "<all_urls>" // interceptar inputs em qualquer site
```

O aviso de instalação ("ler e alterar dados em todos os sites") é o mesmo que os content scripts em `<all_urls>` já geravam. Não usa `tabs`. `chrome.tabs.create`, usado para abrir a página de detalhes da extensão, não exige a permissão `tabs`.

## Limitações conhecidas

- **Arquivos copiados no Explorer**: dependem de o Chromium expor o `CF_HDROP` em `clipboardData.files` no evento `paste`. Use o diagnóstico nas opções para confirmar no seu Helium. Se a lista vier vazia, só imagens e texto do clipboard são suportados.
- **Downloads** sem "Permitir acesso a URLs de arquivo" aparecem desabilitados, com um aviso no popup. Arquivos removidos do disco são ocultados.
- **Shadow DOM fechado**: cliques diretos num input dentro de um shadow root `closed` não são interceptados e abrem o seletor nativo. Chamadas `.click()` nesse input são interceptadas normalmente.
- **"Escolher do computador" em iframe de outra origem**: o clique no popup do frame principal não dá user activation ao iframe. Se a activation do clique original (~5 s) já tiver expirado, o popup pede para clicar no campo de novo, e esse clique vai direto ao seletor nativo.
- **Diagnóstico**: ative o **Modo debug** nas opções e abra o console da página (F12). Cada clique em input de arquivo registra se foi interceptado e, se não foi, o motivo.
- Arquivos maiores que o limite configurado (padrão 100 MB) ficam desabilitados, porque o arquivo inteiro passa pela memória e por base64.
- Uma página que pegue o `click` original de um `<iframe about:blank>` limpo escapa do patch do MAIN world.
- Fora do escopo da v1: áreas de drag-and-drop sem input e `window.showOpenFilePicker`.
