'use strict';

const vscode = require('vscode');
const { LocaleIndex } = require('./localeIndex');
const { collectKeys, buildPattern, resolveQuery } = require('./search');

const SENTINEL = '\u0000i18n-first-search\u0000';

let localeIndex;
let busy = false;
let lastPattern = '';

const cfg = () => vscode.workspace.getConfiguration('i18nSearch');
const exec = (cmd, ...args) => vscode.commands.executeCommand(cmd, ...args);

/**
 * Lê o texto da caixa nativa (busca do editor ou do painel de pesquisa) que está com o foco:
 * seleciona tudo + copia, lê o clipboard, e "cola de volta" para o cursor ficar no fim sem seleção.
 * O clipboard original é restaurado. Retorna null se não conseguiu ler.
 */
async function readFocusedInput() {
  const clip = vscode.env.clipboard;
  const previous = await clip.readText();
  try {
    await clip.writeText(SENTINEL);
    await exec('editor.action.selectAll');
    await exec('editor.action.clipboardCopyAction');
    const text = await clip.readText();
    if (text === SENTINEL) return null; // nada foi copiado: não cola para não inserir o marcador
    await exec('editor.action.clipboardPasteAction');
    return text;
  } finally {
    await clip.writeText(previous);
  }
}

/** Enter na caixa de busca. scope: 'file' (Ctrl+F) | 'global' (Ctrl+Shift+F). */
async function onEnter(scope) {
  const inFile = scope === 'file';
  const nativeEnter = () => (inFile ? exec('editor.action.nextMatchFindAction') : undefined);
  if (busy) return;
  busy = true;
  try {
    const config = cfg();
    let text;
    try {
      text = await readFocusedInput();
    } catch {
      text = null;
    }
    if (!text || text === lastPattern || text.includes('\n')) return nativeEnter();

    let resolved = null;
    try {
      const index = await localeIndex.load();
      resolved = resolveQuery(index, text, {
        maxKeys: config.get('maxKeys', 300),
        minLength: config.get('minQueryLength', 3),
      });
    } catch {
      /* índice indisponível: segue com a busca nativa */
    }
    if (!resolved) return nativeEnter();

    const pattern = buildPattern(collectKeys(resolved.groups), {
      strict: config.get('matchMode', 'strict') === 'strict',
      literal: config.get(inFile ? 'includeLiteralTextInFile' : 'includeLiteralTextInProject', true) ? text.trim() : '',
    });
    lastPattern = pattern;

    const shown = resolved.groups.slice(0, 2).map((g) => g.key).join(', ');
    vscode.window.setStatusBarMessage(
      `i18n: «${text.trim()}» → ${resolved.groups.length} chave(s): ${shown}${resolved.groups.length > 2 ? ', …' : ''}` +
        (resolved.truncated ? ` (limitado a ${config.get('maxKeys', 300)})` : ''),
      8000
    );

    if (inFile) {
      await exec('editor.actions.findWithArgs', {
        searchString: pattern,
        isRegex: true,
        isCaseSensitive: true,
        matchWholeWord: false,
        findInSelection: false,
      });
    } else {
      const args = { query: pattern, isRegex: true, isCaseSensitive: true, matchWholeWord: false, triggerSearch: true };
      if (config.get('excludeLocaleFilesFromGlobalSearch', true)) {
        args.filesToExclude = config.get('localeFiles', []).join(',');
      }
      await exec('workbench.action.findInFiles', args);
    }
  } catch (err) {
    vscode.window.setStatusBarMessage(`i18n: erro (${err && err.message}) — busca nativa mantida`, 6000);
    if (inFile) await exec('editor.action.nextMatchFindAction');
  } finally {
    busy = false;
  }
}

function activate(context) {
  localeIndex = new LocaleIndex();
  const reg = (id, fn) => context.subscriptions.push(vscode.commands.registerCommand(id, fn));
  context.subscriptions.push(localeIndex);

  reg('i18nSearch.enterInFind', () => onEnter('file'));
  reg('i18nSearch.enterInSearch', () => onEnter('global'));
  reg('i18nSearch.reindex', async () => {
    localeIndex.invalidate(true);
    const index = await localeIndex.load();
    vscode.window.showInformationMessage(
      `i18n Search: ${index.size} chaves em ${index.fileCount} arquivo(s) de tradução.`
    );
  });
  reg('i18nSearch.toggleEnabled', async () => {
    const next = !cfg().get('enabled', true);
    await cfg().update('enabled', next, vscode.ConfigurationTarget.Global);
    vscode.window.setStatusBarMessage(`i18n Search: ${next ? 'ligado' : 'desligado'}`, 4000);
  });

  // Pré-carrega o índice sem atrasar o primeiro Enter.
  localeIndex.load().catch(() => {});
}

function deactivate() {}

module.exports = { activate, deactivate };
