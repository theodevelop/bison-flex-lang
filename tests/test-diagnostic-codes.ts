/**
 * Tests for the diagnostic-codes registry and every diagnostic code field.
 * Run with: npx ts-node --project server/tsconfig.json tests/test-diagnostic-codes.ts
 */

// ── Imports (ALL at top) ──────────────────────────────────────────────────────
import { DC, diagEntry }                    from '../server/src/providers/diagnosticCodes';
import { parseBisonDocument }               from '../server/src/parser/bisonParser';
import { parseFlexDocument }                from '../server/src/parser/flexParser';
import { computeBisonDiagnostics,
         computeFlexDiagnostics }           from '../server/src/providers/diagnostics';
import { computeBisonCrossFileDiagnostics,
         computeFlexCrossFileDiagnostics }  from '../server/src/providers/crossFileSync';
import { DiagnosticTag }                    from 'vscode-languageserver';

// ── Test harness ──────────────────────────────────────────────────────────────
let passed = 0, failed = 0;
function assert(cond: boolean, msg: string, extra?: unknown) {
  if (cond) { console.log(`  [PASS] ${msg}`); passed++; }
  else { console.error(`  [FAIL] ${msg}${extra !== undefined ? `  →  ${JSON.stringify(extra)}` : ''}`); failed++; }
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Registry shape
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n=== TEST: DiagnosticCodes registry ===');

for (const key of Object.keys(DC) as Array<keyof typeof DC>) {
  const entry = DC[key];
  assert(typeof entry.code === 'string' && entry.code.length > 0,    `${key}.code is non-empty string`,   entry.code);
  assert(typeof entry.source === 'string' && entry.source.length > 0, `${key}.source is non-empty string`, entry.source);
}

// Source prefixes must match code prefixes
for (const key of Object.keys(DC) as Array<keyof typeof DC>) {
  const { code, source } = DC[key];
  if (code.startsWith('bison/')) {
    assert(source === 'bison' || source === 'bison-yacc-compat',
      `${key}: bison/* code has bison source`, { code, source });
  } else if (code.startsWith('flex/')) {
    assert(source === 'flex', `${key}: flex/* code has flex source`, { code, source });
  }
}

// hrefs must be absolute URLs when present
for (const key of Object.keys(DC) as Array<keyof typeof DC>) {
  const entry = DC[key];
  if ('href' in entry && entry.href) {
    assert(entry.href.startsWith('https://'), `${key}.href is absolute URL`, entry.href);
  }
}

// diagEntry() helper
const e = diagEntry('BISON_MISSING_SEPARATOR');
assert(e.code === 'bison/missing-separator', 'diagEntry returns correct code');
assert(e.source === 'bison',                  'diagEntry returns correct source');

// ─────────────────────────────────────────────────────────────────────────────
// 2. Bison diagnostic codes
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n=== TEST: Bison diagnostic codes ===');

// missing-separator
{
  const src = 'token_def\n';
  const doc = parseBisonDocument(src);
  const diags = computeBisonDiagnostics(doc, src);
  const d = diags.find(x => x.message.includes('Missing %%'));
  assert(d?.code === 'bison/missing-separator', 'bison/missing-separator code', d?.code);
  assert(d?.source === 'bison',                  'missing-separator source',     d?.source);
}

// unknown-directive
{
  const src = `%bogus\n%%\nexpr : ;\n%%\n`;
  const doc = parseBisonDocument(src);
  const diags = computeBisonDiagnostics(doc, src);
  const d = diags.find(x => x.message.includes('Unknown Bison directive'));
  assert(d?.code === 'bison/unknown-directive', 'bison/unknown-directive code', d?.code);
}

// undeclared-token + href
{
  const src = `%token NUMBER\n%%\nexpr : NUMBER PLUS ;\n%%\n`;
  const doc = parseBisonDocument(src);
  const diags = computeBisonDiagnostics(doc, src);
  const d = diags.find(x => x.message.includes("'PLUS' is used but not declared"));
  assert(d?.code === 'bison/undeclared-token',                         'bison/undeclared-token code', d?.code);
  assert(typeof (d as any)?.codeDescription?.href === 'string',        'undeclared-token has href');
}

// unused-token + Unnecessary tag + href
{
  const src = `%token NUMBER UNUSED\n%%\nexpr : NUMBER ;\n%%\n`;
  const doc = parseBisonDocument(src);
  const diags = computeBisonDiagnostics(doc, src);
  const d = diags.find(x => x.message.includes("'UNUSED' is declared with %token but never used"));
  assert(d?.code === 'bison/unused-token',                             'bison/unused-token code',      d?.code);
  assert((d?.tags?.includes(DiagnosticTag.Unnecessary) ?? false),                 'unused-token Unnecessary tag');
  assert(typeof (d as any)?.codeDescription?.href === 'string',        'unused-token has href');
}

// unused-rule + Unnecessary tag
{
  const src = `%token A B\n%%\nstart : A ;\nunused : B ;\n%%\n`;
  const doc = parseBisonDocument(src);
  const diags = computeBisonDiagnostics(doc, src);
  const d = diags.find(x => x.message.includes("'unused' is defined but never referenced"));
  assert(d?.code === 'bison/unused-rule',                              'bison/unused-rule code',       d?.code);
  assert((d?.tags?.includes(DiagnosticTag.Unnecessary) ?? false),                 'unused-rule Unnecessary tag');
}

// out-of-bounds + href
{
  const src = `%token A\n%%\nexpr : A { $2; } ;\n%%\n`;
  const doc = parseBisonDocument(src);
  const diags = computeBisonDiagnostics(doc, src);
  const d = diags.find(x => x.message.includes('out of bounds'));
  assert(d?.code === 'bison/out-of-bounds',                            'bison/out-of-bounds code',     d?.code);
  assert(typeof (d as any)?.codeDescription?.href === 'string',        'out-of-bounds has href');
}

// missing-empty + href
{
  const src = `%token A\n%%\nexpr : A\n     |\n     ;\n%%\n`;
  const doc = parseBisonDocument(src);
  const diags = computeBisonDiagnostics(doc, src);
  const d = diags.find(x => x.message.includes('Empty production') && x.message.includes('%empty'));
  assert(d?.code === 'bison/missing-empty',                            'bison/missing-empty code',     d?.code);
  assert(typeof (d as any)?.codeDescription?.href === 'string',        'missing-empty has href');
}

// shift-reduce + href
{
  const src = `%token IF THEN ELSE\n%%\nstmt : IF stmt THEN stmt\n     | IF stmt THEN stmt ELSE stmt\n     ;\n%%\n`;
  const doc = parseBisonDocument(src);
  const diags = computeBisonDiagnostics(doc, src);
  const d = diags.find(x => x.message.includes('shift/reduce'));
  assert(d?.code === 'bison/shift-reduce',                             'bison/shift-reduce code',      d?.code);
  assert(typeof (d as any)?.codeDescription?.href === 'string',        'shift-reduce has href');
}

// missing-start + href
{
  const src = `%token A B C\n%%\nr1 : A ;\nr2 : B ;\nr3 : C ;\n%%\n`;
  const doc = parseBisonDocument(src);
  const diags = computeBisonDiagnostics(doc, src);
  const d = diags.find(x => x.message.includes('No %start directive'));
  assert(d?.code === 'bison/missing-start',                            'bison/missing-start code',     d?.code);
  assert(typeof (d as any)?.codeDescription?.href === 'string',        'missing-start has href');
}

// undefined-start + href
{
  const src = `%start ghost\n%token A\n%%\nexpr : A ;\n%%\n`;
  const doc = parseBisonDocument(src);
  const diags = computeBisonDiagnostics(doc, src);
  const d = diags.find(x => x.message.includes('has no corresponding rule'));
  assert(d?.code === 'bison/undefined-start',                          'bison/undefined-start code',   d?.code);
  assert(typeof (d as any)?.codeDescription?.href === 'string',        'undefined-start has href');
}

// yacc-compat
{
  const src = `%pure-parser\n%%\nexpr : ;\n%%\n`;
  const doc = parseBisonDocument(src);
  const diags = computeBisonDiagnostics(doc, src);
  const d = diags.find(x => x.message.includes('Yacc legacy'));
  assert(d?.code === 'bison/yacc-compat',       'bison/yacc-compat code',  d?.code);
  assert(d?.source === 'bison-yacc-compat',      'yacc-compat source',      d?.source);
}

// duplicate-rule (smoke)
{
  const src = `%token A\n%%\nexpr : A ;\nexpr : A ;\n%%\n`;
  const doc = parseBisonDocument(src);
  const diags = computeBisonDiagnostics(doc, src);
  const d = diags.find(x => x.code === 'bison/duplicate-rule');
  assert(!!d, 'bison/duplicate-rule code present');
}

// infinite-recursion (smoke)
{
  const src = `%token A\n%%\nexpr : expr A ;\n%%\n`;
  const doc = parseBisonDocument(src);
  const diags = computeBisonDiagnostics(doc, src);
  const d = diags.find(x => x.code === 'bison/infinite-recursion');
  assert(!!d, 'bison/infinite-recursion code present');
}

// unclosed-block (smoke) — %{ appears after %% so the separator is found
{
  const src = `%token A\n%%\nexpr : A ;\n%%\n%{\nint epilogue;\n`;
  const doc = parseBisonDocument(src);
  const diags = computeBisonDiagnostics(doc, src);
  const d = diags.find(x => x.code === 'bison/unclosed-block');
  assert(!!d, 'bison/unclosed-block code present');
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Flex diagnostic codes
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n=== TEST: Flex diagnostic codes ===');

// missing-separator
{
  const src = `some content\n`;
  const doc = parseFlexDocument(src);
  const diags = computeFlexDiagnostics(doc, src);
  const d = diags.find(x => x.message.includes('Missing %%'));
  assert(d?.code === 'flex/missing-separator', 'flex/missing-separator code', d?.code);
  assert(d?.source === 'flex',                  'flex missing-separator source', d?.source);
}

// unknown-directive
{
  const src = `%bogus\n%%\n[a-z]+ {}\n%%\n`;
  const doc = parseFlexDocument(src);
  const diags = computeFlexDiagnostics(doc, src);
  const d = diags.find(x => x.message.includes('Unknown Flex directive'));
  assert(d?.code === 'flex/unknown-directive', 'flex/unknown-directive code', d?.code);
}

// undefined-sc
{
  const src = `%%\n<UNDECLARED>[a-z]+ {}\n%%\n`;
  const doc = parseFlexDocument(src);
  const diags = computeFlexDiagnostics(doc, src);
  const d = diags.find(x => x.message.includes("'UNDECLARED' is used but not declared"));
  assert(d?.code === 'flex/undefined-sc', 'flex/undefined-sc code', d?.code);
}

// unused-sc + Unnecessary tag
{
  const src = `%x MYSTATE\n%%\n[a-z]+ {}\n%%\n`;
  const doc = parseFlexDocument(src);
  const diags = computeFlexDiagnostics(doc, src);
  const d = diags.find(x => x.message.includes("'MYSTATE' is declared but never used"));
  assert(d?.code === 'flex/unused-sc',                        'flex/unused-sc code',       d?.code);
  assert((d?.tags?.includes(DiagnosticTag.Unnecessary) ?? false),         'unused-sc Unnecessary tag');
}

// undefined-abbrev (smoke) — 2 spaces before action so the parser finds the action block
{
  const src = `%%\n{NOPE}  {}\n%%\n`;
  const doc = parseFlexDocument(src);
  const diags = computeFlexDiagnostics(doc, src);
  const d = diags.find(x => x.code === 'flex/undefined-abbrev');
  assert(!!d, 'flex/undefined-abbrev code present');
}

// unused-abbrev + Unnecessary tag — use tab separator as flex normally does
{
  const src = `DIGIT\t[0-9]\n%%\n[a-z]+\t{}\n%%\n`;
  const doc = parseFlexDocument(src);
  const diags = computeFlexDiagnostics(doc, src);
  const d = diags.find(x => x.code === 'flex/unused-abbrev');
  assert(!!d,                                                              'flex/unused-abbrev code present');
  assert((d?.tags?.includes(DiagnosticTag.Unnecessary) ?? false),          'unused-abbrev Unnecessary tag');
}

// unreachable-rule (duplicate pattern)
{
  const src = `%%\n[a-z]+ {}\n[a-z]+ {}\n%%\n`;
  const doc = parseFlexDocument(src);
  const diags = computeFlexDiagnostics(doc, src);
  const d = diags.find(x => x.message.includes('inaccessible') || x.message.includes('identical'));
  assert(d?.code === 'flex/unreachable-rule', 'flex/unreachable-rule code', d?.code);
}

// missing-yywrap
{
  const src = `%%\n[a-z]+ {}\n%%\n`;
  const doc = parseFlexDocument(src);
  const diags = computeFlexDiagnostics(doc, src);
  const d = diags.find(x => x.message.includes('noyywrap'));
  assert(d?.code === 'flex/missing-yywrap', 'flex/missing-yywrap code', d?.code);
}

// unclosed-block (smoke) — %{ after %% so the separator is found first
{
  const src = `%%\n[a-z]+\t{}\n%%\n%{\nint epilogue;\n`;
  const doc = parseFlexDocument(src);
  const diags = computeFlexDiagnostics(doc, src);
  const d = diags.find(x => x.code === 'flex/unclosed-block');
  assert(!!d, 'flex/unclosed-block code present');
}

// unused-option (smoke: %option stack not used)
{
  const src = `%option stack\n%%\n[a-z]+ {}\n%%\n`;
  const doc = parseFlexDocument(src);
  const diags = computeFlexDiagnostics(doc, src);
  const d = diags.find(x => x.code === 'flex/unused-option');
  assert(!!d, 'flex/unused-option code present');
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Cross-file diagnostic codes
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n=== TEST: Cross-file diagnostic codes ===');

const bisonSrcCross = `%token NUMBER MISSING\n%%\nexpr : NUMBER ;\n%%\n`;
const flexSrcCross  = `%%\n[0-9]+ { return NUMBER; }\n%%\n`;
const bisonDocCross = parseBisonDocument(bisonSrcCross);

// bison/missing-lexer-return
{
  const diags = computeBisonCrossFileDiagnostics(bisonDocCross, flexSrcCross, 'file:///test.l');
  const d = diags.find(x => x.message.includes('MISSING'));
  assert(d?.code === 'bison/missing-lexer-return', 'bison/missing-lexer-return code',      d?.code);
  assert(d?.source === 'bison',                     'missing-lexer-return source is bison', d?.source);
}

// flex/missing-grammar-token
{
  const flexExtra = `%%\n[0-9]+ { return NUMBER; }\n"+" { return UNDECLARED; }\n%%\n`;
  const diags = computeFlexCrossFileDiagnostics(flexExtra, bisonDocCross, 'file:///test.y');
  const d = diags.find(x => x.message.includes('UNDECLARED'));
  assert(d?.code === 'flex/missing-grammar-token', 'flex/missing-grammar-token code',       d?.code);
  assert(d?.source === 'flex',                      'missing-grammar-token source is flex',  d?.source);
}

// ─────────────────────────────────────────────────────────────────────────────
// Results
// ─────────────────────────────────────────────────────────────────────────────
console.log(`\n${'='.repeat(50)}`);
console.log(`  RESULTS: ${passed} passed, ${failed} failed`);
console.log('='.repeat(50));
if (failed > 0) process.exit(1);
