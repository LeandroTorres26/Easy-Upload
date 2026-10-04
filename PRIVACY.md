# Privacy Policy

_Last updated: October 4, 2026_

Easy Upload is a browser extension that lets you attach files to upload fields on websites directly from your clipboard and your recent downloads. This policy explains what data the extension handles and how.

## Summary

Everything happens on your device. Easy Upload does not send any data to the developer or to third parties, makes no network requests, and contains no analytics or tracking.

## Data the extension handles

| Data | When | Why |
|---|---|---|
| Clicks on file upload fields | When you click an `<input type="file">` on a web page | To open the Easy Upload popup instead of the system file dialog. Other clicks are ignored. |
| Clipboard content (images, screenshots, text) | Only when the popup opens | To offer what you just copied as an attachable item. |
| Recent downloads list (file name, size, date, local path, icon) | Only when the popup opens | To offer your recent downloads as attachable items. |
| Contents of a downloaded file or clipboard item | Only when you choose that item | To place the file into the upload field you clicked, as the system file dialog would. |
| Your settings | When you change them on the options page | To remember your preferences. |

## Storage

- Clipboard content, the downloads list and file contents are kept in memory only while the popup is open. They are not saved.
- Settings (number of downloads shown, clipboard on/off, maximum file size, excluded sites, debug mode) are saved with the browser's `chrome.storage.sync`. If you use browser sync, your browser provider syncs them between your devices; the developer has no access to them.

## Sharing

The only place a file goes is the upload field you clicked, on the website you are using, and only after you choose it. What that website does with the file is governed by its own privacy policy.

Easy Upload does not sell, transfer or share user data with anyone, does not use it for any purpose unrelated to attaching files, and does not use it to determine creditworthiness or for lending.

## Permissions

The permissions requested and the reason for each are listed in the [README](README.md#permissões).

## Contact

Questions or concerns: open an issue at <https://github.com/LeandroTorres26/Easy-Upload/issues>.

---

# Política de Privacidade (Português)

_Última atualização: 4 de outubro de 2026_

O Easy Upload é uma extensão de navegador que permite anexar arquivos em campos de upload diretamente do clipboard e dos downloads recentes. Esta política explica quais dados a extensão manipula e como.

## Resumo

Tudo acontece no seu dispositivo. O Easy Upload não envia dados ao desenvolvedor nem a terceiros, não faz requisições de rede e não tem analytics nem rastreamento.

## Dados manipulados

| Dado | Quando | Por quê |
|---|---|---|
| Cliques em campos de upload | Quando você clica num `<input type="file">` | Para abrir o popup no lugar do seletor de arquivos do sistema. Outros cliques são ignorados. |
| Conteúdo do clipboard (imagens, prints, texto) | Só quando o popup abre | Para oferecer o que você acabou de copiar como item anexável. |
| Lista de downloads recentes (nome, tamanho, data, caminho local, ícone) | Só quando o popup abre | Para oferecer seus downloads recentes como itens anexáveis. |
| Conteúdo de um download ou item do clipboard | Só quando você escolhe o item | Para colocar o arquivo no campo de upload clicado, como o seletor do sistema faria. |
| Suas configurações | Quando você as altera nas opções | Para lembrar suas preferências. |

## Armazenamento

- O conteúdo do clipboard, a lista de downloads e o conteúdo dos arquivos ficam só na memória enquanto o popup está aberto. Nada disso é salvo.
- As configurações são salvas com o `chrome.storage.sync` do navegador. Se você usa a sincronização do navegador, ela é feita pelo provedor do navegador; o desenvolvedor não tem acesso.

## Compartilhamento

Um arquivo só vai para o campo de upload que você clicou, no site que você está usando, e só depois que você o escolhe. O que o site faz com o arquivo segue a política de privacidade dele.

O Easy Upload não vende, transfere nem compartilha dados de usuários, não os usa para nada além de anexar arquivos e não os usa para avaliar crédito nem para empréstimos.

## Contato

Dúvidas: abra uma issue em <https://github.com/LeandroTorres26/Easy-Upload/issues>.
