/**
 * Integration test: exercises parsers, diagnostics, completion, and hover
 * against the real parsetiger.yy and scantiger.ll files.
 *
 * Run with: npx ts-node --project server/tsconfig.json test-parsers.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { parseBisonDocument } from '../server/src/parser/bisonParser';
import { parseFlexDocument } from '../server/src/parser/flexParser';
import { computeBisonDiagnostics, computeFlexDiagnostics } from '../server/src/providers/diagnostics';
import { bisonDirectiveDocs, bisonDefineDocs, flexDirectiveDocs, flexOptionDocs, flexBuiltinDocs } from '../server/src/providers/documentation';

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string): void {
  if (condition) {
    console.log(`  [PASS] ${message}`);
    passed++;
  } else {
    console.error(`  [FAIL] ${message}`);
    failed++;
  }
}

// ── Load real files ──
const bisonPath = path.resolve(__dirname, '../tiger-compiler/src/parse/parsetiger.yy');
const flexPath = path.resolve(__dirname, '../tiger-compiler/src/parse/scantiger.ll');

const bisonText = fs.existsSync(bisonPath) ? fs.readFileSync(bisonPath, 'utf-8') : '';
const flexText = fs.existsSync(flexPath) ? fs.readFileSync(flexPath, 'utf-8') : '';

// ════════════════════════════════════════
// TEST 1: Bison Parser
// ════════════════════════════════════════
console.log('\n=== TEST: Bison Parser (parsetiger.yy) ===\n');

if (!bisonText) {
  console.log('  [SKIP] parsetiger.yy not found');
} else {
  const bisonDoc = parseBisonDocument(bisonText);

  // %% separators
  assert(bisonDoc.separators.length >= 1, `Found ${bisonDoc.separators.length} %% separator(s) (expected >= 1)`);

  // Tokens
  console.log(`\n  Tokens found: ${bisonDoc.tokens.size}`);
  const expectedTokens = ['STRING', 'ID', 'INT', 'AND', 'ARRAY', 'ASSIGN', 'BREAK', 'CAST',
    'CLASS', 'COLON', 'COMMA', 'DIVIDE', 'DO', 'DOT', 'ELSE', 'END', 'EQ',
    'EXTENDS', 'FOR', 'FUNCTION', 'GE', 'GT', 'IF', 'IMPORT', 'IN',
    'LBRACE', 'LBRACK', 'LE', 'LET', 'LPAREN', 'LT', 'MINUS', 'METHOD',
    'NE', 'NEW', 'NIL', 'OF', 'OR', 'PLUS', 'PRIMITIVE', 'RBRACE',
    'RBRACK', 'RPAREN', 'SEMI', 'THEN', 'TIMES', 'TO', 'TYPE', 'VAR',
    'WHILE', 'EOF'];
  for (const tok of expectedTokens) {
    assert(bisonDoc.tokens.has(tok), `Token '${tok}' found`);
  }

  // Check typed tokens
  const stringToken = bisonDoc.tokens.get('STRING');
  assert(stringToken?.type === 'std::string', `STRING token has type <std::string> (got: ${stringToken?.type})`);
  const idToken = bisonDoc.tokens.get('ID');
  assert(idToken?.type === 'misc::symbol', `ID token has type <misc::symbol> (got: ${idToken?.type})`);
  const intToken = bisonDoc.tokens.get('INT');
  assert(intToken?.type === 'int', `INT token has type <int> (got: ${intToken?.type})`);

  // Token aliases
  assert(stringToken?.alias === 'string', `STRING alias is "string" (got: ${stringToken?.alias})`);
  assert(idToken?.alias === 'identifier', `ID alias is "identifier" (got: ${idToken?.alias})`);
  assert(intToken?.alias === 'integer', `INT alias is "integer" (got: ${intToken?.alias})`);

  // Non-terminals (%type)
  console.log(`\n  Non-terminals found: ${bisonDoc.nonTerminals.size}`);
  const expectedNT = ['exp', 'chunks', 'tychunk', 'tydec', 'typeid', 'ty', 'tyfield', 'tyfields', 'tyfields.1'];
  for (const nt of expectedNT) {
    assert(bisonDoc.nonTerminals.has(nt), `Non-terminal '${nt}' found`);
  }

  // Check non-terminal types
  const expType = bisonDoc.nonTerminals.get('exp');
  assert(expType?.type === 'ast::Exp*', `exp has type <ast::Exp*> (got: ${expType?.type})`);

  // %define variables
  console.log(`\n  %define variables found: ${bisonDoc.defines.size}`);
  const expectedDefines = ['api.prefix', 'api.namespace', 'api.parser.class', 'api.value.type',
    'api.token.constructor', 'parse.error', 'api.token.prefix', 'api.filename.type'];
  for (const def of expectedDefines) {
    assert(bisonDoc.defines.has(def), `%define '${def}' found`);
  }
  assert(bisonDoc.defines.get('api.value.type')?.value === 'variant',
    `api.value.type = variant (got: ${bisonDoc.defines.get('api.value.type')?.value})`);

  // Rules
  console.log(`\n  Rules found: ${bisonDoc.rules.size}`);
  const expectedRules = ['program', 'exp', 'chunks', 'tychunk', 'tydec', 'ty', 'tyfields', 'tyfields.1', 'tyfield', 'typeid'];
  for (const rule of expectedRules) {
    assert(bisonDoc.rules.has(rule), `Rule '${rule}' found`);
  }

  // Start symbol
  assert(bisonDoc.startSymbol === 'program', `Start symbol is 'program' (got: ${bisonDoc.startSymbol})`);

  // Precedence
  assert(bisonDoc.precedence.length >= 1, `Found ${bisonDoc.precedence.length} precedence declaration(s)`);

  // Diagnostics
  console.log('\n  --- Bison Diagnostics ---');
  const bisonDiags = computeBisonDiagnostics(bisonDoc, bisonText);
  console.log(`  Total diagnostics: ${bisonDiags.length}`);
  for (const d of bisonDiags) {
    console.log(`    [${d.severity === 1 ? 'ERROR' : d.severity === 2 ? 'WARN' : 'INFO'}] L${d.range.start.line + 1}: ${d.message}`);
  }
  // We should NOT have critical false positives (missing %%, etc.)
  const errors = bisonDiags.filter(d => d.severity === 1);
  assert(!errors.some(e => e.message.includes('Missing %%')), 'No false "missing %%" error');
}

// ════════════════════════════════════════
// TEST 2: Flex Parser
// ════════════════════════════════════════
console.log('\n\n=== TEST: Flex Parser (scantiger.ll) ===\n');

if (!flexText) {
  console.log('  [SKIP] scantiger.ll not found');
} else {
  const flexDoc = parseFlexDocument(flexText);

  // %% separators
  assert(flexDoc.separators.length >= 1, `Found ${flexDoc.separators.length} %% separator(s) (expected >= 1)`);

  // Options
  console.log(`\n  Options found: ${flexDoc.options.size}`);
  const expectedOpts = ['noyywrap', 'bison-complete', 'bison-locations', 'lex', 'namespace', 'lexer', 'params'];
  for (const opt of expectedOpts) {
    assert(flexDoc.options.has(opt), `Option '${opt}' found`);
  }
  assert(flexDoc.options.get('lexer')?.value === 'Lexer', `lexer option value is 'Lexer' (got: ${flexDoc.options.get('lexer')?.value})`);

  // Start conditions
  console.log(`\n  Start conditions found: ${flexDoc.startConditions.size}`);
  assert(flexDoc.startConditions.has('SC_COMMENT'), `Start condition 'SC_COMMENT' found`);
  assert(flexDoc.startConditions.has('SC_STRING'), `Start condition 'SC_STRING' found`);
  const scComment = flexDoc.startConditions.get('SC_COMMENT');
  assert(scComment?.exclusive === true, `SC_COMMENT is exclusive (got: ${scComment?.exclusive})`);

  // Abbreviations
  console.log(`\n  Abbreviations found: ${flexDoc.abbreviations.size}`);
  const expectedAbbrs = ['int', 'spaces', 'id'];
  for (const abbr of expectedAbbrs) {
    assert(flexDoc.abbreviations.has(abbr), `Abbreviation '${abbr}' found`);
  }
  assert(flexDoc.abbreviations.get('int')?.pattern === '[0-9]+',
    `int pattern is [0-9]+ (got: ${flexDoc.abbreviations.get('int')?.pattern})`);

  // Start condition references in rules
  console.log(`\n  Start condition references: ${flexDoc.startConditionRefs.size}`);
  assert(flexDoc.startConditionRefs.has('SC_COMMENT'), `SC_COMMENT referenced in rules`);
  assert(flexDoc.startConditionRefs.has('SC_STRING'), `SC_STRING referenced in rules`);

  // Abbreviation references in rules
  console.log(`\n  Abbreviation references: ${flexDoc.abbreviationRefs.size}`);
  assert(flexDoc.abbreviationRefs.has('int'), `{int} referenced in rules`);
  assert(flexDoc.abbreviationRefs.has('id'), `{id} referenced in rules`);
  assert(flexDoc.abbreviationRefs.has('spaces'), `{spaces} referenced in rules`);

  // Rules
  console.log(`\n  Rules found: ${flexDoc.rules.length}`);
  assert(flexDoc.rules.length > 20, `Found ${flexDoc.rules.length} rules (expected > 20)`);

  // Diagnostics
  console.log('\n  --- Flex Diagnostics ---');
  const flexDiags = computeFlexDiagnostics(flexDoc, flexText);
  console.log(`  Total diagnostics: ${flexDiags.length}`);
  for (const d of flexDiags) {
    console.log(`    [${d.severity === 1 ? 'ERROR' : d.severity === 2 ? 'WARN' : 'INFO'}] L${d.range.start.line + 1}: ${d.message}`);
  }
  // Should NOT have false positives
  const flexErrors = flexDiags.filter(d => d.severity === 1);
  assert(!flexErrors.some(e => e.message.includes('Missing %%')), 'No false "missing %%" error');
  assert(!flexErrors.some(e => e.message.includes('SC_COMMENT') && e.message.includes('not declared')),
    'No false "SC_COMMENT not declared" error');
  assert(!flexErrors.some(e => e.message.includes('SC_STRING') && e.message.includes('not declared')),
    'No false "SC_STRING not declared" error');
}

// ════════════════════════════════════════
// TEST 3: Documentation Database
// ════════════════════════════════════════
console.log('\n\n=== TEST: Documentation Database ===\n');

assert(bisonDirectiveDocs.size >= 25, `Bison directive docs: ${bisonDirectiveDocs.size} entries (expected >= 25)`);
assert(bisonDefineDocs.size >= 10, `Bison %define docs: ${bisonDefineDocs.size} entries (expected >= 10)`);
assert(flexDirectiveDocs.size >= 4, `Flex directive docs: ${flexDirectiveDocs.size} entries (expected >= 4)`);
assert(flexOptionDocs.size >= 15, `Flex option docs: ${flexOptionDocs.size} entries (expected >= 15)`);
assert(flexBuiltinDocs.size >= 8, `Flex builtin docs: ${flexBuiltinDocs.size} entries (expected >= 8)`);

// Verify key docs have all fields
for (const [key, doc] of bisonDirectiveDocs) {
  assert(doc.signature.length > 0, `Bison directive '${key}' has signature`);
  assert(doc.description.length > 0, `Bison directive '${key}' has description`);
}

// ════════════════════════════════════════
// TEST 4: Diagnostic – Unknown directives (Task 1)
// ════════════════════════════════════════
console.log('\n\n=== TEST: Unknown Directives ===\n');

{
  // Bison: %prout is not a valid directive
  const bisonSrc = [
    '%token NUMBER',
    '%prout foo',          // ← unknown directive
    '%%',
    'start: NUMBER ;',
    '%%',
  ].join('\n');

  const doc = parseBisonDocument(bisonSrc);
  assert(doc.unknownDirectives.length === 1, `Bison: 1 unknown directive detected (got ${doc.unknownDirectives.length})`);
  assert(doc.unknownDirectives[0]?.name === '%prout', `Bison: unknown directive name is '%prout' (got '${doc.unknownDirectives[0]?.name}')`);
  assert(doc.unknownDirectives[0]?.location.start.line === 1, `Bison: unknown directive on line 1 (got ${doc.unknownDirectives[0]?.location.start.line})`);

  const diags = computeBisonDiagnostics(doc, bisonSrc);
  const unknownDiag = diags.find(d => d.message.includes('%prout'));
  assert(unknownDiag !== undefined, `Bison: Error diagnostic emitted for '%prout'`);
  assert(unknownDiag?.severity === 1, `Bison: unknown directive has Error severity`);

  // Known directives should NOT be flagged
  const bisonKnown = [
    '%token NUMBER',
    '%define api.value.type variant',
    '%left PLUS',
    '%%',
    'start: NUMBER ;',
    '%%',
  ].join('\n');
  const docKnown = parseBisonDocument(bisonKnown);
  assert(docKnown.unknownDirectives.length === 0, `Bison: no false positives for known directives`);

  // Flex: %woops is not valid
  const flexSrc = [
    '%option noyywrap',
    '%woops bar',          // ← unknown directive
    '%%',
    '. ;',
    '%%',
  ].join('\n');

  const { parseFlexDocument: pflex } = require('../server/src/parser/flexParser');
  const flexDoc = pflex(flexSrc);
  assert(flexDoc.unknownDirectives.length === 1, `Flex: 1 unknown directive detected (got ${flexDoc.unknownDirectives.length})`);
  assert(flexDoc.unknownDirectives[0]?.name === '%woops', `Flex: unknown directive name is '%woops' (got '${flexDoc.unknownDirectives[0]?.name}')`);

  const flexDiags = computeFlexDiagnostics(flexDoc, flexSrc);
  const flexUnknownDiag = flexDiags.find(d => d.message.includes('%woops'));
  assert(flexUnknownDiag !== undefined, `Flex: Error diagnostic emitted for '%woops'`);
  assert(flexUnknownDiag?.severity === 1, `Flex: unknown directive has Error severity`);
}

// ════════════════════════════════════════
// TEST 5: Diagnostic – Unused rules (Task 2)
// ════════════════════════════════════════
console.log('\n\n=== TEST: Unused Rules ===\n');

{
  const bisonSrc = [
    '%token NUMBER PLUS',
    '%%',
    'start : expr ;',
    'expr  : NUMBER ;',
    'unused_rule : PLUS ;',  // ← never referenced
    '%%',
  ].join('\n');

  const doc = parseBisonDocument(bisonSrc);
  const diags = computeBisonDiagnostics(doc, bisonSrc);

  const unusedDiags = diags.filter(d => d.message.includes('unused_rule') && d.message.includes('never referenced'));
  assert(unusedDiags.length >= 1, `Unused rule 'unused_rule' produces a Warning diagnostic`);
  assert(unusedDiags[0]?.severity === 2, `Unused rule diagnostic has Warning severity`);

  // The start symbol must NOT be flagged as unused
  const startDiags = diags.filter(d => d.message.includes('start') && d.message.includes('never referenced'));
  assert(startDiags.length === 0, `Start symbol 'start' is not flagged as unused`);

  // A rule that IS used must NOT be flagged
  const exprDiags = diags.filter(d => d.message.includes("'expr'") && d.message.includes('never referenced'));
  assert(exprDiags.length === 0, `Used rule 'expr' is not flagged as unused`);
}

// ════════════════════════════════════════
// TEST 6: Diagnostic – Unused tokens (Task 3)
// ════════════════════════════════════════
console.log('\n\n=== TEST: Unused Tokens ===\n');

{
  const bisonSrc = [
    '%token NUMBER PLUS UNUSED_TOK',  // UNUSED_TOK never appears in rules
    '%%',
    'start : NUMBER PLUS NUMBER ;',
    '%%',
  ].join('\n');

  const doc = parseBisonDocument(bisonSrc);
  const diags = computeBisonDiagnostics(doc, bisonSrc);

  const unusedTokDiags = diags.filter(d => d.message.includes('UNUSED_TOK') && d.message.includes('never used'));
  assert(unusedTokDiags.length >= 1, `Unused token 'UNUSED_TOK' produces a Warning diagnostic`);
  assert(unusedTokDiags[0]?.severity === 2, `Unused token diagnostic has Warning severity`);

  // Tokens that ARE used must NOT be flagged
  const numberDiags = diags.filter(d => d.message.includes("'NUMBER'") && d.message.includes('never used'));
  assert(numberDiags.length === 0, `Used token 'NUMBER' is not flagged as unused`);

  const plusDiags = diags.filter(d => d.message.includes("'PLUS'") && d.message.includes('never used'));
  assert(plusDiags.length === 0, `Used token 'PLUS' is not flagged as unused`);
}

// ════════════════════════════════════════
// TEST 7: Diagnostic – Shift/reduce conflicts (Task 4)
// ════════════════════════════════════════
console.log('\n\n=== TEST: Shift/Reduce Conflicts ===\n');

{
  // Two alternatives of 'stmt' both start with IF → potential conflict
  // Note: parser requires "name :" on the same line (Bison inline format)
  const bisonSrc = [
    '%token IF ELSE NUMBER',
    '%%',
    'start : stmt ;',
    'stmt : IF NUMBER         { }',
    '     | IF NUMBER ELSE NUMBER { }',
    '     ;',
    '%%',
  ].join('\n');

  const doc = parseBisonDocument(bisonSrc);
  const diags = computeBisonDiagnostics(doc, bisonSrc);

  const conflictDiags = diags.filter(d => d.message.includes('shift/reduce') && d.message.includes('IF'));
  assert(conflictDiags.length >= 1, `Shift/reduce conflict detected for token 'IF' in rule 'stmt'`);
  assert(conflictDiags[0]?.severity === 2, `Shift/reduce conflict diagnostic has Warning severity`);

  // A rule with distinct first tokens must NOT produce a conflict warning
  const bisonClean = [
    '%token IF ELSE NUMBER',
    '%%',
    'start : stmt ;',
    'stmt : IF NUMBER { }',
    '     | ELSE NUMBER { }',
    '     ;',
    '%%',
  ].join('\n');
  const docClean = parseBisonDocument(bisonClean);
  const cleanDiags = computeBisonDiagnostics(docClean, bisonClean);
  const cleanConflicts = cleanDiags.filter(d => d.message.includes('shift/reduce'));
  assert(cleanConflicts.length === 0, `No shift/reduce warning for rule with distinct first tokens`);
}

// ════════════════════════════════════════
// TEST 8: Diagnostic – Inaccessible Flex rules (Task 5)
// ════════════════════════════════════════
console.log('\n\n=== TEST: Inaccessible Flex Rules ===\n');

{
  // Catch-all '.' before a specific pattern → specific rule is inaccessible
  const flexSrc = [
    '%option noyywrap',
    '%%',
    '.         { /* catchall */ }',
    '[a-z]+    { /* unreachable */ }',   // ← shadowed by '.' above
    '%%',
  ].join('\n');

  const { parseFlexDocument: pflex2 } = require('../server/src/parser/flexParser');
  const flexDoc = pflex2(flexSrc);
  const diags = computeFlexDiagnostics(flexDoc, flexSrc);

  const inaccessDiags = diags.filter(d => d.message.includes('inaccessible') || d.message.includes('catch-all'));
  assert(inaccessDiags.length >= 1, `Inaccessible Flex rule detected after catch-all '.'`);
  assert(inaccessDiags[0]?.severity === 2, `Inaccessible rule diagnostic has Warning severity`);

  // Duplicate pattern detection
  const flexDup = [
    '%option noyywrap',
    '%%',
    '[a-z]+    { /* first */ }',
    '[a-z]+    { /* duplicate — inaccessible */ }',
    '%%',
  ].join('\n');

  const flexDocDup = pflex2(flexDup);
  const dupDiags = computeFlexDiagnostics(flexDocDup, flexDup);
  const dupWarn = dupDiags.filter(d => d.message.includes('inaccessible') && d.message.includes('identical'));
  assert(dupWarn.length >= 1, `Duplicate Flex pattern detected as inaccessible`);

  // Specific before catch-all → should NOT be flagged
  const flexOk = [
    '%option noyywrap',
    '%%',
    '[a-z]+    { /* specific first — OK */ }',
    '.         { /* catchall last — OK */ }',
    '%%',
  ].join('\n');

  const flexDocOk = pflex2(flexOk);
  const okDiags = computeFlexDiagnostics(flexDocOk, flexOk);
  const okInacc = okDiags.filter(d => d.message.includes('inaccessible') || d.message.includes('catch-all'));
  assert(okInacc.length === 0, `No inaccessible warning when specific rule precedes catch-all`);
}

// ════════════════════════════════════════
// TEST 9: Fixture — Calculator (calc.y + calc.l)
// ════════════════════════════════════════
console.log('\n\n=== TEST: Fixture — Calculator ===\n');

{
  const calcYPath = path.resolve(__dirname, 'fixtures/calc.y');
  const calcLPath = path.resolve(__dirname, 'fixtures/calc.l');

  if (!fs.existsSync(calcYPath) || !fs.existsSync(calcLPath)) {
    console.log('  [SKIP] calc.y or calc.l not found');
  } else {
    const calcY = fs.readFileSync(calcYPath, 'utf-8');
    const calcL = fs.readFileSync(calcLPath, 'utf-8');
    const calcDoc = parseBisonDocument(calcY);

    // Tokens
    assert(calcDoc.tokens.has('NUMBER'), 'calc.y: TOKEN NUMBER found');
    assert(calcDoc.tokens.has('PLUS'), 'calc.y: TOKEN PLUS found');
    assert(calcDoc.tokens.has('MINUS'), 'calc.y: TOKEN MINUS found');
    assert(calcDoc.tokens.has('TIMES'), 'calc.y: TOKEN TIMES found');
    assert(calcDoc.tokens.has('DIVIDE'), 'calc.y: TOKEN DIVIDE found');
    assert(calcDoc.tokens.has('LPAREN'), 'calc.y: TOKEN LPAREN found');
    assert(calcDoc.tokens.has('RPAREN'), 'calc.y: TOKEN RPAREN found');
    assert(calcDoc.tokens.has('LETTER'), 'calc.y: TOKEN LETTER found');
    assert(calcDoc.tokens.has('ASSIGN'), 'calc.y: TOKEN ASSIGN found');
    assert(calcDoc.tokens.has('NEWLINE'), 'calc.y: TOKEN NEWLINE found');

    // Token types
    assert(calcDoc.tokens.get('NUMBER')?.type === 'double', `calc.y: NUMBER type is <double> (got ${calcDoc.tokens.get('NUMBER')?.type})`);
    assert(calcDoc.tokens.get('LETTER')?.type === 'int', `calc.y: LETTER type is <int> (got ${calcDoc.tokens.get('LETTER')?.type})`);

    // Token aliases
    assert(calcDoc.tokens.get('PLUS')?.alias === '+', `calc.y: PLUS alias is "+" (got ${calcDoc.tokens.get('PLUS')?.alias})`);

    // Rules
    assert(calcDoc.rules.has('program'), 'calc.y: rule program found');
    assert(calcDoc.rules.has('expr'), 'calc.y: rule expr found');
    assert(calcDoc.rules.has('term'), 'calc.y: rule term found');
    assert(calcDoc.rules.has('factor'), 'calc.y: rule factor found');
    assert(calcDoc.rules.has('primary'), 'calc.y: rule primary found');
    assert(calcDoc.rules.has('lines'), 'calc.y: rule lines found');
    assert(calcDoc.rules.has('line'), 'calc.y: rule line found');

    // Separators
    assert(calcDoc.separators.length === 2, `calc.y: 2 %% separators (got ${calcDoc.separators.length})`);

    // Non-terminals
    assert(calcDoc.nonTerminals.has('expr'), 'calc.y: non-terminal expr');
    assert(calcDoc.nonTerminals.get('expr')?.type === 'double', `calc.y: expr type <double>`);

    // Precedence
    assert(calcDoc.precedence.length >= 3, `calc.y: >= 3 precedence decls (got ${calcDoc.precedence.length})`);

    // Defines
    assert(calcDoc.defines.has('api.value.type'), 'calc.y: %define api.value.type');
    assert(calcDoc.defines.get('api.value.type')?.value === 'union', `calc.y: value.type = union`);

    // Start symbol
    assert(calcDoc.startSymbol === 'program', `calc.y: start symbol is program`);

    // Diagnostics — should be clean (no errors)
    const calcDiags = computeBisonDiagnostics(calcDoc, calcY);
    const calcErrors = calcDiags.filter(d => d.severity === 1);
    assert(calcErrors.length === 0, `calc.y: no error diagnostics (got ${calcErrors.length})`);

    // Flex companion
    const { parseFlexDocument: pflexCalc } = require('../server/src/parser/flexParser');
    const calcFlexDoc = pflexCalc(calcL);

    assert(calcFlexDoc.separators.length >= 1, `calc.l: has %% separator`);
    assert(calcFlexDoc.options.has('noyywrap'), 'calc.l: option noyywrap');
    assert(calcFlexDoc.abbreviations.has('digit'), 'calc.l: abbreviation digit');
    assert(calcFlexDoc.abbreviations.has('number'), 'calc.l: abbreviation number');
    assert(calcFlexDoc.abbreviations.has('letter'), 'calc.l: abbreviation letter');
    assert(calcFlexDoc.abbreviations.has('spaces'), 'calc.l: abbreviation spaces');
    assert(calcFlexDoc.rules.length >= 10, `calc.l: >= 10 rules (got ${calcFlexDoc.rules.length})`);

    const calcFlexDiags = computeFlexDiagnostics(calcFlexDoc, calcL);
    const calcFlexErrors = calcFlexDiags.filter((d: any) => d.severity === 1);
    assert(calcFlexErrors.length === 0, `calc.l: no error diagnostics (got ${calcFlexErrors.length})`);
  }
}

// ════════════════════════════════════════
// TEST 10: Fixture — JSON (json.y + json.l)
// ════════════════════════════════════════
console.log('\n\n=== TEST: Fixture — JSON ===\n');

{
  const jsonYPath = path.resolve(__dirname, 'fixtures/json.y');
  const jsonLPath = path.resolve(__dirname, 'fixtures/json.l');

  if (!fs.existsSync(jsonYPath) || !fs.existsSync(jsonLPath)) {
    console.log('  [SKIP] json.y or json.l not found');
  } else {
    const jsonY = fs.readFileSync(jsonYPath, 'utf-8');
    const jsonL = fs.readFileSync(jsonLPath, 'utf-8');
    const jsonDoc = parseBisonDocument(jsonY);

    // Tokens
    assert(jsonDoc.tokens.has('STRING'), 'json.y: TOKEN STRING');
    assert(jsonDoc.tokens.has('NUMBER'), 'json.y: TOKEN NUMBER');
    assert(jsonDoc.tokens.has('TRUE'), 'json.y: TOKEN TRUE');
    assert(jsonDoc.tokens.has('FALSE'), 'json.y: TOKEN FALSE');
    assert(jsonDoc.tokens.has('NULL_TOK'), 'json.y: TOKEN NULL_TOK');
    assert(jsonDoc.tokens.has('LBRACE'), 'json.y: TOKEN LBRACE');
    assert(jsonDoc.tokens.has('RBRACE'), 'json.y: TOKEN RBRACE');
    assert(jsonDoc.tokens.has('LBRACK'), 'json.y: TOKEN LBRACK');
    assert(jsonDoc.tokens.has('RBRACK'), 'json.y: TOKEN RBRACK');
    assert(jsonDoc.tokens.has('COLON'), 'json.y: TOKEN COLON');
    assert(jsonDoc.tokens.has('COMMA'), 'json.y: TOKEN COMMA');

    // Rules
    assert(jsonDoc.rules.has('json'), 'json.y: rule json');
    assert(jsonDoc.rules.has('value'), 'json.y: rule value');
    assert(jsonDoc.rules.has('object'), 'json.y: rule object');
    assert(jsonDoc.rules.has('array'), 'json.y: rule array');
    assert(jsonDoc.rules.has('members'), 'json.y: rule members');
    assert(jsonDoc.rules.has('pair'), 'json.y: rule pair');
    assert(jsonDoc.rules.has('elements'), 'json.y: rule elements');

    // value rule should have 7 alternatives
    const valueRule = jsonDoc.rules.get('value');
    assert(valueRule!.alternatives.length === 7, `json.y: value has 7 alternatives (got ${valueRule?.alternatives.length})`);

    // Start symbol
    assert(jsonDoc.startSymbol === 'json', `json.y: start symbol is json`);

    // Separators
    assert(jsonDoc.separators.length === 2, `json.y: 2 separators`);

    // No errors
    const jsonDiags = computeBisonDiagnostics(jsonDoc, jsonY);
    const jsonErrors = jsonDiags.filter(d => d.severity === 1);
    assert(jsonErrors.length === 0, `json.y: no error diagnostics (got ${jsonErrors.length})`);

    // Flex
    const { parseFlexDocument: pflexJson } = require('../server/src/parser/flexParser');
    const jsonFlexDoc = pflexJson(jsonL);

    assert(jsonFlexDoc.separators.length >= 1, `json.l: has %% separator`);
    assert(jsonFlexDoc.options.has('noyywrap'), 'json.l: option noyywrap');
    assert(jsonFlexDoc.startConditions.has('SC_STRING'), 'json.l: start condition SC_STRING');
    assert(jsonFlexDoc.abbreviations.has('digit'), 'json.l: abbreviation digit');
    assert(jsonFlexDoc.rules.length >= 10, `json.l: >= 10 rules (got ${jsonFlexDoc.rules.length})`);

    const jsonFlexDiags = computeFlexDiagnostics(jsonFlexDoc, jsonL);
    const jsonFlexErrors = jsonFlexDiags.filter((d: any) => d.severity === 1);
    assert(jsonFlexErrors.length === 0, `json.l: no error diagnostics (got ${jsonFlexErrors.length})`);
  }
}

// ════════════════════════════════════════
// TEST 11: Fixture — SQL (sql.y + sql.l)
// ════════════════════════════════════════
console.log('\n\n=== TEST: Fixture — SQL ===\n');

{
  const sqlYPath = path.resolve(__dirname, 'fixtures/sql.y');
  const sqlLPath = path.resolve(__dirname, 'fixtures/sql.l');

  if (!fs.existsSync(sqlYPath) || !fs.existsSync(sqlLPath)) {
    console.log('  [SKIP] sql.y or sql.l not found');
  } else {
    const sqlY = fs.readFileSync(sqlYPath, 'utf-8');
    const sqlL = fs.readFileSync(sqlLPath, 'utf-8');
    const sqlDoc = parseBisonDocument(sqlY);

    // Tokens
    const expectedSqlTokens = [
      'IDENTIFIER', 'STRING_LIT', 'NUMBER',
      'SELECT', 'FROM', 'WHERE', 'INSERT', 'INTO', 'VALUES',
      'CREATE', 'TABLE', 'DROP', 'AND', 'OR', 'NOT', 'NULL_TOK',
      'INT_TYPE', 'VARCHAR', 'TEXT',
      'STAR', 'COMMA', 'LPAREN', 'RPAREN', 'SEMI',
      'EQ', 'NE', 'LT', 'GT', 'LE', 'GE', 'DOT',
    ];
    for (const tok of expectedSqlTokens) {
      assert(sqlDoc.tokens.has(tok), `sql.y: TOKEN ${tok}`);
    }

    // Rules
    const expectedSqlRules = [
      'program', 'statements', 'statement', 'select_stmt', 'insert_stmt',
      'create_stmt', 'drop_stmt', 'column_list', 'table_ref', 'where_clause',
      'condition', 'expr', 'expr_list', 'column_defs', 'column_def', 'data_type',
    ];
    for (const rule of expectedSqlRules) {
      assert(sqlDoc.rules.has(rule), `sql.y: rule ${rule}`);
    }

    // Start symbol
    assert(sqlDoc.startSymbol === 'program', `sql.y: start symbol is program`);

    // Precedence
    assert(sqlDoc.precedence.length >= 2, `sql.y: >= 2 precedence decls (got ${sqlDoc.precedence.length})`);

    // condition rule should have many alternatives (comparison operators + AND/OR/NOT/parens)
    const condRule = sqlDoc.rules.get('condition');
    assert(condRule!.alternatives.length >= 8, `sql.y: condition has >= 8 alternatives (got ${condRule?.alternatives.length})`);

    // No errors
    const sqlDiags = computeBisonDiagnostics(sqlDoc, sqlY);
    const sqlErrors = sqlDiags.filter(d => d.severity === 1);
    assert(sqlErrors.length === 0, `sql.y: no error diagnostics (got ${sqlErrors.length})`);

    // Flex
    const { parseFlexDocument: pflexSql } = require('../server/src/parser/flexParser');
    const sqlFlexDoc = pflexSql(sqlL);

    assert(sqlFlexDoc.separators.length >= 1, `sql.l: has %% separator`);
    assert(sqlFlexDoc.options.has('noyywrap'), 'sql.l: option noyywrap');
    assert(sqlFlexDoc.startConditions.has('SC_STRING'), 'sql.l: start condition SC_STRING');
    assert(sqlFlexDoc.abbreviations.has('digit'), 'sql.l: abbreviation digit');
    assert(sqlFlexDoc.abbreviations.has('identifier'), 'sql.l: abbreviation identifier');
    assert(sqlFlexDoc.rules.length >= 20, `sql.l: >= 20 rules (got ${sqlFlexDoc.rules.length})`);

    const sqlFlexDiags = computeFlexDiagnostics(sqlFlexDoc, sqlL);
    const sqlFlexErrors = sqlFlexDiags.filter((d: any) => d.severity === 1);
    assert(sqlFlexErrors.length === 0, `sql.l: no error diagnostics (got ${sqlFlexErrors.length})`);
  }
}

// ════════════════════════════════════════
// TEST 12: First/Follow Sets
// ════════════════════════════════════════
console.log('\n\n=== TEST: First/Follow Sets ===\n');

{
  const { computeFirstSets, computeFollowSets } = require('../server/src/providers/firstFollow');

  // Simple grammar: E → T E' ; E' → + T E' | ε ; T → id
  // Encoded as Bison inline format
  const bisonSrc = [
    '%token PLUS ID',
    '%%',
    'expr : term expr_tail ;',
    'expr_tail : PLUS term expr_tail ;',
    '          | ;',           // empty production (no symbols)
    'term : ID ;',
    '%%',
  ].join('\n');

  const doc = parseBisonDocument(bisonSrc);
  const firstSets = computeFirstSets(doc);
  const followSets = computeFollowSets(doc, firstSets);

  // First(term) = { ID }
  assert(firstSets.get('term')?.has('ID'), 'First(term) contains ID');
  assert(firstSets.get('term')?.size === 1, `First(term) has 1 element (got ${firstSets.get('term')?.size})`);

  // First(expr) should contain ID (through term)
  assert(firstSets.get('expr')?.has('ID'), 'First(expr) contains ID');

  // First(expr_tail) should contain PLUS and ε
  assert(firstSets.get('expr_tail')?.has('PLUS'), 'First(expr_tail) contains PLUS');
  assert(firstSets.get('expr_tail')?.has('ε'), 'First(expr_tail) contains ε');

  // Follow(expr) should contain $end
  assert(followSets.get('expr')?.has('$end'), 'Follow(expr) contains $end');

  // Follow(term) should contain PLUS and $end (since expr_tail can be ε)
  assert(followSets.get('term')?.has('PLUS'), 'Follow(term) contains PLUS');
  assert(followSets.get('term')?.has('$end'), 'Follow(term) contains $end');
}

// ════════════════════════════════════════
// TEST 13: $n out of bounds (NEW 1)
// ════════════════════════════════════════
console.log('\n\n=== TEST: $n Out of Bounds ===\n');

{
  // $5 in a rule with only 2 symbols → Error
  const bisonSrc = [
    '%token PLUS NUMBER',
    '%%',
    'start : expr ;',
    'expr  : NUMBER PLUS { $$ = $5; }',  // 2 symbols, $5 out of bounds
    '%%',
  ].join('\n');

  const doc = parseBisonDocument(bisonSrc);
  const diags = computeBisonDiagnostics(doc, bisonSrc);

  const oobDiags = diags.filter(d => d.message.includes('$5') && d.message.includes('out of bounds'));
  assert(oobDiags.length >= 1, `$5 in a 2-symbol rule produces an Error diagnostic`);
  assert(oobDiags[0]?.severity === 1, `$5 out-of-bounds has Error severity`);

  // In-bounds reference must NOT be flagged
  const bisonOk = [
    '%token PLUS NUMBER',
    '%%',
    'start : expr ;',
    'expr  : NUMBER PLUS NUMBER { $$ = $1 + $3; }',  // 3 symbols, $1 and $3 valid
    '%%',
  ].join('\n');

  const docOk = parseBisonDocument(bisonOk);
  const okDiags = computeBisonDiagnostics(docOk, bisonOk);
  const oobOk = okDiags.filter(d => d.message.includes('out of bounds'));
  assert(oobOk.length === 0, `In-bounds $1 and $3 are not flagged`);

  // $$ (result) must NOT be flagged — it is not a $n ref
  const bisonDollarDollar = [
    '%token NUMBER',
    '%%',
    'start : NUMBER { $$ = $1; }',
    '%%',
  ].join('\n');
  const docDD = parseBisonDocument(bisonDollarDollar);
  const ddDiags = computeBisonDiagnostics(docDD, bisonDollarDollar);
  const ddOob = ddDiags.filter(d => d.message.includes('out of bounds'));
  assert(ddOob.length === 0, `$$ is not flagged as out-of-bounds`);
}

// ════════════════════════════════════════
// TEST 14: Undeclared binary operators conflict (NEW 2)
// ════════════════════════════════════════
console.log('\n\n=== TEST: Undeclared Binary Operators ===\n');

{
  // Two left-recursive alternatives with undeclared operators
  const bisonSrc = [
    '%token NUMBER PLUS MINUS',  // no %left/%right for PLUS/MINUS
    '%%',
    'start : expr ;',
    'expr : expr PLUS expr',
    '     | expr MINUS expr',
    '     | NUMBER',
    '     ;',
    '%%',
  ].join('\n');

  const doc = parseBisonDocument(bisonSrc);
  const diags = computeBisonDiagnostics(doc, bisonSrc);

  const conflictDiags = diags.filter(d => d.message.includes('undeclared operators') && d.message.includes('expr'));
  assert(conflictDiags.length >= 1, `Undeclared binary operators produce a Warning`);
  assert(conflictDiags[0]?.severity === 2, `Undeclared binary operators warning has Warning severity`);

  // With %left declarations the check must NOT fire
  const bisonDeclared = [
    '%token NUMBER PLUS MINUS',
    '%left PLUS MINUS',
    '%%',
    'start : expr ;',
    'expr : expr PLUS expr',
    '     | expr MINUS expr',
    '     | NUMBER',
    '     ;',
    '%%',
  ].join('\n');
  const docDecl = parseBisonDocument(bisonDeclared);
  const declDiags = computeBisonDiagnostics(docDecl, bisonDeclared);
  const declConflict = declDiags.filter(d => d.message.includes('undeclared operators'));
  assert(declConflict.length === 0, `Declared operators not flagged as undeclared`);
}

// ════════════════════════════════════════
// TEST 15: Missing %start directive (NEW 3)
// ════════════════════════════════════════
console.log('\n\n=== TEST: Missing %start Directive ===\n');

{
  // Grammar with > 2 rules and no %start
  const bisonSrc = [
    '%token NUMBER PLUS',
    '%%',
    'program : stmtlist ;',
    'stmtlist : stmtlist stmt',
    '         | stmt',
    '         ;',
    'stmt : NUMBER PLUS NUMBER ;',
    '%%',
  ].join('\n');

  const doc = parseBisonDocument(bisonSrc);
  assert(!doc.startSymbol, 'No %start symbol parsed');
  const diags = computeBisonDiagnostics(doc, bisonSrc);

  const startDiags = diags.filter(d => d.message.includes('No %start') || d.message.includes('%start'));
  assert(startDiags.length >= 1, `Missing %start produces an Information diagnostic`);
  assert(startDiags[0]?.severity === 3, `Missing %start has Information severity`);
  assert(startDiags[0]?.message.includes('program'), `Diagnostic names the implicit start symbol`);

  // With explicit %start the check must NOT fire
  const bisonWithStart = [
    '%token NUMBER PLUS',
    '%start program',
    '%%',
    'program : stmtlist ;',
    'stmtlist : stmtlist stmt | stmt ;',
    'stmt : NUMBER PLUS NUMBER ;',
    '%%',
  ].join('\n');
  const docWS = parseBisonDocument(bisonWithStart);
  const wsDiags = computeBisonDiagnostics(docWS, bisonWithStart);
  const wsStart = wsDiags.filter(d => d.message.includes('No %start'));
  assert(wsStart.length === 0, `Explicit %start suppresses the Information diagnostic`);
}

// ════════════════════════════════════════
// TEST 16: Empty production without %empty (NEW 4)
// ════════════════════════════════════════
console.log('\n\n=== TEST: Missing %empty ===\n');

{
  // An empty production without %empty
  const bisonSrc = [
    '%token NUMBER',
    '%%',
    'start : list ;',
    'list : NUMBER list',
    '     |',             // empty without %empty
    '     ;',
    '%%',
  ].join('\n');

  const doc = parseBisonDocument(bisonSrc);
  const diags = computeBisonDiagnostics(doc, bisonSrc);

  const emptyDiags = diags.filter(d => d.message.includes('%empty') && d.message.includes("'list'"));
  assert(emptyDiags.length >= 1, `Empty production without %empty produces a Warning`);
  assert(emptyDiags[0]?.severity === 2, `Missing %empty has Warning severity`);

  // %empty explicitly written must NOT trigger the warning
  const bisonWithEmpty = [
    '%token NUMBER',
    '%%',
    'start : list ;',
    'list : NUMBER list',
    '     | %empty',
    '     ;',
    '%%',
  ].join('\n');
  const docWE = parseBisonDocument(bisonWithEmpty);
  const weDiags = computeBisonDiagnostics(docWE, bisonWithEmpty);
  const weEmpty = weDiags.filter(d => d.message.includes('%empty') && d.message.includes("'list'"));
  assert(weEmpty.length === 0, `Explicit %empty suppresses the Warning`);
}

// ════════════════════════════════════════
// TEST 17: Flex – Invalid regex pattern (NEW 5)
// ════════════════════════════════════════
console.log('\n\n=== TEST: Flex Invalid Regex ===\n');

{
  // Unclosed bracket [ is an invalid regex
  const flexSrc = [
    '%option noyywrap',
    '%%',
    '[unclosed   { /* bad pattern */ }',
    '[a-z]+      { /* valid */ }',
    '%%',
  ].join('\n');

  const { parseFlexDocument: pflex3 } = require('../server/src/parser/flexParser');
  const flexDoc = pflex3(flexSrc);
  const diags = computeFlexDiagnostics(flexDoc, flexSrc);

  const invalidDiags = diags.filter(d => d.message.includes('Invalid regex') || d.message.includes('invalid'));
  assert(invalidDiags.length >= 1, `Invalid Flex regex produces an Error diagnostic`);
  assert(invalidDiags[0]?.severity === 1, `Invalid Flex regex has Error severity`);

  // Valid patterns must NOT be flagged
  const flexOk = [
    '%option noyywrap',
    '%%',
    '[a-z]+    { }',
    '[0-9]+    { }',
    '"hello"   { }',
    '%%',
  ].join('\n');
  const flexDocOk = pflex3(flexOk);
  const okDiags = computeFlexDiagnostics(flexDocOk, flexOk);
  const okInvalid = okDiags.filter(d => d.message.includes('Invalid regex'));
  assert(okInvalid.length === 0, `Valid Flex patterns are not flagged`);
}

// ════════════════════════════════════════
// TEST 18: Flex – Keyword shadowed by identifier pattern (NEW 6)
// ════════════════════════════════════════
console.log('\n\n=== TEST: Flex Keyword Overlap ===\n');

{
  // Identifier pattern before keyword → keyword shadowed
  const flexSrc = [
    '%option noyywrap',
    '%%',
    '[a-zA-Z_][a-zA-Z0-9_]*  { /* identifier */ }',
    'if                       { /* shadowed keyword */ }',
    '%%',
  ].join('\n');

  const { parseFlexDocument: pflex4 } = require('../server/src/parser/flexParser');
  const flexDoc = pflex4(flexSrc);
  const diags = computeFlexDiagnostics(flexDoc, flexSrc);

  const overlapDiags = diags.filter(d => d.message.includes('shadowed') || d.message.includes('keyword'));
  assert(overlapDiags.length >= 1, `Keyword after identifier pattern produces a Warning`);
  assert(overlapDiags[0]?.severity === 2, `Keyword overlap has Warning severity`);

  // Keyword before identifier pattern → correct order, no warning
  const flexOk = [
    '%option noyywrap',
    '%%',
    'if                       { /* keyword first — correct */ }',
    '[a-zA-Z_][a-zA-Z0-9_]*  { /* identifier */ }',
    '%%',
  ].join('\n');
  const flexDocOk = pflex4(flexOk);
  const okDiags = computeFlexDiagnostics(flexDocOk, flexOk);
  const okOverlap = okDiags.filter(d => d.message.includes('shadowed') || d.message.includes('keyword'));
  assert(okOverlap.length === 0, `Keyword before identifier pattern is not flagged`);
}

// ════════════════════════════════════════
// TEST 19: Flex – Missing %option noyywrap (NEW 7)
// ════════════════════════════════════════
console.log('\n\n=== TEST: Flex Missing noyywrap ===\n');

{
  // No %option noyywrap and no yywrap() defined
  const flexSrc = [
    '%%',
    '[a-z]+   { }',
    '%%',
  ].join('\n');

  const { parseFlexDocument: pflex5 } = require('../server/src/parser/flexParser');
  const flexDoc = pflex5(flexSrc);
  const diags = computeFlexDiagnostics(flexDoc, flexSrc);

  const yywrapDiags = diags.filter(d => d.message.includes('noyywrap') || d.message.includes('yywrap'));
  assert(yywrapDiags.length >= 1, `Missing noyywrap produces a Warning`);
  assert(yywrapDiags[0]?.severity === 2, `Missing noyywrap has Warning severity`);

  // With %option noyywrap → no warning
  const flexWithOption = [
    '%option noyywrap',
    '%%',
    '[a-z]+   { }',
    '%%',
  ].join('\n');
  const flexDocOpt = pflex5(flexWithOption);
  const optDiags = computeFlexDiagnostics(flexDocOpt, flexWithOption);
  const optYywrap = optDiags.filter(d => d.message.includes('noyywrap') || d.message.includes('yywrap'));
  assert(optYywrap.length === 0, `%option noyywrap suppresses the Warning`);

  // With yywrap defined in code → no warning
  const flexWithYywrap = [
    '%{',
    'int yywrap(void) { return 1; }',
    '%}',
    '%%',
    '[a-z]+   { }',
    '%%',
  ].join('\n');
  const flexDocYY = pflex5(flexWithYywrap);
  const yyDiags = computeFlexDiagnostics(flexDocYY, flexWithYywrap);
  const yyWrap = yyDiags.filter(d => d.message.includes('noyywrap') || d.message.includes('yywrap'));
  assert(yyWrap.length === 0, `yywrap() definition suppresses the Warning`);
}

// ════════════════════════════════════════
// TEST 20: False-positive fix — bare "rule :" header vs. true empty production
// ════════════════════════════════════════
console.log('\n\n=== TEST: FP Fix — %empty bare header ===\n');

{
  // "rule :" on its own line followed by body on the next lines.
  // The parser creates a phantom empty alternative for the header line;
  // the diagnostic must NOT fire for it.
  const bisonBare = [
    '%token NUMBER',
    '%%',
    'start : list ;',
    'list :',               // bare rule-header — NOT an empty production
    '    NUMBER list',
    '  | %empty',
    '  ;',
    '%%',
  ].join('\n');

  const docBare = parseBisonDocument(bisonBare);
  const bareDiags = computeBisonDiagnostics(docBare, bisonBare);
  const bareEmpty = bareDiags.filter(
    d => d.message.includes('%empty') && d.message.includes("'list'"),
  );
  assert(bareEmpty.length === 0, `Bare 'list :' header does not trigger false %empty warning`);

  // A genuine empty production "| ;" must still be detected.
  const bisonRealEmpty = [
    '%token NUMBER',
    '%%',
    'start : list ;',
    'list : NUMBER list',
    '     |',               // real empty production without %empty
    '     ;',
    '%%',
  ].join('\n');

  const docReal = parseBisonDocument(bisonRealEmpty);
  const realDiags = computeBisonDiagnostics(docReal, bisonRealEmpty);
  const realEmpty = realDiags.filter(
    d => d.message.includes('%empty') && d.message.includes("'list'"),
  );
  assert(realEmpty.length >= 1, `Genuine empty production '| ;' still produces a Warning`);
  assert(realEmpty[0]?.severity === 2, `Genuine empty production Warning has Warning severity`);

  // "rule : ;" on a single line — still an empty production, must still warn.
  const bisonInline = [
    '%token NUMBER',
    '%%',
    'start : opt ;',
    'opt : NUMBER',
    '    | ;',              // inline empty — must warn
    '%%',
  ].join('\n');

  const docInline = parseBisonDocument(bisonInline);
  const inlineDiags = computeBisonDiagnostics(docInline, bisonInline);
  const inlineEmpty = inlineDiags.filter(
    d => d.message.includes('%empty') && d.message.includes("'opt'"),
  );
  assert(inlineEmpty.length >= 1, `Inline 'rule : ;' empty production still produces a Warning`);

  // Edge case: bare "rule :" header immediately followed by "| alt" on the next
  // line.  The phantom alternative IS a genuine empty first production; the
  // diagnostic must still fire.
  const bisonBareWithPipe = [
    '%token LETTER',
    '%%',
    'start : opt ;',
    'opt :',
    '    | LETTER',    // first alternative is empty (bare header + first |)
    '    ;',
    '%%',
  ].join('\n');

  const docBWP = parseBisonDocument(bisonBareWithPipe);
  const bwpDiags = computeBisonDiagnostics(docBWP, bisonBareWithPipe);
  const bwpEmpty = bwpDiags.filter(
    d => d.message.includes('%empty') && d.message.includes("'opt'"),
  );
  assert(bwpEmpty.length >= 1, `Bare header followed by '| alt' still produces a %empty warning`);
}

// ════════════════════════════════════════
// TEST 21: False-positive fix — shift/reduce with declared precedence
// ════════════════════════════════════════
console.log('\n\n=== TEST: FP Fix — shift/reduce with %right/%left ===\n');

{
  // Classic dangling-else: two alts start with IF, but IF is declared %right.
  // Bison resolves this implicitly; the diagnostic must NOT fire.
  const bisonDanglingElse = [
    '%token IF ELSE NUMBER',
    '%right IF ELSE',
    '%%',
    'start : stmt ;',
    'stmt : IF NUMBER',
    '     | IF NUMBER ELSE NUMBER',
    '     | NUMBER',
    '     ;',
    '%%',
  ].join('\n');

  const docDE = parseBisonDocument(bisonDanglingElse);
  const deDiags = computeBisonDiagnostics(docDE, bisonDanglingElse);
  const deConflicts = deDiags.filter(
    d => d.message.includes('shift/reduce') && d.message.includes('IF'),
  );
  assert(
    deConflicts.length === 0,
    `shift/reduce not warned when 'IF' has %right declaration`,
  );

  // Same grammar WITHOUT %right → must still warn.
  const bisonNoPrecedence = [
    '%token IF ELSE NUMBER',
    '%%',
    'start : stmt ;',
    'stmt : IF NUMBER',
    '     | IF NUMBER ELSE NUMBER',
    '     | NUMBER',
    '     ;',
    '%%',
  ].join('\n');

  const docNP = parseBisonDocument(bisonNoPrecedence);
  const npDiags = computeBisonDiagnostics(docNP, bisonNoPrecedence);
  const npConflicts = npDiags.filter(
    d => d.message.includes('shift/reduce') && d.message.includes('IF'),
  );
  assert(
    npConflicts.length >= 1,
    `shift/reduce still warned when 'IF' has no precedence declaration`,
  );

  // %left covers PLUS and MINUS — expression grammar must not warn.
  const bisonExpr = [
    '%token NUMBER PLUS MINUS',
    '%left PLUS MINUS',
    '%%',
    'start : expr ;',
    'expr : expr PLUS NUMBER',
    '     | expr MINUS NUMBER',
    '     | NUMBER',
    '     ;',
    '%%',
  ].join('\n');

  const docExpr = parseBisonDocument(bisonExpr);
  const exprDiags = computeBisonDiagnostics(docExpr, bisonExpr);
  // Note: firstSymbol of "expr PLUS NUMBER" is "expr" (non-terminal, lowercase)
  // so the shift/reduce heuristic would not fire on it anyway — but the test
  // also confirms no spurious warning appears.
  const exprConflicts = exprDiags.filter(d => d.message.includes('shift/reduce'));
  assert(exprConflicts.length === 0, `Expression grammar with %left has no shift/reduce warning`);
}

// ════════════════════════════════════════
// TEST 22: Parser — multi-line rule continuation accumulation
// ════════════════════════════════════════
console.log('\n\n=== TEST: Multi-line rule continuation ===\n');

{
  // Rule with bare "rule :" header and multi-line body; action is on the
  // continuation line, so $n references must be validated against the full
  // accumulated symbol count (not just those on the header line).
  const bisonSrc = [
    '%token NUMBER PLUS MINUS',
    '%%',
    'start : expr ;',
    'expr :',
    '    expr PLUS NUMBER   { $$ = $1 + $3; }',  // 3 symbols, $3 valid
    '  | expr MINUS NUMBER  { $$ = $1 - $3; }',  // 3 symbols, $3 valid
    '  | NUMBER',
    '  ;',
    '%%',
  ].join('\n');

  const doc = parseBisonDocument(bisonSrc);
  const exprRule = doc.rules.get('expr');

  // All three alternatives must be present (no phantom empty alt counted separately)
  assert(
    exprRule?.alternatives.length === 3,
    `Multi-line rule 'expr' has 3 alternatives (got ${exprRule?.alternatives.length})`,
  );

  // Continuation symbols must be accumulated into the first alternative
  assert(
    !!exprRule?.alternatives[0].symbols.includes('PLUS'),
    `First alt of 'expr' has PLUS (from continuation line)`,
  );
  assert(
    !!exprRule?.alternatives[0].symbols.includes('NUMBER'),
    `First alt of 'expr' has NUMBER (from continuation line)`,
  );

  const diags = computeBisonDiagnostics(doc, bisonSrc);

  // $3 is valid for a 3-symbol alternative — must NOT be flagged
  const oobDiags = diags.filter(d => d.message.includes('out of bounds'));
  assert(oobDiags.length === 0, `Valid $3 in 3-symbol multi-line alt is not flagged`);

  // Bare 'expr:' header with continuation body must NOT trigger %empty warning
  const emptyDiags = diags.filter(
    d => d.message.includes('%empty') && d.message.includes("'expr'"),
  );
  assert(emptyDiags.length === 0, `Multi-line 'expr:' does not trigger false %empty`);

  // — Negative case: $5 in a 4-symbol alt (3 grammar symbols + 1 action) must still be caught ——
  // With mid-rule action counting: expr(1) PLUS(2) NUMBER(3) {action}(4) — $5 is OOB.
  const bisonOob = [
    '%token NUMBER PLUS',
    '%%',
    'start : expr ;',
    'expr :',
    '    expr PLUS NUMBER   { $$ = $5; }',  // 4 symbols (3 + action), $5 out of bounds
    '  | NUMBER',
    '  ;',
    '%%',
  ].join('\n');

  const docOob = parseBisonDocument(bisonOob);
  const oobDiags2 = computeBisonDiagnostics(docOob, bisonOob)
    .filter(d => d.message.includes('$5') && d.message.includes('out of bounds'));
  assert(oobDiags2.length >= 1, `$5 in 3-symbol multi-line alt is still detected`);
  assert(oobDiags2[0]?.severity === 1, `Multi-line $n out-of-bounds is an Error`);

  // — Multi-line action block: $n refs are now tracked across lines ———————————
  const bisonMLAction = [
    '%token NUMBER PLUS',
    '%%',
    'start : expr ;',
    'expr : NUMBER PLUS NUMBER',   // 3 symbols
    '     {',                       // action opens on next line
    '       $$ = $1 + $3;',         // $1 and $3 valid
    '     }',
    '     | NUMBER',
    '     ;',
    '%%',
  ].join('\n');

  const docMLA = parseBisonDocument(bisonMLAction);
  const mlaDiags = computeBisonDiagnostics(docMLA, bisonMLAction)
    .filter(d => d.message.includes('out of bounds'));
  assert(mlaDiags.length === 0, `Valid $1/$3 in multi-line action block are not flagged`);

  // $5 in a multi-line action block with only 3 symbols → Error
  const bisonMLAOob = [
    '%token NUMBER PLUS',
    '%%',
    'start : expr ;',
    'expr : NUMBER PLUS NUMBER',   // 3 symbols
    '     {',
    '       $$ = $5;',              // $5 out of bounds
    '     }',
    '     | NUMBER',
    '     ;',
    '%%',
  ].join('\n');

  const docMLAOob = parseBisonDocument(bisonMLAOob);
  const mlaOobDiags = computeBisonDiagnostics(docMLAOob, bisonMLAOob)
    .filter(d => d.message.includes('$5') && d.message.includes('out of bounds'));
  assert(mlaOobDiags.length >= 1, `$5 in multi-line action (3 symbols) is detected`);
  assert(mlaOobDiags[0]?.severity === 1, `Multi-line action $5 out-of-bounds is an Error`);
}

// ════════════════════════════════════════
// TEST 23: Flex — POSIX character class patterns shadow keywords
// ════════════════════════════════════════
console.log('\n\n=== TEST: Flex POSIX class keyword overlap ===\n');

{
  // [[:alpha:]][[:alnum:]_]* is a general identifier matcher; 'if' after it is shadowed
  const flexSrc = [
    '%option noyywrap',
    '%%',
    '[[:alpha:]][[:alnum:]_]*  { /* identifier */ }',
    'if                        { /* keyword — shadowed */ }',
    '%%',
  ].join('\n');

  const { parseFlexDocument: pflexPosix } = require('../server/src/parser/flexParser');
  const flexDoc = pflexPosix(flexSrc);
  const diags = computeFlexDiagnostics(flexDoc, flexSrc);

  const overlapDiags = diags.filter(d => d.message.includes('shadowed') || d.message.includes('keyword'));
  assert(overlapDiags.length >= 1, `POSIX-class identifier pattern shadows 'if' keyword`);
  assert(overlapDiags[0]?.severity === 2, `POSIX keyword overlap Warning has Warning severity`);

  // Keyword BEFORE POSIX pattern → no warning
  const flexOk = [
    '%option noyywrap',
    '%%',
    'if                        { /* keyword first */ }',
    '[[:alpha:]][[:alnum:]_]*  { /* identifier */ }',
    '%%',
  ].join('\n');
  const flexDocOk = pflexPosix(flexOk);
  const okDiags = computeFlexDiagnostics(flexDocOk, flexOk);
  const okOverlap = okDiags.filter(d => d.message.includes('shadowed') || d.message.includes('keyword'));
  assert(okOverlap.length === 0, `Keyword before POSIX pattern is not flagged`);
}

// ════════════════════════════════════════
// TEST 24: %start references non-existent rule (NEW 5)
// ════════════════════════════════════════
console.log('\n\n=== TEST: %start references non-existent rule ===\n');

{
  const bisonBad = [
    '%token NUMBER',
    '%start missing_rule',
    '%%',
    'program : NUMBER ;',
    '%%',
  ].join('\n');

  const docBad = parseBisonDocument(bisonBad);
  assert(docBad.startSymbol === 'missing_rule', `%start 'missing_rule' parsed`);
  const diagsBad = computeBisonDiagnostics(docBad, bisonBad);
  const startErrDiags = diagsBad.filter(d => d.message.includes('missing_rule') && d.message.includes('no corresponding rule'));
  assert(startErrDiags.length >= 1, `%start with non-existent rule produces an Error`);
  assert(startErrDiags[0]?.severity === 1, `%start missing rule diagnostic has Error severity`);

  // Valid %start — no error
  const bisonOk = [
    '%token NUMBER',
    '%start program',
    '%%',
    'program : NUMBER ;',
    '%%',
  ].join('\n');
  const docOk = parseBisonDocument(bisonOk);
  const diagsOk = computeBisonDiagnostics(docOk, bisonOk);
  const startErrOk = diagsOk.filter(d => d.message.includes('no corresponding rule'));
  assert(startErrOk.length === 0, `Valid %start does not produce an Error`);
}

// ════════════════════════════════════════
// TEST 25: %prec with undeclared token (NEW 6)
// ════════════════════════════════════════
console.log('\n\n=== TEST: %prec with undeclared token ===\n');

{
  const bisonBad = [
    '%token NUMBER PLUS',
    '%%',
    'start : expr ;',
    'expr : expr PLUS expr %prec NONEXISTENT',
    '     | NUMBER',
    '     ;',
    '%%',
  ].join('\n');

  const docBad = parseBisonDocument(bisonBad);
  const diagsBad = computeBisonDiagnostics(docBad, bisonBad);
  const precDiags = diagsBad.filter(d => d.message.includes('NONEXISTENT') && d.message.includes('%prec'));
  assert(precDiags.length >= 1, `%prec with undeclared token produces a Warning`);
  assert(precDiags[0]?.severity === 2, `%prec undeclared token has Warning severity`);

  // %prec with a declared token → no warning
  const bisonOk = [
    '%token NUMBER PLUS',
    '%right UMINUS',
    '%%',
    'start : expr ;',
    'expr : expr PLUS expr %prec UMINUS',
    '     | NUMBER',
    '     ;',
    '%%',
  ].join('\n');
  const docOk = parseBisonDocument(bisonOk);
  const diagsOk = computeBisonDiagnostics(docOk, bisonOk);
  const precOk = diagsOk.filter(d => d.message.includes('UMINUS') && d.message.includes('%prec'));
  assert(precOk.length === 0, `%prec with declared token is not flagged`);
}

// ════════════════════════════════════════
// TEST 26: Duplicate rule definitions (NEW 7)
// ════════════════════════════════════════
console.log('\n\n=== TEST: Duplicate rule definitions ===\n');

{
  const bisonDup = [
    '%token NUMBER PLUS',
    '%%',
    'start : expr ;',
    'expr : NUMBER PLUS NUMBER ;',
    'expr : NUMBER ;',           // duplicate!
    '%%',
  ].join('\n');

  const docDup = parseBisonDocument(bisonDup);
  assert(docDup.duplicateRules.length >= 1, `Duplicate rule 'expr' recorded`);
  assert(docDup.duplicateRules[0].name === 'expr', `Duplicate rule name is 'expr'`);

  const diagsDup = computeBisonDiagnostics(docDup, bisonDup);
  const dupDiags = diagsDup.filter(d => d.message.includes("'expr'") && d.message.includes('more than once'));
  assert(dupDiags.length >= 1, `Duplicate rule produces a Warning`);
  assert(dupDiags[0]?.severity === 2, `Duplicate rule Warning has Warning severity`);

  // No duplicate → no warning
  const bisonOk = [
    '%token NUMBER PLUS',
    '%%',
    'start : expr ;',
    'expr : NUMBER PLUS NUMBER',
    '     | NUMBER',
    '     ;',
    '%%',
  ].join('\n');
  const docOk = parseBisonDocument(bisonOk);
  assert(docOk.duplicateRules.length === 0, `No duplicate rules in valid grammar`);
  const diagsOk = computeBisonDiagnostics(docOk, bisonOk);
  const dupOk = diagsOk.filter(d => d.message.includes('more than once'));
  assert(dupOk.length === 0, `No duplicate warning in valid grammar`);
}

// ════════════════════════════════════════
// TEST 27: Rule with no base case (NEW 8)
// ════════════════════════════════════════
console.log('\n\n=== TEST: Rule with no base case ===\n');

{
  // All alternatives are recursive — no base case
  const bisonInfinite = [
    '%token PLUS',
    '%%',
    'start : expr ;',
    'expr : expr PLUS expr',
    '     | expr PLUS expr PLUS expr',
    '     ;',
    '%%',
  ].join('\n');

  const docInf = parseBisonDocument(bisonInfinite);
  const diagsInf = computeBisonDiagnostics(docInf, bisonInfinite);
  const baseDiags = diagsInf.filter(d => d.message.includes('no base case') && d.message.includes("'expr'"));
  assert(baseDiags.length >= 1, `Fully-recursive rule produces a Warning`);
  assert(baseDiags[0]?.severity === 2, `No-base-case Warning has Warning severity`);

  // Grammar with a base case — must NOT warn
  const bisonOk = [
    '%token NUMBER PLUS',
    '%%',
    'start : expr ;',
    'expr : expr PLUS NUMBER',
    '     | NUMBER',
    '     ;',
    '%%',
  ].join('\n');
  const docOk = parseBisonDocument(bisonOk);
  const diagsOk = computeBisonDiagnostics(docOk, bisonOk);
  const baseOk = diagsOk.filter(d => d.message.includes('no base case') && d.message.includes("'expr'"));
  assert(baseOk.length === 0, `Rule with base case does not trigger warning`);
}

// ════════════════════════════════════════
// TEST 28: Flex — multiple <<EOF>> rules for same context (NEW 8)
// ════════════════════════════════════════
console.log('\n\n=== TEST: Flex duplicate <<EOF>> rules ===\n');

{
  const flexDup = [
    '%option noyywrap',
    '%%',
    '<<EOF>>   { return 0; }',
    '<<EOF>>   { return 1; }',  // duplicate for INITIAL context
    '[a-z]+    { }',
    '%%',
  ].join('\n');

  const { parseFlexDocument: pflexEof } = require('../server/src/parser/flexParser');
  const flexDoc = pflexEof(flexDup);
  const diags = computeFlexDiagnostics(flexDoc, flexDup);

  const eofDiags = diags.filter(d => d.message.includes('<<EOF>>') && d.message.includes('Duplicate'));
  assert(eofDiags.length >= 1, `Duplicate <<EOF>> rules produce a Warning`);
  assert(eofDiags[0]?.severity === 2, `Duplicate <<EOF>> Warning has Warning severity`);

  // Single <<EOF>> — no warning
  const flexOk = [
    '%option noyywrap',
    '%%',
    '[a-z]+    { }',
    '<<EOF>>   { return 0; }',
    '%%',
  ].join('\n');
  const flexDocOk = pflexEof(flexOk);
  const okDiags = computeFlexDiagnostics(flexDocOk, flexOk);
  const eofOk = okDiags.filter(d => d.message.includes('<<EOF>>') && d.message.includes('Duplicate'));
  assert(eofOk.length === 0, `Single <<EOF>> rule does not trigger a warning`);
}

// ════════════════════════════════════════
// TEST 29: Flex — %option stack without stack calls (NEW 9)
// ════════════════════════════════════════
console.log('\n\n=== TEST: Flex %option stack unused ===\n');

{
  const flexUnused = [
    '%option noyywrap stack',
    '%%',
    '[a-z]+   { }',
    '%%',
  ].join('\n');

  const { parseFlexDocument: pflexStack } = require('../server/src/parser/flexParser');
  const flexDoc = pflexStack(flexUnused);
  const diags = computeFlexDiagnostics(flexDoc, flexUnused);

  const stackDiags = diags.filter(d => d.message.includes('stack') && d.message.includes('yy_push_state'));
  assert(stackDiags.length >= 1, `%option stack without stack calls produces a Warning`);
  assert(stackDiags[0]?.severity === 2, `Unused stack option has Warning severity`);

  // With yy_push_state in code → no warning
  const flexUsed = [
    '%option noyywrap stack',
    '%%',
    '[a-z]+   { yy_push_state(0); }',
    '%%',
  ].join('\n');
  const flexDocUsed = pflexStack(flexUsed);
  const usedDiags = computeFlexDiagnostics(flexDocUsed, flexUsed);
  const stackUsed = usedDiags.filter(d => d.message.includes('stack') && d.message.includes('yy_push_state'));
  assert(stackUsed.length === 0, `%option stack with yy_push_state call is not flagged`);
}

// ════════════════════════════════════════
// TEST: P1 — Token alias used in rules
// ════════════════════════════════════════
console.log('\n\n=== TEST: P1 — Token alias usage ===\n');

{
  // AND declared with alias "&", used via alias in rules → must NOT be "unused"
  const src = [
    '%token AND "&"',
    '%token OR  "|"',
    '%%',
    'start : expr ;',
    'expr  : expr "&" expr | expr "|" expr | "a" ;',
    '%%',
  ].join('\n');

  const doc = parseBisonDocument(src);
  assert(doc.tokens.has('AND'), 'AND token registered');
  assert(doc.tokens.get('AND')?.alias === '&', 'AND alias is "&"');
  // ruleReferences should contain "&" and "|" (unquoted aliases)
  assert(doc.ruleReferences.has('&'), 'Alias "&" tracked in ruleReferences');
  assert(doc.ruleReferences.has('|'), 'Alias "|" tracked in ruleReferences');

  const diags = computeBisonDiagnostics(doc, src);
  const unusedAnd = diags.find(d => d.message.includes("'AND'") && d.message.includes('never used'));
  const unusedOr  = diags.find(d => d.message.includes("'OR'")  && d.message.includes('never used'));
  assert(unusedAnd === undefined, 'No false "AND unused" warning when alias "&" is used');
  assert(unusedOr  === undefined, 'No false "OR unused" warning when alias "|" is used');
}

// ════════════════════════════════════════
// TEST: P2 — %token declared after %%
// ════════════════════════════════════════
console.log('\n\n=== TEST: P2 — %%token after %% ===\n');

{
  const src = [
    '%token KNOWN "k"',
    '%%',
    '%token CHUNKS "_chunks"',
    'start : KNOWN CHUNKS ;',
    '%token EXP_META "_exp"',
    'extra : EXP_META ;',
    '%%',
  ].join('\n');

  const doc = parseBisonDocument(src);
  assert(doc.tokens.has('CHUNKS'),   '%token CHUNKS registered after %%');
  assert(doc.tokens.has('EXP_META'), '%token EXP_META registered after %%');
  assert(doc.tokens.get('CHUNKS')?.alias   === '_chunks', 'CHUNKS alias is "_chunks"');
  assert(doc.tokens.get('EXP_META')?.alias === '_exp',    'EXP_META alias is "_exp"');

  const diags = computeBisonDiagnostics(doc, src);
  const unusedChunks  = diags.find(d => d.message.includes("'CHUNKS'") && d.message.includes('never used'));
  const unusedExpMeta = diags.find(d => d.message.includes("'EXP_META'") && d.message.includes('never used'));
  assert(unusedChunks  === undefined, 'No false "CHUNKS unused" warning');
  assert(unusedExpMeta === undefined, 'No false "EXP_META unused" warning');
}

// ════════════════════════════════════════
// TEST: P3 — %parse-param / %lex-param not legacy
// ════════════════════════════════════════
console.log('\n\n=== TEST: P3 — %parse-param not legacy ===\n');

{
  const src = [
    '%token ID',
    '%parse-param { TigerDriver& drv }',
    '%lex-param   { TigerDriver& drv }',
    '%%',
    'start : ID ;',
    '%%',
  ].join('\n');

  const doc = parseBisonDocument(src);
  const diags = computeBisonDiagnostics(doc, src);
  const legacyParse = diags.find(d => d.source === 'bison-yacc-compat' && d.message.includes('parse-param'));
  const legacyLex   = diags.find(d => d.source === 'bison-yacc-compat' && d.message.includes('lex-param'));
  assert(legacyParse === undefined, 'No Yacc-legacy hint for %parse-param');
  assert(legacyLex   === undefined, 'No Yacc-legacy hint for %lex-param');
}

// ════════════════════════════════════════
// TEST: P4 — RE-flex standalone directives
// ════════════════════════════════════════
console.log('\n\n=== TEST: P4 — RE-flex directives ===\n');

{
  const { parseFlexDocument: pflexReflex } = require('../server/src/parser/flexParser');

  const src = [
    '%option bison-complete bison-locations',
    '%namespace parse',
    '%lexer Lexer',
    '%lex lex',
    '%unicode',
    '%x SC_COMMENT',
    '%%',
    '<SC_COMMENT>. ;',
    '%%',
  ].join('\n');

  const doc = pflexReflex(src);
  assert(doc.unknownDirectives.length === 0,
    `No unknown directive warnings for RE-flex directives (got ${doc.unknownDirectives.length}: ${doc.unknownDirectives.map((d: any) => d.name).join(', ')})`);

  const diags = computeFlexDiagnostics(doc, src);
  const unknowns = diags.filter((d: any) => d.message.includes('Unknown Flex directive'));
  assert(unknowns.length === 0, 'No "Unknown Flex directive" errors for RE-flex file');
}

// ════════════════════════════════════════
// TEST: P5 — RE-flex noyywrap false positive
// ════════════════════════════════════════
console.log('\n\n=== TEST: P5 — RE-flex noyywrap suppression ===\n');

{
  const { parseFlexDocument: pflexNw } = require('../server/src/parser/flexParser');

  // RE-flex file without noyywrap — should NOT warn because it uses bison-complete
  const src = [
    '%option bison-complete bison-locations',
    '%option namespace=parse lexer=Lexer lex=lex',
    '%x SC_COMMENT',
    '%%',
    '<SC_COMMENT>. ;',
    '%%',
  ].join('\n');

  const doc = pflexNw(src);
  const diags = computeFlexDiagnostics(doc, src);
  const noyywrapWarn = diags.find((d: any) => d.message.includes('noyywrap'));
  assert(noyywrapWarn === undefined, 'No "missing noyywrap" warning for RE-flex file with bison-complete');
}

// ════════════════════════════════════════
// TEST: P6 — RE-flex function docs
// ════════════════════════════════════════
console.log('\n\n=== TEST: P6 — RE-flex function documentation ===\n');

{
  assert(flexBuiltinDocs.has('size'),    'flexBuiltinDocs has "size" (RE-flex yyleng equivalent)');
  assert(flexBuiltinDocs.has('lineno'),  'flexBuiltinDocs has "lineno" (RE-flex yylineno equivalent)');
  assert(flexBuiltinDocs.has('columno'), 'flexBuiltinDocs has "columno" (RE-flex column accessor)');
  assert(flexBuiltinDocs.has('in'),      'flexBuiltinDocs has "in" (RE-flex input stream)');
  assert(flexBuiltinDocs.has('out'),     'flexBuiltinDocs has "out" (RE-flex output stream)');
  assert(flexBuiltinDocs.has('start'),   'flexBuiltinDocs has "start" (RE-flex BEGIN equivalent)');
  assert(flexBuiltinDocs.has('text'),    'flexBuiltinDocs has "text" (RE-flex yytext equivalent)');
}

// ════════════════════════════════════════
// TEST: P7 — <SC><<EOF>> not inaccessible
// ════════════════════════════════════════
console.log('\n\n=== TEST: P7 — <SC><<EOF>> not flagged inaccessible ===\n');

{
  const { parseFlexDocument: pflexEof } = require('../server/src/parser/flexParser');

  // A catch-all `.` in SC_COMMENT before the <<EOF>> rule must NOT trigger
  // "inaccessible rule" on the <<EOF>> pattern.
  const src = [
    '%option noyywrap',
    '%x SC_COMMENT SC_STRING',
    '%%',
    '<SC_COMMENT>.           { /* skip */ }',
    '<SC_COMMENT>\\n          { /* skip */ }',
    '<SC_COMMENT><<EOF>>     { yyerror("unclosed comment"); yyterminate(); }',
    '<SC_STRING>.            { /* skip */ }',
    '<SC_STRING><<EOF>>      { yyerror("unclosed string"); yyterminate(); }',
    '%%',
  ].join('\n');

  const doc = pflexEof(src);
  const diags = computeFlexDiagnostics(doc, src);
  const eofInaccessible = diags.filter((d: any) =>
    d.message.includes('<<EOF>>') && d.message.includes('inaccessible'));
  assert(eofInaccessible.length === 0,
    `No inaccessible-rule warning for <SC><<EOF>> (got ${eofInaccessible.length})`);
}

// ════════════════════════════════════════
// TEST: Tiger grammar patterns (parsetiger.yy regressions)
// ════════════════════════════════════════
console.log('\n\n=== TEST: Tiger grammar regressions ===\n');

{
  // ── Regression 1: string-alias tokens not counted as symbols ($n OOB) ──
  // `"-" exp %prec UMINUS { ... $2 ... }` must count "-" as symbol $1
  // so that $2 (exp) is in bounds.
  const srcUnary = [
    '%token UMINUS',
    '%nonassoc UMINUS',
    '%%',
    'exp : "-" exp %prec UMINUS { $$ = $2; }',
    '    | "a" ;',
    '%%',
  ].join('\n');
  const docUnary = parseBisonDocument(srcUnary);
  const diagsUnary = computeBisonDiagnostics(docUnary, srcUnary);
  const oobUnary = diagsUnary.filter(d => d.message.includes('out of bounds'));
  assert(oobUnary.length === 0,
    `No $n OOB error for '"-" exp %prec UMINUS { $2 }' (got ${oobUnary.map(d => d.message).join('; ')})`);

  // ── Regression 2: "if" exp "then" exp has $2/$4 in bounds ──
  const srcIf = [
    '%token THEN ELSE',
    '%precedence THEN ELSE',
    '%%',
    'exp : "if" exp "then" exp %prec THEN { $$ = $4; }',
    '    | "if" exp "then" exp "else" exp %prec ELSE { $$ = $6; }',
    '    | "a" ;',
    '%%',
  ].join('\n');
  const docIf = parseBisonDocument(srcIf);
  const diagsIf = computeBisonDiagnostics(docIf, srcIf);
  const oobIf = diagsIf.filter(d => d.message.includes('out of bounds'));
  assert(oobIf.length === 0,
    `No $n OOB for if-then and if-then-else patterns (got ${oobIf.map(d => d.message).join('; ')})`);

  // ── Regression 3: fundec-style — all alts start with different string literals ──
  // Must NOT produce a shift/reduce conflict (alts start with "function"/"primitive"/"method")
  const srcFundec = [
    '%token ID VARCHUNK TYPEID EXP',
    '%precedence CHUNKS',
    '%%',
    'fundec',
    '  : "function" ID "(" VARCHUNK ")" ":" TYPEID "=" EXP { $$ = $9; }',
    '  | "function" ID "(" VARCHUNK ")" "=" EXP             { $$ = $7; }',
    '  | "primitive" ID "(" VARCHUNK ")" ":" TYPEID         { $$ = $7; }',
    '  | "primitive" ID "(" VARCHUNK ")"                    { $$ = $4; }',
    '  | "method" ID "(" VARCHUNK ")" ":" TYPEID "=" EXP   { $$ = $9; }',
    '  | "method" ID "(" VARCHUNK ")" "=" EXP              { $$ = $7; }',
    '  ;',
    '%%',
  ].join('\n');
  const docFundec = parseBisonDocument(srcFundec);
  const diagsFundec = computeBisonDiagnostics(docFundec, srcFundec);
  const srFundec = diagsFundec.filter(d =>
    d.message.includes('shift/reduce') && d.message.includes('fundec'));
  assert(srFundec.length === 0,
    `No false shift/reduce on fundec (all alts start with distinct strings, got: ${srFundec.map(d => d.message).join('; ')})`);

  // ── Regression 4: tokens used via alias must not be "unused" ──
  // LBRACE declares alias "{", used in rules as "{"  ← must not be flagged unused
  const srcBraces = [
    '%token LBRACE "{"',
    '%token RBRACE "}"',
    '%token COLON  ":"',
    '%token ID TYPEID',
    '%%',
    'tyfield : ID ":" TYPEID ;',
    'ty      : "{" tyfields "}" ;',
    'tyfields : %empty ;',
    '%%',
  ].join('\n');
  const docBraces = parseBisonDocument(srcBraces);
  const diagsBraces = computeBisonDiagnostics(docBraces, srcBraces);
  const unusedLBRACE = diagsBraces.find(d => d.message.includes("'LBRACE'") && d.message.includes('never used'));
  const unusedRBRACE = diagsBraces.find(d => d.message.includes("'RBRACE'") && d.message.includes('never used'));
  const unusedCOLON  = diagsBraces.find(d => d.message.includes("'COLON'")  && d.message.includes('never used'));
  assert(unusedLBRACE === undefined, 'No false "LBRACE unused" when "{" alias is used in rules');
  assert(unusedRBRACE === undefined, 'No false "RBRACE unused" when "}" alias is used in rules');
  assert(unusedCOLON  === undefined, 'No false "COLON unused" when ":" alias is used in rules');

  // Also verify alias "{" IS tracked in ruleReferences
  assert(docBraces.ruleReferences.has('{'), 'Alias "{" tracked in ruleReferences for LBRACE');
  assert(docBraces.ruleReferences.has('}'), 'Alias "}" tracked in ruleReferences for RBRACE');
  assert(docBraces.ruleReferences.has(':'), 'Alias ":" tracked in ruleReferences for COLON');

  // ── Regression 5: ID "{" fieldinits "}" — $1/$3 in bounds ──
  const srcRecord = [
    '%token ID TYPEID',
    '%token FIELDINITS',
    '%%',
    'exp : ID "{" FIELDINITS "}" { $$ = $3; }',
    '    | "a" ;',
    '%%',
  ].join('\n');
  const docRecord = parseBisonDocument(srcRecord);
  const diagsRecord = computeBisonDiagnostics(docRecord, srcRecord);
  const oobRecord = diagsRecord.filter(d => d.message.includes('out of bounds'));
  assert(oobRecord.length === 0,
    `No $n OOB for 'ID "{" FIELDINITS "}" { $3 }' (got ${oobRecord.map(d => d.message).join('; ')})`);
}

// ════════════════════════════════════════
// TEST: rawPattern — character class with spaces (\\[ \t\n]+\\)
// ════════════════════════════════════════
console.log('\n\n=== TEST: Flex rawPattern with spaces inside character class ===\n');
{
  // Pattern \\[ \t\n]+\\ has a space inside [...], rawPattern must not truncate at the space.
  // Previously it returned "\\[" which failed regex validation.
  const src = [
    '%option noyywrap',
    '%%',
    '<SC_STRING>\\\\[ \\t\\n]+\\\\ { /* ignore whitespace gap */ }',
    '.',
    '%%',
  ].join('\n');
  const docWs = parseFlexDocument(src);
  const diagsWs = computeFlexDiagnostics(docWs, src);
  const invalidRegex = diagsWs.filter(d => d.message.includes('Invalid regex pattern'));
  assert(invalidRegex.length === 0,
    `No 'Invalid regex pattern' for \\\\[ \\t\\n]+\\\\ pattern (got ${invalidRegex.map(d => d.message).join('; ')})`);
}

// ════════════════════════════════════════
// TEST: single-line block comments in Flex rules section not parsed as rules
// ════════════════════════════════════════
console.log('\n\n=== TEST: Flex single-line /* */ comments not parsed as rules ===\n');
{
  const src = [
    '%option noyywrap',
    '%%',
    '  /* Keywords */',
    '"if"   { return 1; }',
    '  /* Operators */',
    '"+"    { return 2; }',
    '  /* also a comment */',
    '"/*"   { return 3; }',
    '%%',
  ].join('\n');
  const docComment = parseFlexDocument(src);
  const diagsComment = computeFlexDiagnostics(docComment, src);
  const dupDiags = diagsComment.filter(d => d.message.includes('inaccessible') && d.message.includes('identical'));
  assert(dupDiags.length === 0,
    `No false 'identical pattern' from /* */ comments in rules section (got ${dupDiags.map(d => d.message).join('; ')})`);
  // The only rules should be the actual patterns, not the comments
  assert(docComment.rules.length === 3,
    `Exactly 3 rules parsed (not the /* */ comments), got ${docComment.rules.length}`);
}

// ════════════════════════════════════════
// TEST: $n with single-quoted and double-quoted literals (issue #4)
// ════════════════════════════════════════
console.log('\n\n=== TEST: $n bounds — literals counted as symbols ===\n');

{
  // rule: A '(' B ')' { $$ = $3; } → 4 symbols, $3 valid → 0 diagnostics
  const bisonLit = [
    '%token A B',
    '%%',
    'start : rule ;',
    "rule : A '(' B ')' { $$ = $3; }",
    '%%',
  ].join('\n');
  const docLit = parseBisonDocument(bisonLit);
  const diagsLit = computeBisonDiagnostics(docLit, bisonLit);
  const oobLit = diagsLit.filter(d => d.message.includes('out of bounds'));
  assert(oobLit.length === 0,
    `Single-quoted literals '(' and ')' are counted as symbols — $3 in A '(' B ')' must not be flagged (got: ${oobLit.map(d => d.message).join('; ')})`);

  // rule: A "and" B "or" C { $$ = $4; } → 5 symbols, $4 valid → 0 diagnostics
  const bisonAlias = [
    '%token A B C',
    '%%',
    'start : rule ;',
    'rule : A "and" B "or" C { $$ = $4; }',
    '%%',
  ].join('\n');
  const docAlias = parseBisonDocument(bisonAlias);
  const diagsAlias = computeBisonDiagnostics(docAlias, bisonAlias);
  const oobAlias = diagsAlias.filter(d => d.message.includes('out of bounds'));
  assert(oobAlias.length === 0,
    `Double-quoted aliases "and" and "or" are counted as symbols — $4 in A "and" B "or" C must not be flagged (got: ${oobAlias.map(d => d.message).join('; ')})`);

  // rule: A B { $$ = $4; } → 3 symbols (A + B + action), $4 out of bounds → 1 Error
  // (The action block counts as symbol #3; $4 exceeds the total of 3 symbols.)
  const bisonOob = [
    '%token A B',
    '%%',
    'start : rule ;',
    'rule : A B { $$ = $4; }',
    '%%',
  ].join('\n');
  const docOob = parseBisonDocument(bisonOob);
  const diagsOob = computeBisonDiagnostics(docOob, bisonOob);
  const oobOob = diagsOob.filter(d => d.message.includes('$4') && d.message.includes('out of bounds'));
  assert(oobOob.length >= 1,
    `$4 in a 3-symbol rule A B {action} must be flagged as out of bounds`);
  assert(oobOob[0]?.severity === 1,
    `$4 out-of-bounds diagnostic has Error severity`);
}

// ════════════════════════════════════════
// TEST: Lowercase / mixed-case token names (issue #5)
// ════════════════════════════════════════
console.log('\n=== TEST: Lowercase and mixed-case token names (issue #5) ===\n');

{
  // Each %token declaration with a lowercase/mixed name should produce exactly one token entry.
  const cases: Array<{ line: string; name: string }> = [
    { line: '%token STANDARD_202x "STANDARD-202x"', name: 'STANDARD_202x' },
    { line: '%token lower_case_tok "lower"',         name: 'lower_case_tok' },
    { line: '%token MIXEDcase123 "mixed"',            name: 'MIXEDcase123'  },
    { line: '%token A_1_B_2_C "alias"',               name: 'A_1_B_2_C'    },
  ];

  for (const { line, name } of cases) {
    const src = [line, '%%', 'start : ;', '%%'].join('\n');
    const doc = parseBisonDocument(src);
    assert(doc.tokens.has(name),
      `parseTokenNames: '${line}' → token '${name}' is registered`);
    assert(doc.tokens.size === 1,
      `parseTokenNames: '${line}' → exactly 1 token (got ${doc.tokens.size}: ${[...doc.tokens.keys()].join(', ')})`);
  }

  // When those tokens are USED in rules → 0 "unused token" warnings.
  const usedSrc = [
    '%token STANDARD_202x "STANDARD-202x"',
    '%token lower_case_tok "lower"',
    '%token MIXEDcase123 "mixed"',
    '%token A_1_B_2_C "alias"',
    '%%',
    'start : STANDARD_202x lower_case_tok MIXEDcase123 A_1_B_2_C ;',
    '%%',
  ].join('\n');
  const usedDoc = parseBisonDocument(usedSrc);
  const usedDiags = computeBisonDiagnostics(usedDoc, usedSrc);
  const unusedWarnings = usedDiags.filter(d => d.message.includes('declared but never used'));
  assert(unusedWarnings.length === 0,
    `All four mixed-case tokens used in rules → 0 "unused" warnings (got ${unusedWarnings.length}: ${unusedWarnings.map(d => d.message).join('; ')})`);

  // When those tokens are NOT used → exactly 1 warning each, with the full token name.
  const unusedSrc = [
    '%token STANDARD_202x "STANDARD-202x"',
    '%token lower_case_tok "lower"',
    '%token MIXEDcase123 "mixed"',
    '%token A_1_B_2_C "alias"',
    '%%',
    'start : ;',
    '%%',
  ].join('\n');
  const unusedDoc = parseBisonDocument(unusedSrc);
  const unusedDiags = computeBisonDiagnostics(unusedDoc, unusedSrc);
  const allUnused = unusedDiags.filter(d => d.message.includes('declared with %token but never used'));
  assert(allUnused.length === 4,
    `Four unused mixed-case tokens → exactly 4 warnings (got ${allUnused.length}: ${allUnused.map(d => d.message).join('; ')})`);
  for (const name of ['STANDARD_202x', 'lower_case_tok', 'MIXEDcase123', 'A_1_B_2_C']) {
    const w = allUnused.find(d => d.message.includes(`'${name}'`));
    assert(w !== undefined,
      `Unused token warning for '${name}' uses the full name (not a fragment)`);
  }
}

// ════════════════════════════════════════
// TEST: Comments in rules ignored (issue #8)
// ════════════════════════════════════════
console.log('\n=== TEST: Comments in rules ignored (issue #8) ===\n');

{
  // Test 1: Inline /* */ block comment — token inside must NOT be flagged
  const src1 = [
    '%token TOKEN_A TOKEN_B',
    '%%',
    'start : rule ;',
    'rule : TOKEN_A /* FAKE_COMMENT_TOKEN */ TOKEN_B { $$ = $1; }',
    '%%',
  ].join('\n');
  const doc1 = parseBisonDocument(src1);
  const diags1 = computeBisonDiagnostics(doc1, src1);
  const fake1 = diags1.filter(d => d.message.includes('FAKE_COMMENT_TOKEN'));
  assert(fake1.length === 0,
    `FAKE_COMMENT_TOKEN inside /* */ must NOT be flagged (got ${fake1.length} diag(s): ${fake1.map(d => d.message).join('; ')})`);

  // Test 2: // line comment — token inside must NOT be flagged
  const src2 = [
    '%token TOKEN_C',
    '%%',
    'start : rule ;',
    'rule : TOKEN_C // ANOTHER_FAKE_TOKEN',
    '    { }',
    '%%',
  ].join('\n');
  const doc2 = parseBisonDocument(src2);
  const diags2 = computeBisonDiagnostics(doc2, src2);
  const fake2 = diags2.filter(d => d.message.includes('ANOTHER_FAKE_TOKEN'));
  assert(fake2.length === 0,
    `ANOTHER_FAKE_TOKEN after // must NOT be flagged (got ${fake2.length} diag(s))`);

  // Test 3: Action block { } — identifier inside must NOT be flagged
  const src3 = [
    '%token TOKEN_D',
    '%%',
    'start : rule ;',
    'rule : TOKEN_D { int x = LOOKS_LIKE_TOKEN; }',
    '%%',
  ].join('\n');
  const doc3 = parseBisonDocument(src3);
  const diags3 = computeBisonDiagnostics(doc3, src3);
  const fake3 = diags3.filter(d => d.message.includes('LOOKS_LIKE_TOKEN'));
  assert(fake3.length === 0,
    `LOOKS_LIKE_TOKEN inside action block { } must NOT be flagged (got ${fake3.length} diag(s))`);

  // Test 4: Multi-line /* */ block comment — tokens inside must NOT be flagged
  const src4 = [
    '%token TOKEN_E TOKEN_F',
    '%%',
    'start : rule ;',
    'rule : TOKEN_E /* FAKE_1',
    '               FAKE_2 */ TOKEN_F',
    '%%',
  ].join('\n');
  const doc4 = parseBisonDocument(src4);
  const diags4 = computeBisonDiagnostics(doc4, src4);
  const fake4a = diags4.filter(d => d.message.includes('FAKE_1'));
  const fake4b = diags4.filter(d => d.message.includes('FAKE_2'));
  assert(fake4a.length === 0,
    `FAKE_1 inside multi-line /* */ must NOT be flagged (got ${fake4a.length} diag(s))`);
  assert(fake4b.length === 0,
    `FAKE_2 inside multi-line /* */ must NOT be flagged (got ${fake4b.length} diag(s))`);

  // Test 5: Real undeclared token (not in a comment or action) MUST be flagged
  const src5 = [
    '%token TOKEN_G',
    '%%',
    'start : rule ;',
    'rule : TOKEN_G UNDECLARED_TOKEN',
    '%%',
  ].join('\n');
  const doc5 = parseBisonDocument(src5);
  const diags5 = computeBisonDiagnostics(doc5, src5);
  const undeclared5 = diags5.filter(d => d.message.includes('UNDECLARED_TOKEN'));
  assert(undeclared5.length >= 1,
    `UNDECLARED_TOKEN (not in /* */ or {}) MUST be flagged (got ${undeclared5.length} diag(s))`);
}

// ════════════════════════════════════════
// SUMMARY
// ════════════════════════════════════════
console.log(`\n${'='.repeat(50)}`);
console.log(`  RESULTS: ${passed} passed, ${failed} failed`);
console.log(`${'='.repeat(50)}\n`);

process.exit(failed > 0 ? 1 : 0);
