'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseTranslations } = require('../src/parsers');
const { KeyIndex, searchIndex, collectKeys, buildPattern } = require('../src/search');

test('json aninhado vira chaves pontuadas', () => {
  const r = parseTranslations('pt-BR.json', JSON.stringify({ ITEM: { CLIENTS: { REVIEW_DATE: 'Data de revisão' } }, OK: 'Ok' }));
  assert.deepEqual(r, [
    { key: 'ITEM.CLIENTS.REVIEW_DATE', value: 'Data de revisão' },
    { key: 'OK', value: 'Ok' },
  ]);
});

test('json com comentários e vírgula sobrando', () => {
  const r = parseTranslations('x.json', '{\n // c\n "A": "1", /* x */ "B": {"C": "2",},\n}');
  assert.deepEqual(r.map((e) => e.key), ['A', 'B.C']);
});

test('raiz com idioma é removida da chave', () => {
  const r = parseTranslations('i.json', JSON.stringify({ 'pt-BR': { A: { B: 'x' } }, en: { A: { B: 'y' } } }));
  assert.deepEqual(r.map((e) => e.key), ['A.B', 'A.B']);
});

test('js: export default / module.exports / const + expressões ignoradas', () => {
  const js1 = `// pt-BR\nexport default {\n  HOME: { TITLE: 'Início', MSG: "Olá, \\"mundo\\"" },\n  dyn: foo(1,2),\n  cat: 'a' + 'b',\n  arr: ['x', 'y'],\n  tpl: \`Texto\`,\n  AFTER: 'depois',\n};`;
  const r1 = Object.fromEntries(parseTranslations('pt-BR.js', js1).map((e) => [e.key, e.value]));
  assert.equal(r1['HOME.TITLE'], 'Início');
  assert.equal(r1['HOME.MSG'], 'Olá, "mundo"');
  assert.equal(r1['arr.1'], 'y');
  assert.equal(r1['tpl'], 'Texto');
  assert.equal(r1['AFTER'], 'depois');
  assert.ok(!('dyn' in r1) && !('cat' in r1));

  const js2 = `import x from 'y';\nconst messages: any = {\n A: 'um',\n};\nmodule.exports = messages;`;
  assert.deepEqual(parseTranslations('a.ts', js2), [{ key: 'A', value: 'um' }]);
  assert.deepEqual(parseTranslations('a.js', `module.exports = { A: { B: 'c' } };`), [{ key: 'A.B', value: 'c' }]);
});

test('yaml: mapas, aspas, block scalar, lista e raiz de idioma', () => {
  const y = [
    'pt-BR:',
    '  home:',
    '    title: Início # comentário',
    '    quoted: "Com: dois pontos"',
    "    single: 'It''s'",
    '    long: |',
    '      linha 1',
    '      linha 2',
    '  list:',
    '    - um',
    '    - dois',
    '  other: fim',
  ].join('\n');
  const r = Object.fromEntries(parseTranslations('pt.yml', y).map((e) => [e.key, e.value]));
  assert.equal(r['home.title'], 'Início');
  assert.equal(r['home.quoted'], 'Com: dois pontos');
  assert.equal(r['home.single'], "It's");
  assert.equal(r['home.long'], 'linha 1\nlinha 2');
  assert.equal(r['list.1'], 'dois');
  assert.equal(r['other'], 'fim');
});

function makeIndex() {
  const idx = new KeyIndex();
  idx.addFile('pt-BR.json', parseTranslations('pt-BR.json', JSON.stringify({
    BTN: { SAVE: 'Salvar', SAVE_ALL: 'Salvar tudo' },
    ITEM: { CLIENTS: { REVIEW_DATE: 'Data de revisão' } },
    COUNT_one: '1 item',
    COUNT_other: '{{n}} itens',
  })));
  idx.addFile('en.json', parseTranslations('en.json', JSON.stringify({ BTN: { SAVE: 'Save' } })));
  return idx;
}

test('busca ignora acento/caixa e ordena exato primeiro', () => {
  const idx = makeIndex();
  const r = searchIndex(idx, 'salvar');
  assert.deepEqual(r.map((x) => x.group.key), ['BTN.SAVE', 'BTN.SAVE_ALL']);
  assert.deepEqual(searchIndex(idx, 'REVISAO').map((x) => x.group.key), ['ITEM.CLIENTS.REVIEW_DATE']);
  assert.deepEqual(searchIndex(idx, 'revisão data').map((x) => x.group.key), ['ITEM.CLIENTS.REVIEW_DATE']);
  assert.deepEqual(searchIndex(idx, 'clients.review').map((x) => x.group.key), ['ITEM.CLIENTS.REVIEW_DATE']);
  assert.equal(searchIndex(idx, 'inexistente').length, 0);
});

test('sufixo de plural é agrupado na chave base', () => {
  const idx = makeIndex();
  const r = searchIndex(idx, 'itens');
  assert.equal(r[0].group.key, 'COUNT');
  assert.deepEqual(collectKeys([r[0].group]).sort(), ['COUNT', 'COUNT_one', 'COUNT_other']);
});

test('regex strict: acha em código/templates e não casa dentro de outras chaves', () => {
  const idx = makeIndex();
  const keys = collectKeys(searchIndex(idx, 'Salvar').filter((x) => x.group.key === 'BTN.SAVE').map((x) => x.group));
  // o editor usa o flag "u"; o ripgrep aceita a mesma sintaxe
  const re = new RegExp(buildPattern(keys), 'gu');
  const code = [
    `<button>{{ 'BTN.SAVE' | translate }}</button>`,
    `this.t.instant("BTN.SAVE");`,
    `translate.get('app:BTN.SAVE')`,
    `'BTN.SAVE_ALL'`,
    `'X.BTN.SAVE'`,
    `'BTN.SAVE.DEEP'`,
  ];
  const hit = code.map((l) => { re.lastIndex = 0; return re.test(l); });
  assert.deepEqual(hit, [true, true, true, false, false, false]);
});

test('regex loose, escape de caracteres especiais e texto literal', () => {
  const lit = buildPattern(['a.b'], { strict: false, literal: 'Olá?' });
  assert.equal(lit, '(?i:Olá\\?)|a\\.b'); // literal primeiro, ignorando caixa
  const re = new RegExp(buildPattern(['a.b', 'a(c)'], { strict: false }), 'gu');
  assert.ok(re.test('x a.b y'));
  re.lastIndex = 0;
  assert.ok(!re.test('x aXb y'));
  re.lastIndex = 0;
  assert.ok(re.test('a(c)'));
});

test('resolveQuery: casa valor e chave, chave/curto/sem match = null', () => {
  const { resolveQuery } = require('../src/search');
  const idx = makeIndex();
  assert.deepEqual(resolveQuery(idx, 'Salvar').groups.map((g) => g.key), ['BTN.SAVE', 'BTN.SAVE_ALL']);
  assert.deepEqual(resolveQuery(idx, 'salv').groups.map((g) => g.key).sort(), ['BTN.SAVE', 'BTN.SAVE_ALL']);
  assert.equal(resolveQuery(idx, 'BTN.SAVE'), null); // já é uma chave
  assert.deepEqual(resolveQuery(idx, 'BTN.SAV').groups.map((g) => g.key).sort(), ['BTN.SAVE', 'BTN.SAVE_ALL']); // pela chave
  assert.deepEqual(resolveQuery(idx, 'review date').groups.map((g) => g.key), ['ITEM.CLIENTS.REVIEW_DATE']); // _ vale como espaço
  assert.deepEqual(resolveQuery(idx, 'clients').groups.map((g) => g.key), ['ITEM.CLIENTS.REVIEW_DATE']);
  assert.equal(resolveQuery(idx, 'sa'), null); // curto demais
  assert.equal(resolveQuery(idx, 'function'), null);
  assert.equal(resolveQuery(idx, 'salv', { maxKeys: 1 }).truncated, true);
});
