// tests/test-project-model.ts

import * as assert from 'assert';
import * as path from 'path';
import {
  normalizeStem,
  detectPairsFromPaths,
  parseCmakePairs,
  generatedCandidates,
} from '../server/src/project/projectScanner';
import { WorkspaceIndex } from '../server/src/project/projectModel';

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void | Promise<void>): Promise<void> {
  return Promise.resolve()
    .then(() => fn())
    .then(() => { console.log(`  ✓ ${name}`); passed++; })
    .catch((e: unknown) => { console.log(`  ✗ ${name}: ${(e as Error).message}`); failed++; });
}

async function run(): Promise<void> {
  console.log('ProjectModel — pure functions');

  // ── normalizeStem ──────────────────────────────────────────────────────────

  await test('normalizeStem: plain name unchanged', () => {
    assert.strictEqual(normalizeStem('calc'), 'calc');
  });

  await test('normalizeStem: strips _parser suffix', () => {
    assert.strictEqual(normalizeStem('sql_parser'), 'sql');
  });

  await test('normalizeStem: strips _scanner suffix', () => {
    assert.strictEqual(normalizeStem('sql_scanner'), 'sql');
  });

  // ── detectPairsFromPaths ───────────────────────────────────────────────────

  console.log('\nProjectModel — detectPairsFromPaths');

  await test('same-basename pair: calc.y + calc.l', () => {
    const pairs = detectPairsFromPaths(['/src/calc.y'], ['/src/calc.l']);
    assert.strictEqual(pairs.length, 1, 'expected one pair');
    assert.strictEqual(pairs[0].source, 'basename');
    assert.ok(pairs[0].reason.includes('calc'), `reason should mention 'calc', got: ${pairs[0].reason}`);
  });

  await test('normalized-stem pair: sql_parser.y + sql_scanner.l', () => {
    const pairs = detectPairsFromPaths(['/src/sql_parser.y'], ['/src/sql_scanner.l']);
    assert.strictEqual(pairs.length, 1, 'expected one pair');
    assert.strictEqual(pairs[0].source, 'normalized-stem');
  });

  await test('no pair: foo.y + bar.l', () => {
    const pairs = detectPairsFromPaths(['/src/foo.y'], ['/src/bar.l']);
    assert.strictEqual(pairs.length, 0, 'expected no pairs');
  });

  // ── parseCmakePairs ────────────────────────────────────────────────────────

  console.log('\nProjectModel — parseCmakePairs');

  await test('CMake project-helper: add_flex_bison_dependency(calc calc.y calc.l)', () => {
    const content = [
      'cmake_minimum_required(VERSION 3.10)',
      'add_flex_bison_dependency(calc calc.y calc.l)',
    ].join('\n');
    const pairs = parseCmakePairs(content);
    assert.strictEqual(pairs.length, 1, 'expected one pair');
    assert.strictEqual(pairs[0].bisonFile, 'calc.y');
    assert.strictEqual(pairs[0].flexFile, 'calc.l');
  });

  await test('CMake standard: BISON_TARGET + FLEX_TARGET + ADD_FLEX_BISON_DEPENDENCY', () => {
    const content = [
      'BISON_TARGET(CalcParser calc.y /build/calc.tab.c)',
      'FLEX_TARGET(CalcScanner calc.l /build/lex.yy.c)',
      'ADD_FLEX_BISON_DEPENDENCY(CalcParser CalcScanner)',
    ].join('\n');
    const pairs = parseCmakePairs(content);
    assert.strictEqual(pairs.length, 1, 'expected one pair');
    assert.strictEqual(pairs[0].bisonFile, 'calc.y');
    assert.strictEqual(pairs[0].flexFile, 'calc.l');
  });

  // ── generatedCandidates ────────────────────────────────────────────────────

  console.log('\nProjectModel — generatedCandidates');

  await test('Bison GNU candidates: calc.tab.c and calc.tab.h', () => {
    const candidates = generatedCandidates('/src/calc.y', '/build', 'bison');
    const paths = candidates.map(c => c.fsPath);
    assert.ok(paths.includes(path.join('/build', 'calc.tab.c')), 'expected calc.tab.c');
    assert.ok(paths.includes(path.join('/build', 'calc.tab.h')), 'expected calc.tab.h');
    assert.ok(paths.includes(path.join('/build', 'calc.output')), 'expected calc.output');
  });

  await test('Bison Automake candidates: calc_tab.c and calc_tab.h', () => {
    const candidates = generatedCandidates('/src/calc.y', '/build', 'bison');
    const paths = candidates.map(c => c.fsPath);
    assert.ok(paths.includes(path.join('/build', 'calc_tab.c')), 'expected calc_tab.c');
    assert.ok(paths.includes(path.join('/build', 'calc_tab.h')), 'expected calc_tab.h');
  });

  await test('Flex candidates: lex.yy.c and lex.calc.c', () => {
    const candidates = generatedCandidates('/src/calc.l', '/build', 'flex');
    const paths = candidates.map(c => c.fsPath);
    assert.ok(paths.includes(path.join('/build', 'lex.yy.c')), 'expected lex.yy.c');
    assert.ok(paths.includes(path.join('/build', 'lex.calc.c')), 'expected lex.calc.c');
  });

  await test('generatedCandidates: undefined buildDir falls back to source dir', () => {
    const candidates = generatedCandidates('/src/calc.y', undefined, 'bison');
    const paths = candidates.map(c => c.fsPath);
    assert.ok(paths.includes(path.join('/src', 'calc.tab.c')), 'expected /src/calc.tab.c');
  });

  // ── WorkspaceIndex ─────────────────────────────────────────────────────────

  console.log('\nProjectModel — WorkspaceIndex');

  await test('empty workspace: getFlexFiles() returns [] without throwing', () => {
    const idx = new WorkspaceIndex('/root');
    const files = idx.getFlexFiles();
    assert.deepStrictEqual(files, []);
  });

  await test('empty workspace: initialize([]) resolves without throwing', async () => {
    const idx = new WorkspaceIndex('/root');
    await idx.initialize([]);
    assert.deepStrictEqual(idx.getAllPairs(), []);
  });

  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

run().catch(e => { console.error(e); process.exit(1); });
