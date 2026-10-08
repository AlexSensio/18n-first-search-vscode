'use strict';

// Lógica pura de busca: índice de chaves, ranking e montagem do regex final.

const SEPARATORS = /[._\-\s]+/g;
const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;

function normalize(s) {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

function escapeRegex(s) {
  // Sem escapar "-" ou "/": o find do VS Code usa o flag `u`, onde "\-" fora de classe é inválido.
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Índice: chave (sem sufixo de plural) -> grupo com todos os textos dessa chave. */
class KeyIndex {
  constructor() {
    this.groups = new Map();
    this.fileCount = 0;
  }

  addFile(file, entries) {
    this.fileCount++;
    for (const { key, value } of entries) {
      const base = key.replace(PLURAL_SUFFIX, '');
      let g = this.groups.get(base);
      if (!g) {
        g = { key: base, keyNorm: normalize(base).replace(SEPARATORS, ' '), rawKeys: new Set(), items: [] };
        this.groups.set(base, g);
      }
      g.rawKeys.add(key);
      g.items.push({ value, norm: normalize(value), file });
    }
  }

  get size() {
    return this.groups.size;
  }
}

function termsOf(query) {
  return normalize(query).split(/\s+/).filter(Boolean);
}

// Menor = melhor.
function scoreText(norm, terms, joined) {
  if (!terms.every((t) => norm.includes(t))) return Infinity;
  if (norm === joined) return 0;
  if (norm.startsWith(joined)) return 1;
  if (norm.includes(joined)) return 2;
  return 3;
}

/**
 * Procura o texto nos valores (e nas chaves) do índice.
 * Retorna [{ group, item, score, others }] ordenado por relevância.
 */
function searchIndex(index, query) {
  const terms = termsOf(query);
  if (!terms.length) return [];
  const joined = terms.join(' ');
  // chaves: "_", "." e "-" valem como espaço (review date -> ITEM.CLIENTS.REVIEW_DATE)
  const keyTerms = termsOf(query.replace(SEPARATORS, ' '));
  const keyJoined = keyTerms.join(' ');
  const results = [];
  for (const group of index.groups.values()) {
    let best = null;
    let bestScore = Infinity;
    let hits = 0;
    for (const item of group.items) {
      const sc = scoreText(item.norm, terms, joined);
      if (sc !== Infinity) {
        hits++;
        if (sc < bestScore) {
          bestScore = sc;
          best = item;
        }
      }
    }
    if (best === null) {
      const sc = scoreText(group.keyNorm, keyTerms, keyJoined);
      if (sc === Infinity) continue;
      bestScore = 4 + sc;
      best = group.items[0];
      hits = 1;
    }
    results.push({ group, item: best, score: bestScore, others: hits - 1 });
  }
  results.sort(
    (a, b) =>
      a.score - b.score ||
      a.item.value.length - b.item.value.length ||
      (a.group.key < b.group.key ? -1 : 1)
  );
  return results;
}

/** Todas as formas pelas quais o código pode referenciar essas chaves. */
function collectKeys(groups) {
  const set = new Set();
  for (const g of groups) {
    set.add(g.key);
    for (const k of g.rawKeys) set.add(k);
  }
  return [...set];
}

/**
 * Monta o regex (sintaxe compatível com o find do editor e com o ripgrep do VS Code).
 * strict: a chave não pode fazer parte de outra (ex.: `SAVE` dentro de `BUTTONS.SAVE`).
 */
function buildPattern(keys, { strict = true, literal = '' } = {}) {
  const alt = [...keys]
    .sort((a, b) => b.length - a.length)
    .map(escapeRegex)
    .join('|');
  let pattern;
  if (!alt) pattern = '';
  else if (strict) pattern = `(?<![\\w.\\-])(?:${alt})(?![\\w\\-]|\\.[\\w\\-])`;
  else pattern = alt;
  if (literal) {
    // (?i:…) = o texto digitado ignora maiúsculas/minúsculas mesmo com a busca "Aa" ligada
    const lit = `(?i:${escapeRegex(literal)})`;
    pattern = pattern ? `${lit}|${pattern}` : lit;
  }
  return pattern;
}

/**
 * Decide quais chaves buscar para o texto digitado na busca nativa.
 * Casa o texto digitado com o *valor* (o texto da tela) e com o nome da chave: "Descrição"
 * pega também "Digite a descrição"; "description" pega POS_PAGE.FORM.DESCRIPTION*.
 * Retorna null (busca nativa segue normal) se for curto demais, se já for exatamente uma
 * chave, ou se não casar com nada.
 */
function resolveQuery(index, text, { maxKeys = 300, minLength = 3 } = {}) {
  text = text.trim();
  if (text.length < minLength || index.groups.has(text)) return null;
  const results = searchIndex(index, text);
  if (!results.length) return null;
  return { groups: results.slice(0, maxKeys).map((r) => r.group), truncated: results.length > maxKeys };
}

module.exports = { KeyIndex, searchIndex, collectKeys, buildPattern, resolveQuery, normalize, escapeRegex };
