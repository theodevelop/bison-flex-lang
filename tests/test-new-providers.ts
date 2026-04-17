/**
 * Tests for new providers:
 *  - crossFileSync (token sync .y ↔ .l)
 *  - codeActions   (quick fix "declare token")
 *  - foldingRanges
 */

import { parseBisonDocument } from '../server/src/parser/bisonParser';
import { parseFlexDocument }  from '../server/src/parser/flexParser';
import {
  extractReturnedTokens,
  computeBisonCrossFileDiagnostics,
  computeFlexCrossFileDiagnostics,
} from '../server/src/providers/crossFileSync';
import { getFoldingRanges } from '../server/src/providers/foldingRanges';
import { getCodeActions }   from '../server/src/providers/codeActions';
import { TextDocument }     from 'vscode-languageserver-textdocument';
import {
  CodeActionParams,
  Diagnostic,
  DiagnosticSeverity,
  Range,
} from 'vscode-languageserver';

let passed = 0;
let failed = 0;

function assert(cond: boolean, msg: string, extra?: unknown) {
  if (cond) {
    console.log(`  [PASS] ${msg}`);
    passed++;
  } else {
    console.error(`  [FAIL] ${msg}${extra !== undefined ? `  →  ${JSON.stringify(extra)}` : ''}`);
    failed++;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. extractReturnedTokens
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n=== TEST: extractReturnedTokens ===');

const flexSrc = `
%%
[0-9]+  { return NUMBER; }
"+"     { return PLUS; }
"-"     { return MINUS; }
.       { /* ignore */ }
%%
`;

const ret = extractReturnedTokens(flexSrc);
assert(ret.has('NUMBER'), 'NUMBER detected');
assert(ret.has('PLUS'),   'PLUS detected');
assert(ret.has('MINUS'),  'MINUS detected');
assert(!ret.has('ignore'), 'C comment body not captured');

// return(TOKEN); style
const ret2 = extractReturnedTokens('%%\n[a-z]+  { return(WORD); }\n%%\n');
assert(ret2.has('WORD'), 'return(WORD) style detected');

// namespace style: return token::NUMBER;
const ret3 = extractReturnedTokens('%%\n[0-9]+ { return token::NUMBER; }\n%%\n');
assert(ret3.has('NUMBER'), 'namespace-qualified return detected');

// ─────────────────────────────────────────────────────────────────────────────
// 2. computeBisonCrossFileDiagnostics
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n=== TEST: Bison cross-file diagnostics ===');

const bisonSrc = `
%token NUMBER PLUS MISSING_IN_FLEX
%%
expr : expr PLUS NUMBER { }
     | NUMBER            { }
     ;
%%
`;
const bisonDoc = parseBisonDocument(bisonSrc);
const bisonDiags = computeBisonCrossFileDiagnostics(bisonDoc, flexSrc, 'file:///test.l');

const missingDiag = bisonDiags.find((d: Diagnostic) => d.message.includes('MISSING_IN_FLEX'));
assert(!!missingDiag, 'MISSING_IN_FLEX flagged');
assert(missingDiag?.severity === DiagnosticSeverity.Warning, 'severity is Warning');
assert((missingDiag?.relatedInformation?.length ?? 0) > 0, 'relatedInfo points to .l');

assert(!bisonDiags.find((d: Diagnostic) => d.message.includes("'NUMBER'")), 'NUMBER (in .l) not flagged');
assert(!bisonDiags.find((d: Diagnostic) => d.message.includes("'PLUS'")),   'PLUS (in .l) not flagged');

// ─────────────────────────────────────────────────────────────────────────────
// 3. computeFlexCrossFileDiagnostics
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n=== TEST: Flex cross-file diagnostics ===');

const flexWithExtra = `
%%
[0-9]+  { return NUMBER; }
"+"     { return PLUS; }
"*"     { return EXTRA_TOKEN; }
%%
`;
const flexDiags = computeFlexCrossFileDiagnostics(flexWithExtra, bisonDoc, 'file:///test.y');

const extraDiag = flexDiags.find((d: Diagnostic) => d.message.includes('EXTRA_TOKEN'));
assert(!!extraDiag, 'EXTRA_TOKEN flagged');
assert(extraDiag?.severity === DiagnosticSeverity.Warning, 'severity is Warning');
assert((extraDiag?.relatedInformation?.length ?? 0) > 0, 'relatedInfo points to .y');

assert(!flexDiags.find((d: Diagnostic) => d.message.includes("'NUMBER'")), 'NUMBER (in .y) not flagged');

// ─────────────────────────────────────────────────────────────────────────────
// 4. Skip list (EOF, error)
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n=== TEST: Skip list (EOF, error, YYEOF) ===');

const bisonDocEof = parseBisonDocument(
  `%token EOF error YYEOF NUMBER\n%%\nexpr : NUMBER ;\n%%\n`
);
const skipDiags = computeBisonCrossFileDiagnostics(
  bisonDocEof,
  `%%\n[0-9]+ { return NUMBER; }\n%%\n`,
  'file:///t.l'
);
assert(!skipDiags.find((d: Diagnostic) => d.message.includes("'EOF'")),   'EOF not flagged');
assert(!skipDiags.find((d: Diagnostic) => d.message.includes("'error'")), 'error not flagged');
assert(!skipDiags.find((d: Diagnostic) => d.message.includes("'YYEOF'")), 'YYEOF not flagged');

// ─────────────────────────────────────────────────────────────────────────────
// 5. getFoldingRanges — Bison
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n=== TEST: Folding ranges (Bison) ===');

const bisonFoldSrc = `%{
#include <stdio.h>
%}
%token NUMBER PLUS
%%
expr : expr PLUS NUMBER { $$ = $1 + $3; }
     | NUMBER            { $$ = $1; }
     ;
%%
int main() {}
`;

const bisonFoldDoc = TextDocument.create('file:///test.y', 'bison', 1, bisonFoldSrc);
const bisonFolds   = getFoldingRanges(bisonFoldDoc);

// Should have a fold for %{ ... %}
const prologueFold = bisonFolds.find(f => {
  const srcLines = bisonFoldSrc.split('\n');
  return srcLines[f.startLine]?.trim() === '%{' && srcLines[f.endLine]?.trim() === '%}';
});
assert(!!prologueFold, 'Prologue %{ ... %} fold detected');

// Should have section folds (around %%)
const sepLine = bisonFoldSrc.split('\n').findIndex((l: string) => l.trim() === '%%');
const sectionFold = bisonFolds.find(f => f.endLine === sepLine);
assert(!!sectionFold, 'Section fold before first %% detected');

// Should have a rule fold (expr :  ...  ;)
const ruleFold = bisonFolds.find(f => {
  const srcLines = bisonFoldSrc.split('\n');
  return /^expr\s*:/.test(srcLines[f.startLine]?.trim() ?? '');
});
assert(!!ruleFold, 'Rule fold for "expr :" detected');

// ─────────────────────────────────────────────────────────────────────────────
// 6. getFoldingRanges — Flex
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n=== TEST: Folding ranges (Flex) ===');

const flexFoldSrc = `%{
#include "parser.tab.h"
%}
%option noyywrap
%x COMMENT
%%
[0-9]+   { return NUMBER; }
%%
`;

const flexFoldDoc = TextDocument.create('file:///test.l', 'flex', 1, flexFoldSrc);
const flexFolds   = getFoldingRanges(flexFoldDoc);

const flexPrologueFold = flexFolds.find(f => {
  const srcLines = flexFoldSrc.split('\n');
  return srcLines[f.startLine]?.trim() === '%{' && srcLines[f.endLine]?.trim() === '%}';
});
assert(!!flexPrologueFold, 'Flex prologue %{ ... %} fold detected');

const flexSepLine = flexFoldSrc.split('\n').findIndex((l: string) => l.trim() === '%%');
const flexSectionFold = flexFolds.find(f => f.endLine === flexSepLine);
assert(!!flexSectionFold, 'Flex section fold before first %% detected');

// ─────────────────────────────────────────────────────────────────────────────
// 7. getCodeActions — quick fix "declare token"
// ─────────────────────────────────────────────────────────────────────────────
console.log('\n=== TEST: Code action "Declare this token" ===');

const cabisonSrc = `
%token DECLARED
%%
expr : DECLARED UNDECLARED { }
     ;
%%
`;
const caDoc   = TextDocument.create('file:///ca.y', 'bison', 1, cabisonSrc);
const caModel = parseBisonDocument(cabisonSrc);

// Craft the diagnostic that the server would produce
const fakeDiag: Diagnostic = {
  severity: DiagnosticSeverity.Warning,
  range: Range.create(3, 10, 3, 19),
  message: `Token 'UNDECLARED' is used but not declared with %token.`,
  source: 'bison',
  code: 'bison/undeclared-token',
};

const caParams: CodeActionParams = {
  textDocument: { uri: 'file:///ca.y' },
  range: Range.create(3, 10, 3, 19),
  context: { diagnostics: [fakeDiag] },
};

const actions = getCodeActions(caModel, caDoc, caParams);
assert(actions.length > 0, 'At least one code action returned');

const fix = actions[0];
assert(fix.title.includes('UNDECLARED'), 'Action title mentions the token');
assert(fix.isPreferred === true, 'Action is marked as preferred');

const edits = fix.edit?.changes?.['file:///ca.y'];
assert(Array.isArray(edits) && edits.length > 0, 'Edit list is non-empty');

const insertEdit = edits?.[0];
assert(
  insertEdit?.newText?.trim() === '%token UNDECLARED',
  `Inserted text is '%token UNDECLARED' (got: '${insertEdit?.newText?.trim()}')`
);

// Edit should be inserted before the first %%
const firstSepLine = cabisonSrc.split('\n').findIndex((l: string) => l.trim() === '%%');
assert(
  insertEdit?.range.start.line === firstSepLine,
  `Insertion is at line ${firstSepLine} (before %%), got ${insertEdit?.range.start.line}`
);

// ─────────────────────────────────────────────────────────────────────────────
// Summary
// ─────────────────────────────────────────────────────────────────────────────
console.log(`\n${'='.repeat(50)}`);
console.log(`  RESULTS: ${passed} passed, ${failed} failed`);
console.log('='.repeat(50));
process.exit(failed > 0 ? 1 : 0);
