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

function test(name: string, fn: () => void | Promise<void>): void {
  try {
    const result = fn();
    if (result && typeof (result as Promise<void>).then === 'function') {
      (result as Promise<void>).then(() => {
        console.log(`  [PASS] ${name}`);
        passed++;
      }).catch((e: unknown) => {
        console.error(`  [FAIL] ${name}: ${e}`);
        failed++;
      });
    } else {
      console.log(`  [PASS] ${name}`);
      passed++;
    }
  } catch (e) {
    console.error(`  [FAIL] ${name}: ${e}`);
    failed++;
  }
}

// ─── normalizeStem ────────────────────────────────────────────────────────────

console.log('\nnormalizeStem');

test('plain stem unchanged', () => {
  assert.strictEqual(normalizeStem('calc.y'), 'calc');
});

test('strips _parser suffix', () => {
  assert.strictEqual(normalizeStem('sql_parser.y'), 'sql');
});

test('strips _scanner suffix', () => {
  assert.strictEqual(normalizeStem('sql_scanner.l'), 'sql');
});

test('strips -parser suffix', () => {
  assert.strictEqual(normalizeStem('json-parser.yy'), 'json');
});

test('strips _lex suffix', () => {
  assert.strictEqual(normalizeStem('calc_lex.l'), 'calc');
});

test('strips _tab suffix', () => {
  assert.strictEqual(normalizeStem('calc_tab.c'), 'calc');
});

test('full path: extracts and normalizes', () => {
  assert.strictEqual(normalizeStem('/project/src/sql_parser.y'), 'sql');
});

test('no suffix to strip stays as-is', () => {
  assert.strictEqual(normalizeStem('myfile.y'), 'myfile');
});

// ─── detectPairsFromPaths: same basename ─────────────────────────────────────

console.log('\ndetectPairsFromPaths — same basename');

test('same basename pairs (source = basename)', () => {
  const result = detectPairsFromPaths(['/a/calc.y'], ['/b/calc.l']);
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].source, 'basename');
  assert.ok(result[0].reason.includes('calc'), `reason: ${result[0].reason}`);
  assert.strictEqual(result[0].bisonPath, '/a/calc.y');
  assert.strictEqual(result[0].flexPath, '/b/calc.l');
});

test('same basename with different extensions (.yy / .ll)', () => {
  const result = detectPairsFromPaths(['/a/json.yy'], ['/b/json.ll']);
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].source, 'basename');
});

// ─── detectPairsFromPaths: normalized stem ───────────────────────────────────

console.log('\ndetectPairsFromPaths — normalized stem');

test('sql_parser.y + sql_scanner.l → normalized-stem pair', () => {
  const result = detectPairsFromPaths(['/a/sql_parser.y'], ['/b/sql_scanner.l']);
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].source, 'normalized-stem');
  assert.ok(result[0].reason.includes('sql'), `reason: ${result[0].reason}`);
});


// ─── detectPairsFromPaths: no unrelated pair ─────────────────────────────────

console.log('\ndetectPairsFromPaths — no unrelated pair');

test('foo.y + bar.l → no pair', () => {
  const result = detectPairsFromPaths(['/a/foo.y'], ['/b/bar.l']);
  assert.strictEqual(result.length, 0);
});

test('multiple files — only matching stems paired', () => {
  const result = detectPairsFromPaths(
    ['/a/calc.y', '/a/xml.y'],
    ['/b/calc.l', '/b/json.l'],
  );
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].bisonPath, '/a/calc.y');
  assert.strictEqual(result[0].flexPath, '/b/calc.l');
});

// ─── parseCmakePairs ─────────────────────────────────────────────────────────

console.log('\nparseCmakePairs');

const cmakeUppercase = [
  'BISON_TARGET(MyParser parser.y output/parser.tab.c)',
  'FLEX_TARGET(MyScanner scanner.l output/scanner.cpp)',
  'ADD_FLEX_BISON_DEPENDENCY(MyScanner MyParser)',
].join('\n');

test('uppercase ADD_FLEX_BISON_DEPENDENCY', () => {
  const result = parseCmakePairs(cmakeUppercase);
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].bisonFile, 'parser.y');
  assert.strictEqual(result[0].flexFile, 'scanner.l');
});

const cmakeLowercase = [
  'bison_target(MyParser parser.y output/parser.tab.c)',
  'flex_target(MyScanner scanner.l output/scanner.cpp)',
  'add_flex_bison_dependency(MyScanner MyParser)',
].join('\n');

test('lowercase add_flex_bison_dependency', () => {
  const result = parseCmakePairs(cmakeLowercase);
  assert.strictEqual(result.length, 1);
  assert.strictEqual(result[0].bisonFile, 'parser.y');
  assert.strictEqual(result[0].flexFile, 'scanner.l');
});

const cmakeMixedCase = [
  'Bison_Target(MyParser parser.y output/parser.tab.c)',
  'Flex_Target(MyScanner scanner.l output/scanner.cpp)',
  'Add_Flex_Bison_Dependency(MyScanner MyParser)',
].join('\n');

test('mixed case Add_Flex_Bison_Dependency', () => {
  const result = parseCmakePairs(cmakeMixedCase);
  assert.strictEqual(result.length, 1);
});

test('no ADD_FLEX_BISON_DEPENDENCY → no pairs', () => {
  const result = parseCmakePairs('BISON_TARGET(P p.y out.c)\nFLEX_TARGET(F f.l out.cpp)');
  assert.strictEqual(result.length, 0);
});

test('mismatched target names → no pairs', () => {
  const result = parseCmakePairs([
    'BISON_TARGET(ParserA a.y out.c)',
    'FLEX_TARGET(ScannerB b.l out.cpp)',
    'ADD_FLEX_BISON_DEPENDENCY(ScannerX ParserY)',
  ].join('\n'));
  assert.strictEqual(result.length, 0);
});

// ─── generatedCandidates: Bison ───────────────────────────────────────────────

console.log('\ngeneratedCandidates — Bison');

test('bison: GNU .tab.c and .tab.h present', () => {
  const result = generatedCandidates('/src/calc.y', undefined, 'bison');
  const files = result.map(r => path.basename(r.file));
  assert.ok(files.includes('calc.tab.c'), 'missing calc.tab.c');
  assert.ok(files.includes('calc.tab.cpp'), 'missing calc.tab.cpp');
  assert.ok(files.includes('calc.tab.h'), 'missing calc.tab.h');
  assert.ok(files.includes('calc.output'), 'missing calc.output');
  assert.ok(files.includes('calc.xml'), 'missing calc.xml');
  assert.ok(files.includes('calc.gv'), 'missing calc.gv');
});

test('bison: automake _tab.c and _tab.h present', () => {
  const result = generatedCandidates('/src/calc.y', undefined, 'bison');
  const files = result.map(r => path.basename(r.file));
  assert.ok(files.includes('calc_tab.c'), 'missing calc_tab.c');
  assert.ok(files.includes('calc_tab.cpp'), 'missing calc_tab.cpp');
  assert.ok(files.includes('calc_tab.h'), 'missing calc_tab.h');
  assert.ok(files.includes('calc_tab.hpp'), 'missing calc_tab.hpp');
});

test('bison: buildDir overrides source directory', () => {
  const result = generatedCandidates('/src/calc.y', '/build', 'bison');
  assert.ok(result.every(r => r.file.startsWith('/build')), 'all files should be in /build');
});

// ─── generatedCandidates: Flex ───────────────────────────────────────────────

console.log('\ngeneratedCandidates — Flex');

test('flex: GNU lex.yy.c and lex.yy.cpp present', () => {
  const result = generatedCandidates('/src/calc.l', undefined, 'flex');
  const files = result.map(r => path.basename(r.file));
  assert.ok(files.includes('lex.yy.c'), 'missing lex.yy.c');
  assert.ok(files.includes('lex.yy.cpp'), 'missing lex.yy.cpp');
});

test('flex: automake lex.stem.c and lex.stem.cpp present', () => {
  const result = generatedCandidates('/src/calc.l', undefined, 'flex');
  const files = result.map(r => path.basename(r.file));
  assert.ok(files.includes('lex.calc.c'), 'missing lex.calc.c');
  assert.ok(files.includes('lex.calc.cpp'), 'missing lex.calc.cpp');
});

// ─── Empty WorkspaceIndex ─────────────────────────────────────────────────────

console.log('\nWorkspaceIndex — empty');

test('empty WorkspaceIndex: all queries return empty without throwing', () => {
  const idx = new WorkspaceIndex('');
  assert.deepStrictEqual(idx.getBisonFiles(), []);
  assert.deepStrictEqual(idx.getFlexFiles(), []);
  assert.deepStrictEqual(idx.getAllPairs(), []);
  assert.deepStrictEqual(idx.getBuildInfo(), []);
  assert.strictEqual(idx.getPairForBison('file:///x.y'), undefined);
  assert.strictEqual(idx.getPairForFlex('file:///x.l'), undefined);
  assert.deepStrictEqual(idx.getGeneratedFilesFor('file:///x.y'), []);
});

test('empty WorkspaceIndex: initialize with empty folders is a no-op', async () => {
  const idx = new WorkspaceIndex('');
  await idx.initialize([]);
  assert.deepStrictEqual(idx.getBisonFiles(), []);
});

// ─── Results ──────────────────────────────────────────────────────────────────

setImmediate(() => {
  console.log('\n==================================================');
  console.log(`  RESULTS: ${passed} passed, ${failed} failed`);
  console.log('==================================================\n');
  if (failed > 0) process.exit(1);
});
