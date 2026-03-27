import { parseBisonDocument } from '../server/src/parser/bisonParser';
import { parseFlexDocument } from '../server/src/parser/flexParser';
import { computeBisonDiagnostics, computeFlexDiagnostics } from '../server/src/providers/diagnostics';
import { getCodeActions } from '../server/src/providers/codeActions';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { Range, Diagnostic, CodeActionParams, CodeAction, TextEdit } from 'vscode-languageserver';
import { DEFAULT_SETTINGS } from '../server/src/providers/settings';

let passed = 0;
let failed = 0;

function assert(cond: boolean, desc: string, extra?: unknown) {
  if (cond) { passed++; console.log(`  [PASS] ${desc}`); }
  else { failed++; console.error(`  [FAIL] ${desc}`, extra ?? ''); }
}

function makeParams(uri: string, diagnostics: any[]): CodeActionParams {
  return {
    textDocument: { uri },
    range: Range.create(0, 0, 0, 0),
    context: { diagnostics },
  };
}

/** Find actions matching a given title prefix. */
function findAction(actions: CodeAction[], titlePrefix: string): CodeAction | undefined {
  return actions.find(a => a.title.startsWith(titlePrefix));
}

/** Get the TextEdit list for the first change in an action. */
function edits(action: CodeAction, uri: string): TextEdit[] {
  return action.edit?.changes?.[uri] ?? [];
}

// ── bison/undeclared-token ────────────────────────────────────────────────────
console.log('\n=== bison/undeclared-token → %token insert ===');
{
  const uri = 'file:///test.y';
  const src = '%token USED\n%%\nexpr : USED MYSTERY ;\n%%\n';
  const doc = parseBisonDocument(src);
  const textDoc = TextDocument.create(uri, 'bison', 1, src);
  const diags = computeBisonDiagnostics(doc, src, DEFAULT_SETTINGS);
  const diag = diags.find(d => d.code === 'bison/undeclared-token');
  assert(!!diag, 'diagnostic emitted for MYSTERY');
  if (diag) {
    const actions = getCodeActions(doc, textDoc, makeParams(uri, [diag]));
    const action = findAction(actions, "Declare token");
    assert(!!action, 'action returned for undeclared token');
    if (action) {
      assert(action.title === "Declare token '%token MYSTERY'", 'action title');
      assert(action.isPreferred === true, 'isPreferred');
      const es = edits(action, uri);
      assert(es.length === 1, 'one edit');
      assert(es[0].newText === '%token MYSTERY\n', 'insert text');
      assert(es[0].range.start.line === 1, 'insert before %%  (line 1)');
      assert(es[0].range.start.character === 0, 'insert at column 0');
    }
  }
}

// ── bison/missing-empty ───────────────────────────────────────────────────────
console.log('\n=== bison/missing-empty → %empty insert ===');
{
  const uri = 'file:///test.y';
  const src = '%token A\n%%\nexpr : A\n     |\n     ;\n%%\n';
  const doc = parseBisonDocument(src);
  const textDoc = TextDocument.create(uri, 'bison', 1, src);
  const diags = computeBisonDiagnostics(doc, src, DEFAULT_SETTINGS);
  const diag = diags.find(d => d.code === 'bison/missing-empty');
  assert(!!diag, 'diagnostic emitted for empty production');
  if (diag) {
    const actions = getCodeActions(doc, textDoc, makeParams(uri, [diag]));
    const action = findAction(actions, 'Insert %empty');
    assert(!!action, 'action returned for missing-empty');
    if (action) {
      assert(action.isPreferred === true, 'isPreferred');
      const es = edits(action, uri);
      assert(es.length === 1, 'one edit');
      assert(es[0].newText === ' %empty', 'inserted text is " %empty"');
    }
  }
}

// ── bison/unused-token ────────────────────────────────────────────────────────
console.log('\n=== bison/unused-token → delete %token line ===');
{
  const uri = 'file:///test.y';
  // USED is referenced, UNUSED is declared on its own line
  const src = '%token USED\n%token UNUSED\n%%\nexpr : USED ;\n%%\n';
  const doc = parseBisonDocument(src);
  const textDoc = TextDocument.create(uri, 'bison', 1, src);
  const diags = computeBisonDiagnostics(doc, src, DEFAULT_SETTINGS);
  const diag = diags.find(d => d.code === 'bison/unused-token');
  assert(!!diag, 'diagnostic emitted for UNUSED');
  if (diag) {
    const actions = getCodeActions(doc, textDoc, makeParams(uri, [diag]));
    const action = findAction(actions, 'Remove unused token');
    assert(!!action, 'action returned for unused-token');
    if (action) {
      assert(action.isPreferred === true, 'isPreferred');
      const es = edits(action, uri);
      assert(es.length === 1, 'one edit');
      // UNUSED is on line 1 → delete Range(1,0, 2,0)
      assert(es[0].newText === '', 'deletion (empty newText)');
      assert(es[0].range.start.line === 1, 'start line = 1');
      assert(es[0].range.start.character === 0, 'start character = 0');
      assert(es[0].range.end.line === 2, 'end line = 2');
      assert(es[0].range.end.character === 0, 'end character = 0');
    }
  }
}

// ── bison/yacc-compat: %error-verbose ────────────────────────────────────────
console.log('\n=== bison/yacc-compat (%error-verbose) → %define replace ===');
{
  const uri = 'file:///test.y';
  const src = '%error-verbose\n%%\nexpr : ;\n%%\n';
  const doc = parseBisonDocument(src);
  const textDoc = TextDocument.create(uri, 'bison', 1, src);
  const diags = computeBisonDiagnostics(doc, src, DEFAULT_SETTINGS);
  const diag = diags.find(d => d.code === 'bison/yacc-compat' && d.message.includes('%error-verbose'));
  assert(!!diag, 'diagnostic emitted for %error-verbose');
  if (diag) {
    const actions = getCodeActions(doc, textDoc, makeParams(uri, [diag]));
    const action = findAction(actions, "Replace with '%define parse.error verbose'");
    assert(!!action, 'action returned for error-verbose');
    if (action) {
      assert(action.isPreferred === true, 'isPreferred');
      const es = edits(action, uri);
      assert(es.length === 1, 'one edit');
      assert(es[0].newText === '%define parse.error verbose', 'replacement text');
      assert(es[0].range.start.line === 0, 'on line 0');
    }
  }
}

// ── bison/yacc-compat: %name-prefix ──────────────────────────────────────────
console.log('\n=== bison/yacc-compat (%name-prefix) → %define replace ===');
{
  const uri = 'file:///test.y';
  const src = '%name-prefix="yy"\n%%\nexpr : ;\n%%\n';
  const doc = parseBisonDocument(src);
  const textDoc = TextDocument.create(uri, 'bison', 1, src);
  const diags = computeBisonDiagnostics(doc, src, DEFAULT_SETTINGS);
  const diag = diags.find(d => d.code === 'bison/yacc-compat' && d.message.includes('%name-prefix'));
  assert(!!diag, 'diagnostic emitted for %name-prefix');
  if (diag) {
    const actions = getCodeActions(doc, textDoc, makeParams(uri, [diag]));
    const action = findAction(actions, "Replace with '%define api.prefix");
    assert(!!action, 'action returned for name-prefix');
    if (action) {
      assert(action.isPreferred === true, 'isPreferred');
      assert(action.title === "Replace with '%define api.prefix {yy}'", 'action title with prefix');
      const es = edits(action, uri);
      assert(es.length === 1, 'one edit');
      assert(es[0].newText === '%define api.prefix {yy}', 'replacement text');
    }
  }
}

// ── flex/unused-abbrev ────────────────────────────────────────────────────────
console.log('\n=== flex/unused-abbrev → delete abbreviation line ===');
{
  const { parseFlexDocument } = require('../server/src/parser/flexParser');
  const uri = 'file:///test.l';
  // Flex requires tab between name and pattern; action block needs 2+ spaces before {
  const src = 'DIGIT\t[0-9]\nUNUSED\t[a-z]\n%%\n{DIGIT}+  {}\n%%\n';
  const doc = parseFlexDocument(src);
  const textDoc = TextDocument.create(uri, 'flex', 1, src);
  const diags = computeFlexDiagnostics(doc, src, DEFAULT_SETTINGS);
  const diag = diags.find(d => d.code === 'flex/unused-abbrev');
  assert(!!diag, 'diagnostic emitted for UNUSED abbreviation');
  if (diag) {
    const actions = getCodeActions(doc, textDoc, makeParams(uri, [diag]));
    const action = findAction(actions, 'Remove unused abbreviation');
    assert(!!action, 'action returned for unused-abbrev');
    if (action) {
      assert(action.isPreferred === true, 'isPreferred');
      const es = edits(action, uri);
      assert(es.length === 1, 'one edit');
      // UNUSED is on line 1 → delete Range(1,0, 2,0)
      assert(es[0].newText === '', 'deletion (empty newText)');
      assert(es[0].range.start.line === 1, 'start line = 1');
      assert(es[0].range.end.line === 2, 'end line = 2');
    }
  }
}

// ── flex/undefined-sc ─────────────────────────────────────────────────────────
console.log('\n=== flex/undefined-sc → insert %x before %% ===');
{
  const { parseFlexDocument } = require('../server/src/parser/flexParser');
  const uri = 'file:///test.l';
  const src = '%%\n<MY_SC>[a-z]+ { return 1; }\n%%\n';
  const doc = parseFlexDocument(src);
  const textDoc = TextDocument.create(uri, 'flex', 1, src);
  const diags = computeFlexDiagnostics(doc, src, DEFAULT_SETTINGS);
  const diag = diags.find(d => d.code === 'flex/undefined-sc');
  assert(!!diag, 'diagnostic emitted for MY_SC');
  if (diag) {
    const actions = getCodeActions(doc, textDoc, makeParams(uri, [diag]));
    const action = findAction(actions, "Declare start condition");
    assert(!!action, 'action returned for undefined-sc');
    if (action) {
      assert(action.title === "Declare start condition '%x MY_SC'", 'action title');
      assert(action.isPreferred === true, 'isPreferred');
      const es = edits(action, uri);
      assert(es.length === 1, 'one edit');
      assert(es[0].newText === '%x MY_SC\n', 'insert text');
      assert(es[0].range.start.line === 0, 'insert before first %% (line 0)');
      assert(es[0].range.start.character === 0, 'insert at column 0');
    }
  }
}

// ── bison/missing-start ───────────────────────────────────────────────────────
console.log('\n=== bison/missing-start → insert %start ===');
{
  const uri = 'file:///test.y';
  // More than 2 rules triggers missing-start
  const src = '%token A B C\n%%\nexpr : A ;\nstmt : B ;\nitem : C ;\n%%\n';
  const doc = parseBisonDocument(src);
  const textDoc = TextDocument.create(uri, 'bison', 1, src);
  const diags = computeBisonDiagnostics(doc, src, DEFAULT_SETTINGS);
  const diag = diags.find(d => d.code === 'bison/missing-start');
  assert(!!diag, 'diagnostic emitted for missing-start');
  if (diag) {
    const actions = getCodeActions(doc, textDoc, makeParams(uri, [diag]));
    const action = findAction(actions, "Add '%start");
    assert(!!action, 'action returned for missing-start');
    if (action) {
      assert(action.title === "Add '%start expr'", 'action title uses first rule name');
      assert(action.isPreferred === true, 'isPreferred');
      const es = edits(action, uri);
      assert(es.length === 1, 'one edit');
      assert(es[0].newText === '%start expr\n', 'inserted text');
      // insert before first %% which is line 1
      assert(es[0].range.start.line === 1, 'insert before %% (line 1)');
    }
  }
}

// ── bison/unclosed-block ───────────────────────────────────────────────────────
// Note: in practice, an unclosed %{ also causes missing-separator (which exits
// early), so we inject a synthetic diagnostic to test the action in isolation.
console.log('\n=== bison/unclosed-block → insert %} ===');
{
  const uri = 'file:///test.y';
  const src = '%token A\n%%\nexpr : A ;\n%%\n';
  const doc = parseBisonDocument(src);
  const textDoc = TextDocument.create(uri, 'bison', 1, src);
  const fakeDiag: Diagnostic = {
    range: Range.create(3, 0, 3, 0),
    message: 'Unclosed %{ block — missing %} before end of file.',
    code: 'bison/unclosed-block',
    severity: 1,
  };
  const actions = getCodeActions(doc, textDoc, makeParams(uri, [fakeDiag]));
  const action = findAction(actions, "Close block with '%}'");
  assert(!!action, 'action returned for unclosed-block');
  if (action) {
    assert(action.isPreferred === true, 'isPreferred');
    const es = edits(action, uri);
    assert(es.length === 1, 'one edit');
    assert(es[0].newText === '%}\n', 'inserted text');
    assert(es[0].range.start.line === 3, 'insert at diagnostic position');
  }
}

// ── bison/yacc-compat: %pure-parser ───────────────────────────────────────────
console.log('\n=== bison/yacc-compat (%pure-parser) → %define replace ===');
{
  const uri = 'file:///test.y';
  const src = '%pure-parser\n%%\nexpr : ;\n%%\n';
  const doc = parseBisonDocument(src);
  const textDoc = TextDocument.create(uri, 'bison', 1, src);
  const diags = computeBisonDiagnostics(doc, src, DEFAULT_SETTINGS);
  const diag = diags.find(d => d.code === 'bison/yacc-compat' && d.message.includes('%pure-parser'));
  assert(!!diag, 'diagnostic emitted for %pure-parser');
  if (diag) {
    const actions = getCodeActions(doc, textDoc, makeParams(uri, [diag]));
    const action = findAction(actions, "Replace with '%define api.pure full'");
    assert(!!action, 'action returned for pure-parser');
    if (action) {
      assert(action.isPreferred === true, 'isPreferred');
      const es = edits(action, uri);
      assert(es.length === 1, 'one edit');
      assert(es[0].newText === '%define api.pure full', 'replacement text');
    }
  }
}

// ── bison/yacc-compat: %binary ────────────────────────────────────────────────
console.log('\n=== bison/yacc-compat (%binary) → %nonassoc ===');
{
  const uri = 'file:///test.y';
  const src = '%token A\n%binary A\n%%\nexpr : A ;\n%%\n';
  const doc = parseBisonDocument(src);
  const textDoc = TextDocument.create(uri, 'bison', 1, src);
  const diags = computeBisonDiagnostics(doc, src, DEFAULT_SETTINGS);
  const diag = diags.find(d => d.code === 'bison/yacc-compat' && d.message.includes('%binary'));
  assert(!!diag, 'diagnostic emitted for %binary');
  if (diag) {
    const actions = getCodeActions(doc, textDoc, makeParams(uri, [diag]));
    const action = findAction(actions, "Replace with '%nonassoc'");
    assert(!!action, 'action returned for binary');
    if (action) {
      assert(action.isPreferred === true, 'isPreferred');
      const es = edits(action, uri);
      assert(es.length === 1, 'one edit');
      assert(es[0].newText === '%nonassoc', 'replacement text');
    }
  }
}

// ── flex/unused-sc ────────────────────────────────────────────────────────────
console.log('\n=== flex/unused-sc → delete declaration line ===');
{
  const { parseFlexDocument } = require('../server/src/parser/flexParser');
  const uri = 'file:///test.l';
  // %x DEAD declared but never used in a rule
  const src = '%x DEAD\n%option noyywrap\n%%\n[a-z]+  {}\n%%\n';
  const doc = parseFlexDocument(src);
  const textDoc = TextDocument.create(uri, 'flex', 1, src);
  const diags = computeFlexDiagnostics(doc, src, DEFAULT_SETTINGS);
  const diag = diags.find(d => d.code === 'flex/unused-sc');
  assert(!!diag, 'diagnostic emitted for unused start condition');
  if (diag) {
    const actions = getCodeActions(doc, textDoc, makeParams(uri, [diag]));
    const action = findAction(actions, 'Remove unused start condition');
    assert(!!action, 'action returned for unused-sc');
    if (action) {
      assert(action.isPreferred === true, 'isPreferred');
      const es = edits(action, uri);
      assert(es.length === 1, 'one edit');
      assert(es[0].newText === '', 'deletion');
      assert(es[0].range.start.line === 0, 'start line = 0');
      assert(es[0].range.end.line === 1, 'end line = 1');
    }
  }
}

// ── flex/missing-yywrap ───────────────────────────────────────────────────────
console.log('\n=== flex/missing-yywrap → insert %option noyywrap ===');
{
  const { parseFlexDocument } = require('../server/src/parser/flexParser');
  const uri = 'file:///test.l';
  const src = '%%\n[a-z]+  {}\n%%\n';
  const doc = parseFlexDocument(src);
  const textDoc = TextDocument.create(uri, 'flex', 1, src);
  const diags = computeFlexDiagnostics(doc, src, DEFAULT_SETTINGS);
  const diag = diags.find(d => d.code === 'flex/missing-yywrap');
  assert(!!diag, 'diagnostic emitted for missing-yywrap');
  if (diag) {
    const actions = getCodeActions(doc, textDoc, makeParams(uri, [diag]));
    const action = findAction(actions, "Add '%option noyywrap'");
    assert(!!action, 'action returned for missing-yywrap');
    if (action) {
      assert(action.isPreferred === true, 'isPreferred');
      const es = edits(action, uri);
      assert(es.length === 1, 'one edit');
      assert(es[0].newText === '%option noyywrap\n', 'inserted text');
      assert(es[0].range.start.line === 0, 'insert before first %% (line 0)');
    }
  }
}

// ── flex/unclosed-block ───────────────────────────────────────────────────────
// Note: same as bison — unclosed %{ also causes missing-separator, so inject
// a synthetic diagnostic to test the action in isolation.
console.log('\n=== flex/unclosed-block → insert %} ===');
{
  const { parseFlexDocument } = require('../server/src/parser/flexParser');
  const uri = 'file:///test.l';
  const src = '%option noyywrap\n%%\n[a-z]+  {}\n%%\n';
  const doc = parseFlexDocument(src);
  const textDoc = TextDocument.create(uri, 'flex', 1, src);
  const fakeDiag: Diagnostic = {
    range: Range.create(3, 0, 3, 0),
    message: 'Unclosed %{ block — missing %} before end of file.',
    code: 'flex/unclosed-block',
    severity: 1,
  };
  const actions = getCodeActions(doc, textDoc, makeParams(uri, [fakeDiag]));
  const action = findAction(actions, "Close block with '%}'");
  assert(!!action, 'action returned for unclosed-block');
  if (action) {
    assert(action.isPreferred === true, 'isPreferred');
    const es = edits(action, uri);
    assert(es.length === 1, 'one edit');
    assert(es[0].newText === '%}\n', 'inserted text');
    assert(es[0].range.start.line === 3, 'insert at diagnostic position');
  }
}

// ── bison/unknown-directive ───────────────────────────────────────────────────
console.log('\n=== bison/unknown-directive → delete line ===');
{
  const uri = 'file:///test.y';
  const src = '%prout\n%token A\n%%\nexpr : A ;\n%%\n';
  const doc = parseBisonDocument(src);
  const textDoc = TextDocument.create(uri, 'bison', 1, src);
  const diags = computeBisonDiagnostics(doc, src, DEFAULT_SETTINGS);
  const diag = diags.find(d => d.code === 'bison/unknown-directive');
  assert(!!diag, 'diagnostic emitted for unknown directive');
  if (diag) {
    const actions = getCodeActions(doc, textDoc, makeParams(uri, [diag]));
    const action = findAction(actions, 'Remove unknown directive');
    assert(!!action, 'action returned');
    if (action) {
      assert(action.isPreferred === true, 'isPreferred');
      const es = edits(action, uri);
      assert(es.length === 1, 'one edit');
      assert(es[0].newText === '', 'deletion');
      assert(es[0].range.start.line === 0, 'deletes line 0');
      assert(es[0].range.end.line === 1, 'ends on line 1');
    }
  }
}

// ── bison/missing-rule ────────────────────────────────────────────────────────
console.log('\n=== bison/missing-rule → insert rule stub ===');
{
  const uri = 'file:///test.y';
  // %type declares 'foo' but no rule 'foo' exists
  const src = '%token A\n%type <int> foo\n%%\nexpr : A ;\n%%\n';
  const doc = parseBisonDocument(src);
  const textDoc = TextDocument.create(uri, 'bison', 1, src);
  const diags = computeBisonDiagnostics(doc, src, DEFAULT_SETTINGS);
  const diag = diags.find(d => d.code === 'bison/missing-rule');
  assert(!!diag, 'diagnostic emitted for missing-rule');
  if (diag) {
    const actions = getCodeActions(doc, textDoc, makeParams(uri, [diag]));
    const action = findAction(actions, "Add rule stub 'foo : ;'");
    assert(!!action, 'action returned');
    if (action) {
      assert(action.isPreferred === true, 'isPreferred');
      const es = edits(action, uri);
      assert(es.length === 1, 'one edit');
      assert(es[0].newText === 'foo : ;\n', 'stub text');
      // first %% is line 2, so insert after %% at line 3
      assert(es[0].range.start.line === 3, 'insert after first %%');
    }
  }
}

// ── flex/unknown-directive ────────────────────────────────────────────────────
console.log('\n=== flex/unknown-directive → delete line ===');
{
  const { parseFlexDocument } = require('../server/src/parser/flexParser');
  const uri = 'file:///test.l';
  const src = '%woops\n%option noyywrap\n%%\n[a-z]+  {}\n%%\n';
  const doc = parseFlexDocument(src);
  const textDoc = TextDocument.create(uri, 'flex', 1, src);
  const diags = computeFlexDiagnostics(doc, src, DEFAULT_SETTINGS);
  const diag = diags.find(d => d.code === 'flex/unknown-directive');
  assert(!!diag, 'diagnostic emitted for unknown directive');
  if (diag) {
    const actions = getCodeActions(doc, textDoc, makeParams(uri, [diag]));
    const action = findAction(actions, 'Remove unknown directive');
    assert(!!action, 'action returned');
    if (action) {
      assert(action.isPreferred === true, 'isPreferred');
      const es = edits(action, uri);
      assert(es.length === 1, 'one edit');
      assert(es[0].newText === '', 'deletion');
      assert(es[0].range.start.line === 0, 'deletes line 0');
      assert(es[0].range.end.line === 1, 'ends on line 1');
    }
  }
}

// ── flex/unreachable-rule ─────────────────────────────────────────────────────
console.log('\n=== flex/unreachable-rule → delete rule line ===');
{
  const { parseFlexDocument } = require('../server/src/parser/flexParser');
  const uri = 'file:///test.l';
  // Duplicate pattern: second [a-z]+ is inaccessible
  const src = '%option noyywrap\n%%\n[a-z]+  { return 1; }\n[a-z]+  { return 2; }\n%%\n';
  const doc = parseFlexDocument(src);
  const textDoc = TextDocument.create(uri, 'flex', 1, src);
  const diags = computeFlexDiagnostics(doc, src, DEFAULT_SETTINGS);
  const diag = diags.find(d => d.code === 'flex/unreachable-rule');
  assert(!!diag, 'diagnostic emitted for unreachable-rule');
  if (diag) {
    const actions = getCodeActions(doc, textDoc, makeParams(uri, [diag]));
    const action = findAction(actions, 'Remove inaccessible rule');
    assert(!!action, 'action returned');
    if (action) {
      assert(action.isPreferred === true, 'isPreferred');
      const es = edits(action, uri);
      assert(es.length === 1, 'one edit');
      assert(es[0].newText === '', 'deletion');
      // Duplicate is on line 3 (0-indexed)
      assert(es[0].range.start.line === 3, 'deletes duplicate line');
      assert(es[0].range.end.line === 4, 'ends on next line');
    }
  }
}

// ── no action for unknown code ─────────────────────────────────────────────────
console.log('\n=== no action for irrelevant diagnostic ===');
{
  const uri = 'file:///test.y';
  const src = '%token A\n%%\nexpr : A ;\n%%\n';
  const doc = parseBisonDocument(src);
  const textDoc = TextDocument.create(uri, 'bison', 1, src);
  const fakeDisag = {
    range: Range.create(0, 0, 0, 0),
    message: 'Some unrelated diagnostic',
    code: 'bison/some-other-code',
    severity: 2,
  };
  const actions = getCodeActions(doc, textDoc, makeParams(uri, [fakeDisag]));
  assert(actions.length === 0, 'no actions for unknown code');
}

// ── Summary ────────────────────────────────────────────────────────────────────
console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
if (failed > 0) process.exit(1);
