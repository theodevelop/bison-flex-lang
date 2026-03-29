import {
  CodeAction,
  CodeActionKind,
  CodeActionParams,
  Diagnostic,
  TextEdit,
  Range,
} from 'vscode-languageserver';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { DocumentModel, BisonDocument, FlexDocument, isBisonDocument, isFlexDocument } from '../parser/types';

/**
 * Provide code actions (quick fixes) for diagnostics.
 *
 * Handles:
 * - bison/missing-separator    → append %% at end of file
 * - bison/undeclared-token     → insert %token X before first %%
 * - bison/missing-empty        → insert %empty at the empty production
 * - bison/unused-token         → delete the %token declaration line
 * - bison/unknown-directive    → delete the directive line
 * - bison/missing-rule         → insert rule stub after first %%
 * - bison/missing-type         → insert %type <todo> rule before first %%
 * - bison/undefined-start      → delete the invalid %start line
 * - bison/missing-start        → insert %start <rule> before first %%
 * - bison/unclosed-block       → insert %} at end of file
 * - bison/yacc-compat          → replace legacy directives with modern Bison 3.x equivalents
 * - flex/missing-separator     → append %% at end of file
 * - flex/undefined-abbrev      → insert abbreviation stub before first %%
 * - flex/unused-abbrev         → delete the abbreviation definition line
 * - flex/unused-sc             → delete the %x/%s declaration line
 * - flex/unknown-directive     → delete the directive line
 * - flex/undefined-sc          → insert %x SC_NAME before first %%
 * - flex/unused-option         → remove the unused option name
 * - flex/duplicate-eof         → delete the duplicate <<EOF>> rule line
 * - flex/missing-yywrap        → insert %option noyywrap before first %%
 * - flex/unclosed-block        → insert %} at end of file
 * - flex/unreachable-rule      → delete the inaccessible rule line
 */
export function getCodeActions(
  model: DocumentModel,
  textDoc: TextDocument,
  params: CodeActionParams,
): CodeAction[] {
  const actions: CodeAction[] = [];

  for (const diag of params.context.diagnostics) {
    const code = typeof diag.code === 'string' ? diag.code : undefined;
    if (!code) continue;

    if (isBisonDocument(model)) {
      actions.push(...bisonCodeActions(model, textDoc, params, diag, code));
    } else if (isFlexDocument(model)) {
      actions.push(...flexCodeActions(model, textDoc, params, diag, code));
    }
  }

  return actions;
}

function bisonCodeActions(
  bisonDoc: BisonDocument,
  textDoc: TextDocument,
  params: CodeActionParams,
  diag: Diagnostic,
  code: string,
): CodeAction[] {
  const actions: CodeAction[] = [];
  const uri = params.textDocument.uri;

  // ── bison/missing-separator → append %% at end of file ───────────────────
  if (code === 'bison/missing-separator') {
    const lastLine = textDoc.lineCount;
    actions.push({
      title: "Insert missing '%%' separator",
      kind: CodeActionKind.QuickFix,
      diagnostics: [diag],
      isPreferred: true,
      edit: {
        changes: {
          [uri]: [TextEdit.insert(Range.create(lastLine, 0, lastLine, 0).start, '\n%%\n')],
        },
      },
    });
  }

  // ── bison/undeclared-token → insert %token X before first %% ──────────────
  if (code === 'bison/undeclared-token') {
    const m = diag.message.match(/^Token '([A-Z_][A-Z0-9_]+)' is used but not declared with %token\./);
    if (m) {
      const tokenName = m[1];
      const insertLine = bisonDoc.separators.length > 0 ? bisonDoc.separators[0] : 0;
      actions.push({
        title: `Declare token '%token ${tokenName}'`,
        kind: CodeActionKind.QuickFix,
        diagnostics: [diag],
        isPreferred: true,
        edit: {
          changes: {
            [uri]: [TextEdit.insert(Range.create(insertLine, 0, insertLine, 0).start, `%token ${tokenName}\n`)],
          },
        },
      });
    }
  }

  // ── bison/missing-empty → insert %empty at the empty production ────────────
  if (code === 'bison/missing-empty') {
    actions.push({
      title: 'Insert %empty',
      kind: CodeActionKind.QuickFix,
      diagnostics: [diag],
      isPreferred: true,
      edit: {
        changes: {
          [uri]: [TextEdit.insert(diag.range.end, ' %empty')],
        },
      },
    });
  }

  // ── bison/unused-token → delete %token declaration line ───────────────────
  if (code === 'bison/unused-token') {
    const line = diag.range.start.line;
    actions.push({
      title: 'Remove unused token declaration',
      kind: CodeActionKind.QuickFix,
      diagnostics: [diag],
      isPreferred: true,
      edit: {
        changes: {
          [uri]: [TextEdit.del(Range.create(line, 0, line + 1, 0))],
        },
      },
    });
  }

  // ── bison/unknown-directive → delete the directive line ───────────────────
  if (code === 'bison/unknown-directive') {
    const line = diag.range.start.line;
    actions.push({
      title: 'Remove unknown directive',
      kind: CodeActionKind.QuickFix,
      diagnostics: [diag],
      isPreferred: true,
      edit: {
        changes: {
          [uri]: [TextEdit.del(Range.create(line, 0, line + 1, 0))],
        },
      },
    });
  }

  // ── bison/missing-rule → insert rule stub after first %% ──────────────────
  if (code === 'bison/missing-rule') {
    const m = diag.message.match(/Non-terminal '([^']+)' has a %type declaration/);
    if (m) {
      const ruleName = m[1];
      const insertLine = bisonDoc.separators.length > 0 ? bisonDoc.separators[0] + 1 : 0;
      actions.push({
        title: `Add rule stub '${ruleName} : ;'`,
        kind: CodeActionKind.QuickFix,
        diagnostics: [diag],
        isPreferred: true,
        edit: {
          changes: {
            [uri]: [TextEdit.insert(Range.create(insertLine, 0, insertLine, 0).start, `${ruleName} : ;\n`)],
          },
        },
      });
    }
  }

  // ── bison/missing-type → insert %type declaration before first %% ────────
  if (code === 'bison/missing-type') {
    const m = diag.message.match(/Rule '([^']+)' has no %type declaration/);
    if (m) {
      const ruleName = m[1];
      const insertLine = bisonDoc.separators.length > 0 ? bisonDoc.separators[0] : 0;
      actions.push({
        title: `Add '%type <todo> ${ruleName}'`,
        kind: CodeActionKind.QuickFix,
        diagnostics: [diag],
        isPreferred: true,
        edit: {
          changes: {
            [uri]: [TextEdit.insert(Range.create(insertLine, 0, insertLine, 0).start, `%type <todo> ${ruleName}\n`)],
          },
        },
      });
    }
  }

  // ── bison/undefined-start → delete the %start line ────────────────────────
  if (code === 'bison/undefined-start') {
    const line = diag.range.start.line;
    actions.push({
      title: 'Remove invalid %start directive',
      kind: CodeActionKind.QuickFix,
      diagnostics: [diag],
      isPreferred: true,
      edit: {
        changes: {
          [uri]: [TextEdit.del(Range.create(line, 0, line + 1, 0))],
        },
      },
    });
  }

  // ── bison/missing-start → insert %start <rule> before first %% ───────────
  if (code === 'bison/missing-start') {
    const m = diag.message.match(/implicitly uses '([^']+)' as the start symbol/);
    if (m) {
      const ruleName = m[1];
      const insertLine = bisonDoc.separators.length > 0 ? bisonDoc.separators[0] : 0;
      actions.push({
        title: `Add '%start ${ruleName}'`,
        kind: CodeActionKind.QuickFix,
        diagnostics: [diag],
        isPreferred: true,
        edit: {
          changes: {
            [uri]: [TextEdit.insert(Range.create(insertLine, 0, insertLine, 0).start, `%start ${ruleName}\n`)],
          },
        },
      });
    }
  }

  // ── bison/unclosed-block → insert %} at end of file ───────────────────────
  if (code === 'bison/unclosed-block') {
    actions.push({
      title: "Close block with '%}'",
      kind: CodeActionKind.QuickFix,
      diagnostics: [diag],
      isPreferred: true,
      edit: {
        changes: {
          [uri]: [TextEdit.insert(diag.range.start, '%}\n')],
        },
      },
    });
  }

  // ── bison/yacc-compat → replace with modern Bison equivalent ──────────────
  if (code === 'bison/yacc-compat') {
    const line = diag.range.start.line;
    const lineEnd = diag.range.end.character;
    const lineText = textDoc.getText(Range.create(line, 0, line, lineEnd));
    const indent = lineText.match(/^(\s*)/)?.[1] ?? '';
    const replRange = Range.create(line, 0, line, lineEnd);

    if (/^\s*%error[_-]verbose\b/.test(lineText)) {
      actions.push({
        title: "Replace with '%define parse.error verbose'",
        kind: CodeActionKind.QuickFix,
        diagnostics: [diag],
        isPreferred: true,
        edit: { changes: { [uri]: [TextEdit.replace(replRange, `${indent}%define parse.error verbose`)] } },
      });
    }

    if (/^\s*%pure[_-]parser\b/.test(lineText)) {
      actions.push({
        title: "Replace with '%define api.pure full'",
        kind: CodeActionKind.QuickFix,
        diagnostics: [diag],
        isPreferred: true,
        edit: { changes: { [uri]: [TextEdit.replace(replRange, `${indent}%define api.pure full`)] } },
      });
    }

    if (/^\s*%binary\b/.test(lineText)) {
      actions.push({
        title: "Replace with '%nonassoc'",
        kind: CodeActionKind.QuickFix,
        diagnostics: [diag],
        isPreferred: true,
        edit: { changes: { [uri]: [TextEdit.replace(replRange, `${indent}%nonassoc`)] } },
      });
    }

    const namePrefixMatch = lineText.match(/^\s*%name[_-]prefix\s*=?\s*"([^"]*)"/);
    if (namePrefixMatch) {
      const prefix = namePrefixMatch[1];
      actions.push({
        title: `Replace with '%define api.prefix {${prefix}}'`,
        kind: CodeActionKind.QuickFix,
        diagnostics: [diag],
        isPreferred: true,
        edit: { changes: { [uri]: [TextEdit.replace(replRange, `${indent}%define api.prefix {${prefix}}`)] } },
      });
    }
  }

  return actions;
}

function flexCodeActions(
  flexDoc: FlexDocument,
  textDoc: TextDocument,
  params: CodeActionParams,
  diag: Diagnostic,
  code: string,
): CodeAction[] {
  const actions: CodeAction[] = [];
  const uri = params.textDocument.uri;

  // ── flex/missing-separator → append %% at end of file ────────────────────
  if (code === 'flex/missing-separator') {
    const lastLine = textDoc.lineCount;
    actions.push({
      title: "Insert missing '%%' separator",
      kind: CodeActionKind.QuickFix,
      diagnostics: [diag],
      isPreferred: true,
      edit: {
        changes: {
          [uri]: [TextEdit.insert(Range.create(lastLine, 0, lastLine, 0).start, '\n%%\n')],
        },
      },
    });
  }

  // ── flex/undefined-abbrev → insert abbreviation stub before first %% ──────
  if (code === 'flex/undefined-abbrev') {
    const m = diag.message.match(/Abbreviation '\{([^}]+)\}' is used but not defined/);
    if (m) {
      const abbrevName = m[1];
      const insertLine = flexDoc.separators.length > 0 ? flexDoc.separators[0] : 0;
      actions.push({
        title: `Define abbreviation '${abbrevName}'`,
        kind: CodeActionKind.QuickFix,
        diagnostics: [diag],
        isPreferred: true,
        edit: {
          changes: {
            [uri]: [TextEdit.insert(Range.create(insertLine, 0, insertLine, 0).start, `${abbrevName}  [todo]\n`)],
          },
        },
      });
    }
  }

  // ── flex/unused-abbrev → delete abbreviation definition line ──────────────
  if (code === 'flex/unused-abbrev') {
    const line = diag.range.start.line;
    actions.push({
      title: 'Remove unused abbreviation',
      kind: CodeActionKind.QuickFix,
      diagnostics: [diag],
      isPreferred: true,
      edit: {
        changes: {
          [uri]: [TextEdit.del(Range.create(line, 0, line + 1, 0))],
        },
      },
    });
  }

  // ── flex/unknown-directive → delete the directive line ───────────────────
  if (code === 'flex/unknown-directive') {
    const line = diag.range.start.line;
    actions.push({
      title: 'Remove unknown directive',
      kind: CodeActionKind.QuickFix,
      diagnostics: [diag],
      isPreferred: true,
      edit: {
        changes: {
          [uri]: [TextEdit.del(Range.create(line, 0, line + 1, 0))],
        },
      },
    });
  }

  // ── flex/unreachable-rule → delete the inaccessible rule line ─────────────
  if (code === 'flex/unreachable-rule') {
    const line = diag.range.start.line;
    actions.push({
      title: 'Remove inaccessible rule',
      kind: CodeActionKind.QuickFix,
      diagnostics: [diag],
      isPreferred: true,
      edit: {
        changes: {
          [uri]: [TextEdit.del(Range.create(line, 0, line + 1, 0))],
        },
      },
    });
  }

  // ── flex/unused-sc → delete %x/%s declaration line ───────────────────────
  if (code === 'flex/unused-sc') {
    const line = diag.range.start.line;
    actions.push({
      title: 'Remove unused start condition declaration',
      kind: CodeActionKind.QuickFix,
      diagnostics: [diag],
      isPreferred: true,
      edit: {
        changes: {
          [uri]: [TextEdit.del(Range.create(line, 0, line + 1, 0))],
        },
      },
    });
  }

  // ── flex/undefined-sc → insert %x SC_NAME before first %% ─────────────────
  if (code === 'flex/undefined-sc') {
    const m = diag.message.match(/^Start condition '([A-Za-z_][A-Za-z0-9_]*)' is used but not declared/);
    if (m) {
      const scName = m[1];
      const insertLine = flexDoc.separators.length > 0 ? flexDoc.separators[0] : 0;
      actions.push({
        title: `Declare start condition '%x ${scName}'`,
        kind: CodeActionKind.QuickFix,
        diagnostics: [diag],
        isPreferred: true,
        edit: {
          changes: {
            [uri]: [TextEdit.insert(Range.create(insertLine, 0, insertLine, 0).start, `%x ${scName}\n`)],
          },
        },
      });
    }
  }

  // ── flex/missing-yywrap → insert %option noyywrap before first %% ─────────
  if (code === 'flex/missing-yywrap') {
    const insertLine = flexDoc.separators.length > 0 ? flexDoc.separators[0] : 0;
    actions.push({
      title: "Add '%option noyywrap'",
      kind: CodeActionKind.QuickFix,
      diagnostics: [diag],
      isPreferred: true,
      edit: {
        changes: {
          [uri]: [TextEdit.insert(Range.create(insertLine, 0, insertLine, 0).start, '%option noyywrap\n')],
        },
      },
    });
  }

  // ── flex/unclosed-block → insert %} at end of file ────────────────────────
  // ── flex/unused-option → remove the option name from the line ─────────────
  if (code === 'flex/unused-option') {
    actions.push({
      title: 'Remove unused %option',
      kind: CodeActionKind.QuickFix,
      diagnostics: [diag],
      isPreferred: true,
      edit: {
        changes: {
          [uri]: [TextEdit.replace(diag.range, '')],
        },
      },
    });
  }

  // ── flex/duplicate-eof → delete the duplicate <<EOF>> rule line ───────────
  if (code === 'flex/duplicate-eof') {
    const line = diag.range.start.line;
    actions.push({
      title: 'Remove duplicate <<EOF>> rule',
      kind: CodeActionKind.QuickFix,
      diagnostics: [diag],
      isPreferred: true,
      edit: {
        changes: {
          [uri]: [TextEdit.del(Range.create(line, 0, line + 1, 0))],
        },
      },
    });
  }

  if (code === 'flex/unclosed-block') {
    actions.push({
      title: "Close block with '%}'",
      kind: CodeActionKind.QuickFix,
      diagnostics: [diag],
      isPreferred: true,
      edit: {
        changes: {
          [uri]: [TextEdit.insert(diag.range.start, '%}\n')],
        },
      },
    });
  }

  return actions;
}
