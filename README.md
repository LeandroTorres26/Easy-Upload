# Easy Upload

Anexe arquivos sem abrir o seletor do sistema. Ao clicar em qualquer campo de upload, o Easy Upload mostra o que você acabou de copiar e os seus downloads mais recentes. Um clique e o arquivo está anexado.

Inspirado no recurso "Easy Files" do Opera, para navegadores baseados em Chromium (Chrome, Edge, Brave, Helium e outros).

## Recursos

- **Clipboard**: prints, imagens copiadas e texto (anexado como `.txt`).
- **Downloads recentes**: os arquivos baixados pelo navegador, com miniatura e data. Arquivos apagados ou movidos são ignorados.
- **Filtra pelo que o campo aceita**: se o site só aceita PDF, aparecem só PDFs; se aceita imagens, só imagens.
- **Vários arquivos de uma vez** em campos que permitem seleção múltipla.
- **Seletor do sistema a um clique**, pelo botão "Escolher do computador".
- Funciona em sites como WhatsApp Web, X, Gmail e em uploads dentro de iframes e janelas modais.
- Tema claro e escuro, de acordo com o sistema.
- Sem dependências e sem build: HTML, CSS e JavaScript puros.

## Instalação

### Manual

1. Baixe ou clone este repositório.
2. Abra `chrome://extensions` e ative o **Modo do desenvolvedor**.
3. Clique em **Carregar sem compactação** e selecione a pasta do projeto.
4. Em **Detalhes** da extensão, ative **Permitir acesso a URLs de arquivo**.

O passo 4 é necessário para anexar downloads. Sem ele, os downloads aparecem na lista, mas não podem ser anexados, e o popup mostra um aviso com um atalho para a configuração.

Requer Chromium 116 ou mais recente.

## Uso

- Clique em um campo de upload. Em vez do seletor do sistema, aparece o popup.
- Clique em um item para anexá-lo. Em campos com seleção múltipla, marque os itens e clique em **Anexar**.
- **Escolher do computador** abre o seletor do sistema normalmente.
- **Esc** ou um clique fora fecham o popup.

## Opções

Acesse pelo ícone ⚙ no popup ou em `chrome://extensions` → Easy Upload → Detalhes → Opções da extensão.

- Quantidade de downloads exibidos (padrão: 8).
- Mostrar ou ocultar a área de transferência.
- Tamanho máximo por arquivo (padrão: 100 MB).
- Sites excluídos, onde o seletor do sistema abre direto.
- Modo debug: registra no console da página (F12) por que cada clique foi ou não interceptado. Útil para relatar problemas.

## Privacidade

O Easy Upload não envia nada para lugar nenhum. Não faz requisições de rede, não tem analytics e não coleta dados.

- O clipboard só é lido quando você clica em um campo de upload, para montar a lista.
- Os arquivos só são lidos quando você escolhe um item, e vão direto para o campo do site.
- As opções ficam salvas no armazenamento de sincronização do próprio navegador.

## Permissões

| Permissão | Por quê |
|---|---|
| `clipboardRead` | Ler o clipboard sem o navegador pedir autorização em cada site. |
| `downloads` | Listar os downloads recentes e mostrar seus ícones. |
| `offscreen` | Documento interno que lê o clipboard e os arquivos baixados. |
| `storage` | Salvar as opções. |
| `scripting` | Ativar a extensão nas abas já abertas logo após instalar ou atualizar, sem precisar recarregá-las. |
| Acesso a todos os sites | Detectar campos de upload em qualquer página e ler os arquivos baixados (`file://`). |

## Limitações conhecidas

- **Arquivos copiados no Explorer** podem não aparecer, dependendo do navegador. Prints, imagens e texto funcionam.
- **Arquivos grandes**: arquivos acima do limite configurado aparecem desabilitados, porque o arquivo inteiro passa pela memória.
- **Shadow DOM fechado**: cliques diretos em um campo dentro de um shadow root `closed` abrem o seletor do sistema.
- **Iframes de outro domínio**: se "Escolher do computador" for clicado mais de ~5 s após o clique no campo, o popup pede para clicar no campo de novo.
- **Fora do escopo**: áreas de arrastar e soltar sem campo de upload, e sites que usam `window.showOpenFilePicker`.

## Como funciona

| Arquivo | Papel |
|---|---|
| `content/main-world.js` | Roda no contexto da página e intercepta `input.click()` e `input.showPicker()`, inclusive em campos fora do DOM. |
| `content/content.js` | Decide quando interceptar, mostra o popup (Shadow DOM fechado) e preenche o campo com `DataTransfer`, disparando `input` e `change` para funcionar com React, Vue e afins. |
| `content/accept.js` | Interpreta o atributo `accept` e infere o tipo dos arquivos pela extensão. |
| `content/popup-css.js` | Estilos do popup. |
| `background.js` | Service worker: consulta os downloads e coordena os outros contextos. |
| `offscreen.html`, `offscreen.js` | Lê o clipboard e os arquivos baixados e gera as miniaturas. |
| `options/` | Página de opções. |

Detalhes que valem saber antes de mexer no código:

- **Transporte dos arquivos**: mensagens entre contextos de extensão só levam JSON, então os arquivos vão do offscreen para a página em pedaços de 1 MiB em base64, direto pelo `Port`, sem passar pelo service worker.
- **Popup invisível para a página**: os eventos do popup são parados antes de chegar aos handlers do site. Sem isso, menus que fecham ao "clicar fora" (como o de anexos do WhatsApp) removeriam o campo antes de ele ser preenchido.
- **Iframes pequenos**: quando o popup não cabe no iframe, ele abre na página principal, e a escolha volta ao iframe pelo service worker.
