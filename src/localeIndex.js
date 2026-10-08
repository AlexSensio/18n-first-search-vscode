'use strict';

const vscode = require('vscode');
const { parseTranslations } = require('./parsers');
const { KeyIndex } = require('./search');

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const CONCURRENCY = 16;

/** Mantém em memória as traduções dos arquivos de i18n; reconstrói sob demanda quando eles mudam. */
class LocaleIndex {
  constructor() {
    this._promise = null;
    this._watchers = [];
    this._disposables = [
      vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration('i18nSearch')) this.invalidate(true);
      }),
      vscode.workspace.onDidChangeWorkspaceFolders(() => this.invalidate(true)),
    ];
  }

  load() {
    if (!this._promise) {
      this._ensureWatchers();
      this._promise = this._scan().catch((err) => {
        this._promise = null;
        throw err;
      });
    }
    return this._promise;
  }

  invalidate(rewatch = false) {
    this._promise = null;
    if (rewatch) this._disposeWatchers();
  }

  _ensureWatchers() {
    if (this._watchers.length) return;
    const globs = vscode.workspace.getConfiguration('i18nSearch').get('localeFiles', []);
    for (const glob of globs) {
      const w = vscode.workspace.createFileSystemWatcher(glob);
      const onEvent = (uri) => {
        if (/[\\/](node_modules|\.git)[\\/]/.test(uri.fsPath)) return;
        this.invalidate();
      };
      this._watchers.push(w, w.onDidChange(onEvent), w.onDidCreate(onEvent), w.onDidDelete(onEvent));
    }
  }

  _disposeWatchers() {
    for (const w of this._watchers) w.dispose();
    this._watchers = [];
  }

  async _scan() {
    const cfg = vscode.workspace.getConfiguration('i18nSearch');
    const globs = cfg.get('localeFiles', []);
    const exclude = cfg.get('exclude', []);
    const excludeGlob = exclude.length ? `{${exclude.join(',')}}` : null;

    const uris = new Map();
    for (const glob of globs) {
      for (const uri of await vscode.workspace.findFiles(glob, excludeGlob, 5000)) uris.set(uri.toString(), uri);
    }

    const index = new KeyIndex();
    const list = [...uris.values()];
    for (let i = 0; i < list.length; i += CONCURRENCY) {
      const batch = await Promise.all(list.slice(i, i + CONCURRENCY).map((uri) => this._readOne(uri)));
      for (const r of batch) if (r) index.addFile(r.file, r.entries);
    }
    return index;
  }

  async _readOne(uri) {
    try {
      const bytes = await vscode.workspace.fs.readFile(uri);
      if (bytes.byteLength > MAX_FILE_BYTES) return null;
      const text = Buffer.from(bytes).toString('utf8');
      const entries = parseTranslations(uri.path, text);
      if (!entries.length) return null;
      return { file: vscode.workspace.asRelativePath(uri), entries };
    } catch {
      return null; // arquivo ilegível/ inválido: ignora
    }
  }

  dispose() {
    this._disposeWatchers();
    this._disposables.forEach((d) => d.dispose());
  }
}

module.exports = { LocaleIndex };
