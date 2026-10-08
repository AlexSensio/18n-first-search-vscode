'use strict';

// Parsers tolerantes para arquivos de tradução: JSON (com comentários / vírgula
// sobrando), objetos JS/TS (`export default {...}`, `module.exports = {...}`) e YAML simples.
// Sem dependências e sem `vscode`, para poder ser testado direto com node.

// ---------------------------------------------------------------------------
// Objeto literal JS/JSON tolerante
// ---------------------------------------------------------------------------

class LiteralParser {
  constructor(text, start) {
    this.s = text;
    this.i = start;
  }

  skipWs() {
    const s = this.s;
    for (;;) {
      const c = s[this.i];
      if (c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '﻿') this.i++;
      else if (c === '/' && s[this.i + 1] === '/') {
        while (this.i < s.length && s[this.i] !== '\n') this.i++;
      } else if (c === '/' && s[this.i + 1] === '*') {
        const end = s.indexOf('*/', this.i + 2);
        this.i = end === -1 ? s.length : end + 2;
      } else return;
    }
  }

  parseValue() {
    this.skipWs();
    const c = this.s[this.i];
    let value;
    if (c === '{') value = this.parseObject();
    else if (c === '[') value = this.parseArray();
    else if (c === '"' || c === "'" || c === '`') value = this.parseString();
    else {
      this.skipExpression();
      return undefined;
    }
    // `'a' + b`, chamadas, etc.: se o valor não termina em , } ] descarta a expressão.
    this.skipWs();
    const n = this.s[this.i];
    if (n !== ',' && n !== '}' && n !== ']' && n !== undefined) {
      this.skipExpression();
      return undefined;
    }
    return value;
  }

  parseObject() {
    const obj = {};
    this.i++; // {
    for (;;) {
      this.skipWs();
      const c = this.s[this.i];
      if (c === undefined) return obj;
      if (c === '}') {
        this.i++;
        return obj;
      }
      if (c === ',') {
        this.i++;
        continue;
      }
      let key;
      if (c === '"' || c === "'" || c === '`') key = this.parseString();
      else {
        const m = /^[^\s:,{}\[\]()'"`]+/.exec(this.s.slice(this.i, this.i + 256));
        if (!m) {
          this.i++;
          continue;
        }
        key = m[0];
        this.i += key.length;
      }
      this.skipWs();
      if (this.s[this.i] !== ':') {
        // shorthand, spread, método: ignora até a próxima vírgula
        this.skipExpression();
        continue;
      }
      this.i++;
      const value = this.parseValue();
      if (value !== undefined) obj[key] = value;
    }
  }

  parseArray() {
    const arr = [];
    this.i++; // [
    for (;;) {
      this.skipWs();
      const c = this.s[this.i];
      if (c === undefined) return arr;
      if (c === ']') {
        this.i++;
        return arr;
      }
      if (c === ',') {
        this.i++;
        continue;
      }
      arr.push(this.parseValue());
    }
  }

  parseString() {
    const s = this.s;
    const q = s[this.i++];
    let out = '';
    while (this.i < s.length) {
      const c = s[this.i++];
      if (c === q) return out;
      if (c === '\\') {
        const e = s[this.i++];
        switch (e) {
          case 'n': out += '\n'; break;
          case 't': out += '\t'; break;
          case 'r': out += '\r'; break;
          case 'b': out += '\b'; break;
          case 'f': out += '\f'; break;
          case 'v': out += '\v'; break;
          case '0': out += '\0'; break;
          case '\n': break; // continuação de linha
          case 'u': {
            if (s[this.i] === '{') {
              const end = s.indexOf('}', this.i);
              out += String.fromCodePoint(parseInt(s.slice(this.i + 1, end), 16));
              this.i = end + 1;
            } else {
              out += String.fromCharCode(parseInt(s.slice(this.i, this.i + 4), 16));
              this.i += 4;
            }
            break;
          }
          case 'x':
            out += String.fromCharCode(parseInt(s.slice(this.i, this.i + 2), 16));
            this.i += 2;
            break;
          default: out += e;
        }
      } else out += c;
    }
    return out;
  }

  // Avança até a próxima vírgula / fechamento no nível atual, respeitando strings e aninhamento.
  skipExpression() {
    const s = this.s;
    let depth = 0;
    while (this.i < s.length) {
      const c = s[this.i];
      if (c === '"' || c === "'" || c === '`') {
        this.parseString();
        continue;
      }
      if (c === '/' && (s[this.i + 1] === '/' || s[this.i + 1] === '*')) {
        this.skipWs();
        continue;
      }
      if (c === '{' || c === '[' || c === '(') depth++;
      else if (c === '}' || c === ']' || c === ')') {
        if (depth === 0) return;
        depth--;
      } else if (c === ',' && depth === 0) return;
      this.i++;
    }
  }
}

// Procura onde começa o objeto de traduções num arquivo JS/TS.
const JS_ROOT_PATTERNS = [
  /export\s+default\s*(?:\(\s*)?\{/,
  /module\.exports\s*=\s*\{/,
  /exports\.\w+\s*=\s*\{/,
  /\b(?:const|let|var)\s+[\w$]+\s*(?::[^=\n]+)?=\s*(?:\(\s*)?\{/,
  /=\s*\{/,
];

function parseJsLike(text) {
  let best = -1;
  for (const re of JS_ROOT_PATTERNS) {
    const m = re.exec(text);
    if (m) {
      const idx = m.index + m[0].lastIndexOf('{');
      best = idx;
      break;
    }
  }
  if (best === -1) {
    best = text.indexOf('{');
    if (best === -1) return {};
  }
  return new LiteralParser(text, best).parseObject();
}

function parseJson(text) {
  try {
    return JSON.parse(text.replace(/^﻿/, ''));
  } catch {
    const start = text.indexOf('{');
    return start === -1 ? {} : new LiteralParser(text, start).parseObject();
  }
}

// ---------------------------------------------------------------------------
// YAML simples (mapas aninhados, listas, escalares, block scalars)
// ---------------------------------------------------------------------------

function parseYaml(text) {
  const lines = [];
  for (const raw of text.replace(/^﻿/, '').split(/\r?\n/)) {
    if (!raw.trim() || /^\s*#/.test(raw)) continue;
    if (/^(---|\.\.\.)\s*$/.test(raw)) continue;
    const indent = raw.length - raw.trimStart().length;
    lines.push({ indent, text: raw.trim() });
  }
  let i = 0;

  const isSeq = (l) => l.text === '-' || l.text.startsWith('- ');

  function splitKey(t) {
    const m = /^("(?:[^"\\]|\\.)*"|'(?:[^']|'')*'|[^:]+?)\s*:(?:\s+(.*)|)$/.exec(t);
    if (!m) return null;
    let key = m[1];
    if (key[0] === '"') key = scalar(key);
    else if (key[0] === "'") key = key.slice(1, -1).replace(/''/g, "'");
    return { key, rest: m[2] || '' };
  }

  function scalar(v) {
    v = v.trim();
    if (v[0] === '"') {
      const m = /^"((?:[^"\\]|\\.)*)"/.exec(v);
      if (m) {
        try {
          return JSON.parse('"' + m[1] + '"');
        } catch {
          return m[1];
        }
      }
    }
    if (v[0] === "'") {
      const m = /^'((?:[^']|'')*)'/.exec(v);
      if (m) return m[1].replace(/''/g, "'");
    }
    v = v.replace(/\s+#.*$/, '');
    if (v === '~' || v === 'null') return null;
    return v;
  }

  function parseNode() {
    const first = lines[i];
    return isSeq(first) ? parseSeq(first.indent) : parseMap(first.indent);
  }

  function parseSeq(ind) {
    const arr = [];
    while (i < lines.length && lines[i].indent === ind && isSeq(lines[i])) {
      const rest = lines[i].text.slice(1).trim();
      if (!rest) {
        i++;
        arr.push(i < lines.length && lines[i].indent > ind ? parseNode() : null);
      } else if (splitKey(rest)) {
        // "- chave: valor" -> mapa inline; reescreve a linha como se fosse um bloco indentado
        const offset = lines[i].text.length - rest.length;
        lines[i] = { indent: ind + offset, text: rest };
        arr.push(parseMap(ind + offset));
      } else {
        i++;
        arr.push(scalar(rest));
      }
    }
    return arr;
  }

  function parseMap(ind) {
    const obj = {};
    while (i < lines.length && lines[i].indent === ind && !isSeq(lines[i])) {
      const kv = splitKey(lines[i].text);
      i++;
      if (!kv) continue;
      const rest = kv.rest.trim();
      if (rest === '' || rest.startsWith('#')) {
        if (i < lines.length && (lines[i].indent > ind || (lines[i].indent === ind && isSeq(lines[i])))) {
          obj[kv.key] = parseNode();
        } else obj[kv.key] = null;
      } else if (/^[|>][+-]?\d*\s*(#.*)?$/.test(rest)) {
        const folded = rest[0] === '>';
        const parts = [];
        while (i < lines.length && lines[i].indent > ind) parts.push(lines[i++].text);
        obj[kv.key] = parts.join(folded ? ' ' : '\n');
      } else {
        let value = rest;
        // string entre aspas que continua nas linhas seguintes
        const q = value[0];
        const closed = (v) => (q === '"' ? /^"(?:[^"\\]|\\.)*"/.test(v) : /^'(?:[^']|'')*'/.test(v));
        if ((q === '"' || q === "'") && !closed(value)) {
          while (i < lines.length && lines[i].indent > ind && !closed(value)) value += ' ' + lines[i++].text;
        } else {
          // escalar simples em várias linhas
          while (i < lines.length && lines[i].indent > ind && !splitKey(lines[i].text)) value += ' ' + lines[i++].text;
        }
        obj[kv.key] = scalar(value);
      }
    }
    // linhas com indentação diferente do esperado: descarta para não travar
    if (i < lines.length && lines[i].indent > ind) i++;
    return obj;
  }

  const root = {};
  while (i < lines.length) {
    const before = i;
    const node = parseNode();
    if (Array.isArray(node)) root['0'] = node;
    else Object.assign(root, node);
    if (i === before) i++;
  }
  return root;
}

// ---------------------------------------------------------------------------
// Flatten
// ---------------------------------------------------------------------------

const LOCALE_RE = /^[a-z]{2,3}([-_][A-Za-z0-9]{2,4})?$/;

function isPlain(v) {
  return v !== null && typeof v === 'object';
}

/**
 * Converte o objeto em [{ key, value }] com chaves pontuadas.
 * Se todas as chaves do topo forem códigos de idioma (`pt-BR`, `en`...), o idioma é
 * removido do caminho da chave (é assim que o código as referencia).
 */
function flatten(root) {
  const out = [];
  const walk = (node, prefix) => {
    if (typeof node === 'string') {
      out.push({ key: prefix, value: node });
    } else if (Array.isArray(node)) {
      node.forEach((v, idx) => walk(v, prefix ? `${prefix}.${idx}` : String(idx)));
    } else if (isPlain(node)) {
      for (const k of Object.keys(node)) walk(node[k], prefix ? `${prefix}.${k}` : k);
    }
  };
  if (!isPlain(root)) return out;
  const topKeys = Object.keys(root);
  const localeRoot = topKeys.length > 0 && topKeys.every((k) => LOCALE_RE.test(k) && isPlain(root[k]));
  if (localeRoot) for (const k of topKeys) walk(root[k], '');
  else walk(root, '');
  return out;
}

function parseTranslations(fileName, text) {
  const ext = (/\.([^.\\/]+)$/.exec(fileName) || [])[1];
  let obj;
  switch ((ext || '').toLowerCase()) {
    case 'json':
    case 'jsonc':
      obj = parseJson(text);
      break;
    case 'yaml':
    case 'yml':
      obj = parseYaml(text);
      break;
    default:
      obj = parseJsLike(text);
  }
  return flatten(obj);
}

module.exports = { parseTranslations, parseJson, parseJsLike, parseYaml, flatten };
