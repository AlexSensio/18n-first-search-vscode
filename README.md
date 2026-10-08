# i18n First Search

Mantém a busca **nativa** do VS Code (`Ctrl+F` e `Ctrl+Shift+F`, mesmo layout, mesmos atalhos).
Você digita normalmente o texto que vê na tela (ex.: `Data de revisão`) e aperta **Enter**:
se esse texto for uma tradução, a extensão troca a busca pelas **chaves** correspondentes
(ex.: `ITEM.CLIENTS.REVIEW_DATE`) — no arquivo atual (`Ctrl+F`) ou no projeto (`Ctrl+Shift+F`).

## Como funciona por baixo dos panos

No Enter, a extensão copia o que está na caixa de busca, procura nos arquivos de i18n e, se achar,
refaz a busca nativa com um regex das chaves (modo regex ligado). Se o texto não for uma tradução,
o Enter se comporta como sempre (próximo resultado / buscar).

Ela **não** troca a busca quando:
- o texto tem menos de 3 caracteres (`i18nSearch.minQueryLength`);
- o texto já é uma chave i18n;
- o texto não aparece em nenhuma tradução.

Entram na busca todas as chaves cujo texto **ou nome** contém o que você digitou (`_`, `.` e `-` valem como espaço: `review date` acha `REVIEW_DATE`) (ex.: `Descrição` pega `FORM.DESCRIPTION` e `FORM.DESCRIPTION_PLACEHOLDER`).
O texto digitado também entra na busca (sem diferenciar maiúsculas), no `Ctrl+F` e no `Ctrl+Shift+F`, para achar textos fixos e usos fora de arquivos Angular.

## Instalação

```bash
code --install-extension ~/Downloads/i18n-first-search/i18n-first-search-0.3.2.vsix
```

ou copie a pasta para `~/.vscode/extensions/` e reinicie o VS Code, ou abra a pasta no VS Code e aperte `F5`.

> Se a extensão `angular-i18n-smart-search` estiver instalada, desinstale: ela também toma o `Ctrl+Shift+F`.


## Arquivos de tradução

Formatos: **JSON** (aceita comentários e vírgula sobrando), **YAML**, e **JS/TS** com
`export default { … }`, `module.exports = { … }` ou `const x = { … }`.
Chaves aninhadas viram `A.B.C`; se o topo do arquivo for o idioma (`{ "pt-BR": { … } }`), o idioma é descartado.
Sufixos de plural do i18next (`_one`, `_other`…) são agrupados na chave base.

Por padrão procura em `**/{locale,locales,i18n,lang,langs,translations}/**/*.{json,yaml,yml}` e em arquivos
`*pt-BR*.{json,js,ts}`. Ajuste em `i18nSearch.localeFiles` se os seus ficarem em outro lugar.
O índice é reconstruído sozinho quando um desses arquivos muda.

## Configurações (`i18nSearch.*`)

| Configuração | Padrão | O que faz |
|---|---|---|
| `enabled` | `true` | Intercepta `Ctrl+F` / `Ctrl+Shift+F`. Desligado = comportamento original. |
| `localeFiles` | ver acima | Globs dos arquivos de tradução. |
| `exclude` | `node_modules`, `.git`, `dist`… | Globs ignorados. |
| `matchMode` | `strict` | `strict`: a chave não pode ser parte de outra (`SAVE` não casa em `BTN.SAVE` nem `SAVE_ALL`). `loose`: casa em qualquer lugar. |
| `includeLiteralTextInProject` | `true` | `Ctrl+Shift+F`: além das chaves, busca o próprio texto digitado (sem diferenciar maiúsculas). |
| `includeLiteralTextInFile` | `true` | O mesmo para o `Ctrl+F`. |
| `maxKeys` | `300` | Limite de chaves no regex ao escolher muitas chaves. |
| `excludeLocaleFilesFromGlobalSearch` | `true` | Tira os próprios arquivos de tradução dos resultados da busca global. |

Comandos (Ctrl+Shift+P → `i18n:`): reindexar arquivos de tradução, ligar/desligar a tradução de buscas.

## Limitações

- A extensão API do VS Code não deixa observar a caixa enquanto você digita; a troca acontece no **Enter**.
- Depois da troca, a caixa mostra o regex das chaves (modo regex + diferenciar maiúsculas ligados).
  Apertar Enter de novo funciona como "próximo resultado" (o regex gerado é reconhecido e deixado em paz).
  Para buscar o texto puro, desligue com `i18n: Ligar/desligar tradução de buscas`.
- Chaves montadas dinamicamente (`` `STATUS.${x}` ``) não são encontradas.
- No Enter, o clipboard é usado rapidamente (e restaurado) para ler a caixa de busca.

## Desenvolvimento

```bash
npm test          # testes dos parsers / busca / regex
npm run package   # gera o .vsix
```
