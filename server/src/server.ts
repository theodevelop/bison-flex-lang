import {
  createConnection,
  ProposedFeatures,
  InitializeParams,
  InitializeResult,
  TextDocumentSyncKind,
  CompletionParams,
  HoverParams,
  DefinitionParams,
  ReferenceParams,
  RenameParams,
  PrepareRenameParams,
  InlayHintParams,
  FoldingRangeParams,
  CodeActionParams,
  DocumentFormattingParams,
  DocumentSymbolParams,
  WorkspaceSymbolParams,
  CodeLensParams,
  TextDocuments,
  Diagnostic,
} from 'vscode-languageserver/node';
import { TextDocument } from 'vscode-languageserver-textdocument';
import { URI } from 'vscode-uri';
import * as fs from 'fs';
import * as path from 'path';
import { parseBisonDocument } from './parser/bisonParser';
import { parseFlexDocument } from './parser/flexParser';
import { DocumentModel, BisonDocument, FlexDocument, isBisonDocument } from './parser/types';
import { computeBisonDiagnostics, computeFlexDiagnostics } from './providers/diagnostics';
import { getCompletions } from './providers/completion';
import { getHover } from './providers/hover';
import { getDefinition } from './providers/definition';
import { getReferences } from './providers/references';
import { prepareRename, getRename } from './providers/rename';
import { getInlayHints } from './providers/inlayHints';
import {
  computeBisonCrossFileDiagnostics,
  computeFlexCrossFileDiagnostics,
} from './providers/crossFileSync';
import { getCodeActions } from './providers/codeActions';
import { getFoldingRanges } from './providers/foldingRanges';
import { formatBisonDocument } from './providers/formatting';
import { computeFirstSets, computeFollowSets } from './providers/firstFollow';
import { getDocumentSymbols } from './providers/documentSymbols';
import { getWorkspaceSymbols } from './providers/workspaceSymbols';
import { getCodeLenses } from './providers/codeLens';
import { computeCmakeDiagnostic } from './providers/cmake';
import { ExtensionSettings, DEFAULT_SETTINGS } from './providers/settings';
import { WorkspaceIndex } from './project/projectModel';

const connection = createConnection(ProposedFeatures.all);
const documents = new TextDocuments(TextDocument);

// Cache of parsed documents
const documentModels = new Map<string, DocumentModel>();

let workspaceIndex: WorkspaceIndex | undefined;

connection.onInitialize((_params: InitializeParams): InitializeResult => {
  return {
    capabilities: {
      textDocumentSync: TextDocumentSyncKind.Incremental,
      completionProvider: {
        triggerCharacters: ['%', '$', '@', '<', '{'],
        resolveProvider: false,
      },
      hoverProvider: true,
      definitionProvider: true,
      referencesProvider: true,
      renameProvider: {
        prepareProvider: true,
      },
      inlayHintProvider: true,
      codeActionProvider: true,
      foldingRangeProvider: true,
      documentFormattingProvider: true,
      documentSymbolProvider: true,
      workspaceSymbolProvider: true,
      codeLensProvider: { resolveProvider: false },
    },
  };
});

connection.onInitialized(async () => {
  const folders = (await connection.workspace.getWorkspaceFolders()) ?? [];
  const roots = folders.map(f => URI.parse(f.uri).fsPath);
  if (roots.length > 0) {
    workspaceIndex = new WorkspaceIndex(roots[0]);
    void workspaceIndex.initialize(roots);
  }
});

// Revalidate on document change
documents.onDidChangeContent((change) => {
  void validateDocument(change.document);
});

documents.onDidClose((event) => {
  documentModels.delete(event.document.uri);
  connection.sendDiagnostics({ uri: event.document.uri, diagnostics: [] });
});

// Re-validate all open documents when the user changes settings
connection.onDidChangeConfiguration(() => {
  for (const doc of documents.all()) {
    void validateDocument(doc);
  }
});

/** Find the companion file (.y↔.l) in the same directory. */
function findCompanionFile(uri: string, currentLang: 'bison' | 'flex'): { filePath: string; uri: string } | undefined {
  const parsed = URI.parse(uri);
  const dir = path.dirname(parsed.fsPath);
  const baseName = path.basename(parsed.fsPath, path.extname(parsed.fsPath));

  const extensions = currentLang === 'bison'
    ? ['.l', '.ll', '.lex', '.flex']
    : ['.y', '.yy', '.ypp', '.bison'];

  for (const ext of extensions) {
    const candidate = path.join(dir, baseName + ext);
    if (fs.existsSync(candidate)) {
      return { filePath: candidate, uri: URI.file(candidate).toString() };
    }
  }
  return undefined;
}

/** Read companion file text: prefer open document, fall back to filesystem. */
function readCompanionText(companionUri: string, companionPath: string): string | undefined {
  const openDoc = documents.get(companionUri);
  if (openDoc) return openDoc.getText();
  try {
    return fs.readFileSync(companionPath, 'utf-8');
  } catch {
    return undefined;
  }
}

async function validateDocument(textDoc: TextDocument): Promise<void> {
  // Read user settings for this document (falls back to DEFAULT_SETTINGS on error)
  let settings: ExtensionSettings = DEFAULT_SETTINGS;
  try {
    const raw = await connection.workspace.getConfiguration({
      scopeUri: textDoc.uri,
      section: 'bisonFlex',
    });
    if (raw) {
      settings = {
        minVersionBison: typeof raw.minVersionBison === 'string' ? raw.minVersionBison : '',
        minVersionFlex:  typeof raw.minVersionFlex  === 'string' ? raw.minVersionFlex  : '',
        disabledChecks:  Array.isArray(raw.disabledChecks) ? raw.disabledChecks : [],
      };
    }
  } catch {
    // getConfiguration can fail when the workspace connection is not yet ready;
    // silently fall back to defaults.
  }

  const text = textDoc.getText();
  const languageId = textDoc.languageId;
  let model: DocumentModel;
  let diagnostics: Diagnostic[];

  if (languageId === 'bison') {
    model = parseBisonDocument(text);
    diagnostics = computeBisonDiagnostics(model as BisonDocument, text, settings);

    // Cross-file: check tokens against companion .l file
    const companion = findCompanionFile(textDoc.uri, 'bison');
    if (companion) {
      const flexText = readCompanionText(companion.uri, companion.filePath);
      if (flexText) {
        diagnostics.push(...computeBisonCrossFileDiagnostics(model as BisonDocument, flexText, companion.uri, settings));
      }
    }

    // CMake integration diagnostic
    const cmakeDiag = computeCmakeDiagnostic(textDoc.uri, 'bison');
    if (cmakeDiag) diagnostics.push(cmakeDiag);

  } else if (languageId === 'flex') {
    model = parseFlexDocument(text);
    diagnostics = computeFlexDiagnostics(model as FlexDocument, text, settings);

    // Cross-file: check returned tokens against companion .y file
    const companion = findCompanionFile(textDoc.uri, 'flex');
    if (companion) {
      const bisonText = readCompanionText(companion.uri, companion.filePath);
      if (bisonText) {
        const bisonDoc = parseBisonDocument(bisonText);
        diagnostics.push(...computeFlexCrossFileDiagnostics(text, bisonDoc, companion.uri, settings));
      }
    }

    // CMake integration diagnostic
    const cmakeDiag = computeCmakeDiagnostic(textDoc.uri, 'flex');
    if (cmakeDiag) diagnostics.push(cmakeDiag);

  } else {
    return;
  }

  documentModels.set(textDoc.uri, model);
  connection.sendDiagnostics({ uri: textDoc.uri, diagnostics });
}

/** Ensure we have a parsed model for the given document. */
function ensureModel(textDoc: TextDocument): DocumentModel | undefined {
  let model = documentModels.get(textDoc.uri);
  if (!model) {
    const text = textDoc.getText();
    if (textDoc.languageId === 'bison') {
      model = parseBisonDocument(text);
    } else if (textDoc.languageId === 'flex') {
      model = parseFlexDocument(text);
    } else {
      return undefined;
    }
    documentModels.set(textDoc.uri, model);
  }
  return model;
}

connection.onCompletion((params: CompletionParams) => {
  const textDoc = documents.get(params.textDocument.uri);
  if (!textDoc) return [];
  const model = ensureModel(textDoc);
  if (!model) return [];

  // Cross-file context: companion Bison doc for .l files, raw Flex text for .y files
  let companionBison: BisonDocument | undefined;
  let companionFlexText: string | undefined;

  if (textDoc.languageId === 'flex') {
    const companion = findCompanionFile(textDoc.uri, 'flex');
    if (companion) {
      const existing = documentModels.get(companion.uri);
      if (existing && isBisonDocument(existing)) {
        companionBison = existing;
      } else {
        const bisonText = readCompanionText(companion.uri, companion.filePath);
        if (bisonText) companionBison = parseBisonDocument(bisonText);
      }
    }
  } else if (textDoc.languageId === 'bison') {
    const companion = findCompanionFile(textDoc.uri, 'bison');
    if (companion) {
      companionFlexText = readCompanionText(companion.uri, companion.filePath);
    }
  }

  return getCompletions(model, textDoc, params.position, companionBison, companionFlexText);
});

connection.onHover((params: HoverParams) => {
  const textDoc = documents.get(params.textDocument.uri);
  if (!textDoc) return null;
  const model = ensureModel(textDoc);
  if (!model) return null;

  // For Flex files, try to provide cross-file hover from the companion .y
  let companionBison: BisonDocument | undefined;
  if (textDoc.languageId === 'flex') {
    const companion = findCompanionFile(textDoc.uri, 'flex');
    if (companion) {
      const existing = documentModels.get(companion.uri);
      if (existing && isBisonDocument(existing)) {
        companionBison = existing;
      } else {
        const bisonText = readCompanionText(companion.uri, companion.filePath);
        if (bisonText) companionBison = parseBisonDocument(bisonText);
      }
    }
  }

  return getHover(model, textDoc, params.position, companionBison);
});

connection.onDefinition((params: DefinitionParams) => {
  const textDoc = documents.get(params.textDocument.uri);
  if (!textDoc) return null;
  const model = ensureModel(textDoc);
  if (!model) return null;
  return getDefinition(model, textDoc, params.position);
});

connection.onReferences((params: ReferenceParams) => {
  const textDoc = documents.get(params.textDocument.uri);
  if (!textDoc) return [];
  const model = ensureModel(textDoc);
  if (!model) return [];
  return getReferences(model, textDoc, params.position, params.context.includeDeclaration);
});

connection.onPrepareRename((params: PrepareRenameParams) => {
  const textDoc = documents.get(params.textDocument.uri);
  if (!textDoc) return null;
  const model = ensureModel(textDoc);
  if (!model) return null;
  return prepareRename(model, textDoc, params.position);
});

connection.onRenameRequest((params: RenameParams) => {
  const textDoc = documents.get(params.textDocument.uri);
  if (!textDoc) return null;
  const model = ensureModel(textDoc);
  if (!model) return null;
  return getRename(model, textDoc, params.position, params.newName);
});

connection.languages.inlayHint.on(async (params: InlayHintParams) => {
  const textDoc = documents.get(params.textDocument.uri);
  if (!textDoc) return [];

  // Check user setting
  const config = await connection.workspace.getConfiguration({ scopeUri: params.textDocument.uri, section: 'bisonFlex' });
  if (config?.showInlayHints === false) return [];

  const model = ensureModel(textDoc);
  if (!model) return [];
  return getInlayHints(model, textDoc, params.range);
});

connection.onCodeAction((params: CodeActionParams) => {
  const textDoc = documents.get(params.textDocument.uri);
  if (!textDoc) return [];
  const model = ensureModel(textDoc);
  if (!model) return [];
  return getCodeActions(model, textDoc, params);
});

connection.onFoldingRanges((params: FoldingRangeParams) => {
  const textDoc = documents.get(params.textDocument.uri);
  if (!textDoc) return [];
  return getFoldingRanges(textDoc);
});

// ── Formatting ──────────────────────────────────────────────────────────────
connection.onDocumentFormatting((params: DocumentFormattingParams) => {
  const textDoc = documents.get(params.textDocument.uri);
  if (!textDoc || textDoc.languageId !== 'bison') return [];
  return formatBisonDocument(textDoc, params.options);
});

// ── Document Symbols (Ctrl+Shift+O outline) ──────────────────────────────────
connection.onDocumentSymbol((params: DocumentSymbolParams) => {
  const textDoc = documents.get(params.textDocument.uri);
  if (!textDoc) return [];
  const model = ensureModel(textDoc);
  if (!model) return [];
  return getDocumentSymbols(model, textDoc);
});

// ── Workspace Symbols (Ctrl+T) ────────────────────────────────────────────────
connection.onWorkspaceSymbol((params: WorkspaceSymbolParams) => {
  return getWorkspaceSymbols(params.query, documentModels);
});

// ── Code Lens ─────────────────────────────────────────────────────────────────
connection.onCodeLens(async (params: CodeLensParams) => {
  const textDoc = documents.get(params.textDocument.uri);
  if (!textDoc) return [];

  // Respect the user's codeLens setting
  const config = await connection.workspace.getConfiguration({ scopeUri: params.textDocument.uri, section: 'bisonFlex' });
  if (config?.enableCodeLens === false) return [];

  const model = ensureModel(textDoc);
  if (!model) return [];
  return getCodeLenses(model, textDoc.uri);
});

// ── Custom request: Grammar Graph ───────────────────────────────────────────
interface GrammarGraphNode {
  id: string;
  type: 'rule' | 'token';
  line: number;
  recursive?: boolean;
  first?: string[];
  follow?: string[];
  alternatives?: string[][];  // each alternative as list of symbols
}
interface GrammarGraphEdge {
  source: string;
  target: string;
}

connection.onRequest('bisonFlex/grammarGraph', (params: { uri: string }) => {
  const textDoc = documents.get(params.uri);
  if (!textDoc) return null;
  const model = ensureModel(textDoc);
  if (!model || !isBisonDocument(model)) return null;

  const nodes: GrammarGraphNode[] = [];
  const edges: GrammarGraphEdge[] = [];
  const nodeIds = new Set<string>();
  const ruleNames = new Set(model.rules.keys());

  // Detect cycles via DFS
  const recursiveRules = new Set<string>();
  const adj = new Map<string, Set<string>>();
  for (const [name, rule] of model.rules) {
    const targets = new Set<string>();
    for (const alt of rule.alternatives) {
      for (const sym of alt.symbols) {
        if (ruleNames.has(sym)) targets.add(sym);
      }
    }
    adj.set(name, targets);
  }
  // Find SCCs using iterative DFS with color marking
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map<string, number>();
  for (const name of ruleNames) color.set(name, WHITE);
  for (const start of ruleNames) {
    if (color.get(start) !== WHITE) continue;
    const stack: Array<{ node: string; iter: Iterator<string> }> = [];
    color.set(start, GRAY);
    stack.push({ node: start, iter: (adj.get(start) ?? new Set()).values() });
    while (stack.length > 0) {
      const top = stack[stack.length - 1];
      const next = top.iter.next();
      if (next.done) {
        color.set(top.node, BLACK);
        stack.pop();
      } else {
        const neighbor = next.value;
        const c = color.get(neighbor);
        if (c === GRAY) {
          // Back edge → mark all nodes in the cycle path
          for (let i = stack.length - 1; i >= 0; i--) {
            recursiveRules.add(stack[i].node);
            if (stack[i].node === neighbor) break;
          }
        } else if (c === WHITE) {
          color.set(neighbor, GRAY);
          stack.push({ node: neighbor, iter: (adj.get(neighbor) ?? new Set()).values() });
        }
      }
    }
  }

  // Compute First/Follow sets
  const firstSets = computeFirstSets(model);
  const followSets = computeFollowSets(model, firstSets);

  // Add rule nodes with enriched data
  for (const [name, rule] of model.rules) {
    const alts = rule.alternatives.map(a =>
      a.symbols.length > 0 ? a.symbols : ['ε']
    );
    nodes.push({
      id: name,
      type: 'rule',
      line: rule.location.start.line,
      recursive: recursiveRules.has(name),
      first: firstSets.has(name) ? [...firstSets.get(name)!] : [],
      follow: followSets.has(name) ? [...followSets.get(name)!] : [],
      alternatives: alts,
    });
    nodeIds.add(name);
  }

  // Add token nodes (only those referenced in rules)
  for (const [name, tok] of model.tokens) {
    if (model.ruleReferences.has(name)) {
      nodes.push({ id: name, type: 'token', line: tok.location.start.line });
      nodeIds.add(name);
    }
  }

  // Build edges from rule alternatives (include self-references for recursive display)
  for (const [name, rule] of model.rules) {
    const targetSet = new Set<string>();
    for (const alt of rule.alternatives) {
      for (const sym of alt.symbols) {
        if (nodeIds.has(sym) && !targetSet.has(sym)) {
          targetSet.add(sym);
          edges.push({ source: name, target: sym });
        }
      }
    }
  }

  return { nodes, edges, startSymbol: model.startSymbol ?? [...model.rules.keys()][0] };
});

// ── Custom request: First/Follow sets ───────────────────────────────────────
connection.onRequest('bisonFlex/firstFollowSets', (params: { uri: string }) => {
  const textDoc = documents.get(params.uri);
  if (!textDoc) return null;
  const model = ensureModel(textDoc);
  if (!model || !isBisonDocument(model)) return null;

  const firstSets = computeFirstSets(model);
  const followSets = computeFollowSets(model, firstSets);

  // Convert Set→Array for JSON serialization
  const first: Record<string, string[]> = {};
  const follow: Record<string, string[]> = {};
  for (const [k, v] of firstSets) first[k] = [...v];
  for (const [k, v] of followSets) follow[k] = [...v];

  return { first, follow };
});

// ── Custom request: Explain Conflict ─────────────────────────────────────────
connection.onRequest('bisonFlex/explainConflict', (params: { uri: string; line: number }) => {
  const textDoc = documents.get(params.uri);
  if (!textDoc) return null;
  const model = ensureModel(textDoc);
  if (!model || !isBisonDocument(model)) return null;

  // Find the rule at the given line
  let targetRule: { name: string; rule: typeof model.rules extends Map<string, infer V> ? V : never } | undefined;
  for (const [name, rule] of model.rules) {
    const startLine = rule.location.start.line;
    const endLine = rule.location.end.line;
    if (params.line >= startLine && params.line <= endLine) {
      targetRule = { name, rule };
      break;
    }
  }
  if (!targetRule) return null;

  const { name, rule } = targetRule;

  // Collect tokens that have precedence declarations
  const declaredPrecTokens = new Set<string>();
  for (const prec of model.precedence) {
    for (const sym of prec.symbols) declaredPrecTokens.add(sym);
  }

  // Check for shift/reduce: same terminal starts >=2 alternatives
  const firstTerminalCount = new Map<string, number>();
  for (const alt of rule.alternatives) {
    const sym = alt.firstSymbol;
    if (sym && /^[A-Z_][A-Z0-9_]*$/.test(sym) && model.tokens.has(sym)) {
      firstTerminalCount.set(sym, (firstTerminalCount.get(sym) ?? 0) + 1);
    }
  }

  const conflictTokens: string[] = [];
  for (const [token, count] of firstTerminalCount) {
    if (count >= 2 && !declaredPrecTokens.has(token)) {
      conflictTokens.push(token);
    }
  }

  // Also check for binary operator conflicts (recursive pattern)
  const undeclaredOps: string[] = [];
  for (const alt of rule.alternatives) {
    if (alt.hasPrec) continue;
    const syms = alt.symbols;
    if (syms.length >= 3 && syms[0] === name && syms[syms.length - 1] === name) {
      for (let k = 1; k < syms.length - 1; k++) {
        const sym = syms[k];
        if (model.tokens.has(sym) && !declaredPrecTokens.has(sym) && !undeclaredOps.includes(sym)) {
          undeclaredOps.push(sym);
        }
      }
    }
  }

  if (conflictTokens.length === 0 && undeclaredOps.length < 2) return null;

  const allConflictTokens = [...new Set([...conflictTokens, ...undeclaredOps])];
  const alternatives = rule.alternatives.map(a => a.symbols.length > 0 ? a.symbols : ['%empty']);

  // Generate explanation
  const isBinaryConflict = undeclaredOps.length >= 2;
  let explanation: string;
  const derivations: string[] = [];
  const fixes: Array<{ title: string; code: string; description: string }> = [];

  if (isBinaryConflict) {
    explanation = `Rule '${name}' contains left-recursive binary operator alternatives using tokens [${undeclaredOps.join(', ')}] without precedence declarations. When the parser sees an expression like "a ${undeclaredOps[0]} b ${undeclaredOps[1]} c", it cannot decide whether to shift ${undeclaredOps[1]} (making it "a ${undeclaredOps[0]} (b ${undeclaredOps[1]} c)") or reduce the "${undeclaredOps[0]}" expression first (making it "(a ${undeclaredOps[0]} b) ${undeclaredOps[1]} c"). This is the classic operator-precedence ambiguity.`;

    derivations.push(
      `Derivation 1 (shift — right-associative):\n  ${name}\n  → ${name} ${undeclaredOps[0]} ${name}\n  → ${name} ${undeclaredOps[0]} ${name} ${undeclaredOps[1]} ${name}\n  = a ${undeclaredOps[0]} (b ${undeclaredOps[1]} c)`,
      `Derivation 2 (reduce — left-associative):\n  ${name}\n  → ${name} ${undeclaredOps[1]} ${name}\n  → ${name} ${undeclaredOps[0]} ${name} ${undeclaredOps[1]} ${name}\n  = (a ${undeclaredOps[0]} b) ${undeclaredOps[1]} c`
    );

    const opsDecl = undeclaredOps.map(op => `%left ${op}`).join('\n');
    fixes.push(
      {
        title: 'Add %left declarations (most common)',
        description: 'Declare operators with %left for left-to-right associativity. Order from lowest to highest precedence.',
        code: `/* In the declarations section, before %% */\n${opsDecl}`,
      },
      {
        title: 'Refactor into separate precedence levels',
        description: 'Split the rule into multiple rules, one per precedence level. This eliminates the ambiguity structurally.',
        code: `/* Example: separate add/multiply levels */\nexpr : term\n     | expr PLUS term\n     | expr MINUS term\n     ;\nterm : factor\n     | term TIMES factor\n     | term DIVIDE factor\n     ;`,
      },
      {
        title: 'Use %prec on specific alternatives',
        description: 'Use %prec to explicitly set the precedence of specific alternatives.',
        code: `/* On each alternative */\n${name} : ${name} ${undeclaredOps[0]} ${name}  %prec ${undeclaredOps[0]}\n     | ${name} ${undeclaredOps[1]} ${name}  %prec ${undeclaredOps[1]}\n     ;`,
      }
    );
  } else {
    const token = conflictTokens[0] || allConflictTokens[0];
    const matchingAlts = rule.alternatives.filter(a => a.firstSymbol === token);
    explanation = `Rule '${name}' has ${matchingAlts.length} alternatives that begin with the token '${token}'. When the parser has '${token}' as the lookahead, it cannot decide which alternative to choose. This is an ambiguity — the grammar allows multiple parse trees for the same input.`;

    derivations.push(
      ...matchingAlts.map((a, i) =>
        `Derivation ${i + 1}:\n  ${name}\n  → ${a.symbols.join(' ')}\n  (starts with ${token})`
      )
    );

    fixes.push(
      {
        title: 'Factor out the common prefix',
        description: 'If the alternatives share a common prefix, factor it out into a helper rule.',
        code: `${name} : ${token} ${name}_suffix ;\n${name}_suffix : /* first alternative rest */\n              | /* second alternative rest */\n              ;`,
      },
      {
        title: 'Add precedence declaration',
        description: 'If this involves operator precedence, declare the token with %left, %right, or %nonassoc.',
        code: `%left ${token}  /* or %right / %nonassoc */`,
      }
    );
  }

  return {
    ruleName: name,
    conflictTokens: allConflictTokens,
    alternatives,
    hasPrec: declaredPrecTokens.size > 0,
    explanation,
    derivations,
    fixes,
  };
});

// ── Custom request: AST Skeleton ────────────────────────────────────────────
connection.onRequest('bisonFlex/astSkeleton', (params: { uri: string }) => {
  const textDoc = documents.get(params.uri);
  if (!textDoc) return null;
  const model = ensureModel(textDoc);
  if (!model || !isBisonDocument(model)) return null;

  if (model.rules.size === 0) return null;

  const lines: string[] = [];
  lines.push('#pragma once');
  lines.push('');
  lines.push('#include <memory>');
  lines.push('#include <vector>');
  lines.push('#include <string>');
  lines.push('#include <variant>');
  lines.push('');
  lines.push('// ═══════════════════════════════════════════════════════════════════');
  lines.push('// AST Node Classes — Auto-generated from Bison grammar');
  lines.push('// ═══════════════════════════════════════════════════════════════════');
  lines.push('');

  // Forward declarations
  lines.push('// Forward declarations');
  for (const [name] of model.rules) {
    lines.push(`class ${toPascalCase(name)};`);
  }
  lines.push('');

  // Visitor interface
  lines.push('// ── Visitor Interface ───────────────────────────────────────────────');
  lines.push('class ASTVisitor {');
  lines.push('public:');
  lines.push('  virtual ~ASTVisitor() = default;');
  for (const [name] of model.rules) {
    const cls = toPascalCase(name);
    lines.push(`  virtual void visit(${cls}& node) = 0;`);
  }
  lines.push('};');
  lines.push('');

  // Base class
  lines.push('// ── Base AST Node ───────────────────────────────────────────────────');
  lines.push('class ASTNode {');
  lines.push('public:');
  lines.push('  virtual ~ASTNode() = default;');
  lines.push('  virtual void accept(ASTVisitor& visitor) = 0;');
  lines.push('');
  lines.push('  int line = 0;');
  lines.push('  int column = 0;');
  lines.push('};');
  lines.push('');

  // One class per non-terminal rule
  for (const [name, rule] of model.rules) {
    const cls = toPascalCase(name);
    const typeDecl = model.nonTerminals.get(name);
    const declaredType = typeDecl?.type;

    lines.push(`// ── ${cls} ──`);
    lines.push(`// Rule: ${name}`);
    if (rule.alternatives.length > 0) {
      for (const alt of rule.alternatives) {
        const syms = alt.symbols.length > 0 ? alt.symbols.join(' ') : '%empty';
        lines.push(`//   | ${syms}`);
      }
    }
    lines.push(`class ${cls} : public ASTNode {`);
    lines.push('public:');
    lines.push(`  void accept(ASTVisitor& visitor) override { visitor.visit(*this); }`);
    lines.push('');

    // Determine members from the alternatives' symbols
    const memberSet = new Map<string, string>(); // memberName -> C++ type
    for (const alt of rule.alternatives) {
      for (const sym of alt.symbols) {
        if (memberSet.has(sym)) continue;
        if (model.rules.has(sym)) {
          // Non-terminal → unique_ptr to AST class
          memberSet.set(sym, `std::unique_ptr<${toPascalCase(sym)}>`);
        } else if (model.tokens.has(sym)) {
          const tok = model.tokens.get(sym)!;
          if (tok.type) {
            memberSet.set(sym, tok.type);
          } else {
            memberSet.set(sym, 'std::string');
          }
        }
      }
    }

    if (declaredType) {
      lines.push(`  // %type <${declaredType}>`);
      lines.push(`  ${declaredType} value;`);
    }

    // Children from alternatives (with frequency-based naming)
    const nameCount = new Map<string, number>();
    for (const [sym, cppType] of memberSet) {
      const memberName = toSnakeCase(sym);
      const count = nameCount.get(memberName) ?? 0;
      nameCount.set(memberName, count + 1);
      const suffix = count > 0 ? `_${count + 1}` : '';
      lines.push(`  ${cppType} ${memberName}${suffix};`);
    }

    // If multiple alternatives, add a variant tag
    if (rule.alternatives.length > 1) {
      lines.push('');
      lines.push(`  // Which alternative was matched (0-based)`);
      lines.push(`  int alternative = 0;`);
    }

    // Children vector for list-like rules
    const isListRule = rule.alternatives.some(a =>
      a.symbols.includes(name) && a.symbols.length >= 2
    );
    if (isListRule) {
      lines.push('');
      lines.push(`  // For list-like patterns (left/right recursive)`);
      lines.push(`  std::vector<std::unique_ptr<ASTNode>> children;`);
    }

    lines.push('};');
    lines.push('');
  }

  // Determine file name
  const parsed = URI.parse(params.uri);
  const baseName = path.basename(parsed.fsPath, path.extname(parsed.fsPath));
  const fileName = `${baseName}_ast.hh`;

  return { code: lines.join('\n'), fileName };
});

documents.listen(connection);
connection.listen();

// ── Helpers ────────────────────────────────────────────────────────────────
function toPascalCase(name: string): string {
  return name
    .split(/[_\-.]/)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join('');
}

function toSnakeCase(name: string): string {
  return name
    .replace(/([A-Z])/g, '_$1')
    .replace(/^_/, '')
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_');
}
