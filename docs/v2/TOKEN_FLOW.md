# Token Flow Analysis — Bison/Flex Workbench 2.0

**Target PR:** PR 9 — Token Flow Analyzer  
**Files created:**
- `server/src/providers/tokenFlow.ts` (analysis engine)
- `client/src/webviews/tokenFlowPanel.ts` (webview panel)

**Files modified:**
- `server/src/server.ts` — call token flow analysis on paired document save
- `server/src/providers/diagnosticCodes.ts` — add DC-401, DC-402
- `client/src/commands/flexCommands.ts` — add `showTokenFlow` handler
- `package.json` — add `bisonFlex.showTokenFlow` command

---

## Purpose

In a Bison/Flex project, tokens form the contract between the parser and the scanner:

- Bison declares tokens with `%token`
- Flex returns them in rule actions with `return TOKEN_NAME;`

Mismatches — a token declared but never returned, or returned but never declared — are a common source of compile errors that are currently invisible in the editor. The Token Flow Analyzer builds a cross-file token map from the live `BisonDocument` and `FlexDocument` models, publishes diagnostics for mismatches, and exposes the full map in a webview panel.

---

## Token Flow Model

### Interfaces

```typescript
// server/src/providers/tokenFlow.ts

export interface TokenFlowMap {
  declared: DeclaredToken[];     // tokens in Bison %token declarations
  returned: ReturnedToken[];     // tokens returned in Flex rule actions
  aliases: TokenAlias[];         // string aliases for tokens (e.g., %token PLUS "+")
  missing: MissingReturn[];      // declared in Bison, never returned in Flex
  unused: UnusedToken[];         // returned in Flex but not declared in Bison
}

export interface DeclaredToken {
  name: string;
  type?: string;           // semantic value type from %token <type> NAME
  alias?: string;          // string alias from %token NAME "alias"
  location: Range;         // in the Bison file
  returnedAt: Range[];     // all locations in the Flex file where this token is returned
}

export interface ReturnedToken {
  name: string;
  location: Range;         // in the Flex file (the return statement location)
  declaredAt?: Range;      // location in the Bison file (undefined if undeclared)
}

export interface TokenAlias {
  tokenName: string;
  alias: string;
  location: Range;         // in the Bison file
}

export interface MissingReturn {
  tokenName: string;
  declaredAt: Range;       // in the Bison file
  severity: 'warning';     // always warning — user may return it in C code
}

export interface UnusedToken {
  tokenName: string;
  returnedAt: Range;       // in the Flex file
  severity: 'error';       // declared in Flex but unknown to Bison → always an error
}
```

### Analysis function

```typescript
export function analyzeTokenFlow(
  bisonDoc: BisonDocument,
  flexDoc: FlexDocument
): TokenFlowMap { ... }
```

This function is pure — it takes two already-parsed document models and returns the map. No file I/O, no network, no side effects.

---

## Token Extraction

### From BisonDocument (declared tokens)

Source: `bisonDoc.tokens` (a `Map<string, TokenDeclaration>`)

For each `TokenDeclaration`:
- `name` → `DeclaredToken.name`
- `type` → `DeclaredToken.type`
- `alias` → `DeclaredToken.alias` + one `TokenAlias` entry
- `location` → `DeclaredToken.location`

Special tokens to exclude from mismatch analysis:
- `error` — Bison built-in
- `$end`, `$undefined`, `$accept` — Bison internals (start with `$`)
- Tokens with numeric value ≤ 256 that correspond to single-character literals

### From FlexDocument (returned tokens)

Source: `flexDoc.rules` (a `FlexRule[]`)

Each `FlexRule` has a pattern and (implicitly) an action. The action content is not currently parsed by `flexParser.ts`.

**PR 9 scope:** Parse the action field of `FlexRule` to extract `return TOKEN_NAME;` statements.

This requires a minimal extension to `FlexRule` in `types.ts`:

```typescript
// Additive change to types.ts — do not modify existing fields

export interface FlexRule {
  pattern: string;
  startConditions: string[];
  location: Range;
  action?: FlexRuleAction; // new optional field — undefined means action not extracted
}

export interface FlexRuleAction {
  raw: string;              // raw action text (may be a block { ... } or inline)
  returns: TokenReturn[];   // parsed return statements
}

export interface TokenReturn {
  name: string;
  location: Range;          // location of the token name within the return statement
}
```

The action extraction logic belongs in `flexParser.ts` as an additive step after the existing parse. It must not change any existing output fields.

**Regex for action extraction (first pass):**

```
/\breturn\s+([A-Z_][A-Z0-9_]*)\s*;/g
```

This matches `return TOKEN_NAME;` where `TOKEN_NAME` is all-uppercase (Bison convention). Mixed-case token names will not be matched in V2.0 — document this limitation.

---

## Mismatch Detection

After building `declared` and `returned` sets:

### Missing returns (DC-401)

For each `DeclaredToken` where `returnedAt.length === 0`:

- Severity: `Warning`
- Message: `Token '${name}' is declared in Bison but never returned in the Flex scanner.`
- Location: the Bison file `%token` declaration line
- Diagnostic code: `DC-401`

Exception: do not emit DC-401 for tokens that appear in `%start` or are referenced only in C++ code blocks. These are edge cases — skip them safely by only emitting for tokens that appear in at least one grammar rule RHS.

### Undeclared returns (DC-402)

For each `ReturnedToken` where `declaredAt` is `undefined`:

- Severity: `Error`
- Message: `Token '${name}' is returned by Flex but not declared in Bison.`
- Location: the Flex file return statement
- Diagnostic code: `DC-402`

### Diagnostic publication

Cross-file diagnostics (Bison tokens reported against the Flex file and vice versa) must be published on the correct document's URI. The pattern from `crossFileSync.ts` applies:

- DC-401: published on the **Bison file** (the declaration is in the Bison file)
- DC-402: published on the **Flex file** (the return statement is in the Flex file)

The `tokenFlow.ts` provider must receive both file URIs from `server.ts` and return two diagnostic arrays — one per document.

---

## Integration with server.ts

```typescript
// In server.ts validateDocument() — after existing cross-file sync

const pair = workspaceIndex?.getPairForBison(bisonUri)
          ?? workspaceIndex?.getPairForFlex(documentUri);

if (pair) {
  const bisonDoc = documentCache.get(pair.parser.uri);
  const flexDoc  = documentCache.get(pair.scanner.uri);

  if (bisonDoc && flexDoc && isBisonDocument(bisonDoc) && !isBisonDocument(flexDoc)) {
    const flowMap = analyzeTokenFlow(bisonDoc, flexDoc);
    const bisonDiags = buildTokenFlowDiagnostics(flowMap, 'bison');
    const flexDiags  = buildTokenFlowDiagnostics(flowMap, 'flex');

    connection.sendDiagnostics({ uri: pair.parser.uri, diagnostics: [...existingBisonDiags, ...bisonDiags] });
    connection.sendDiagnostics({ uri: pair.scanner.uri, diagnostics: [...existingFlexDiags, ...flexDiags] });
  }
}
```

This only runs when both documents in a pair are open and cached. It does not run in single-file mode.

---

## Webview Panel (PR 9)

### Command

`bisonFlex.showTokenFlow` — available when a `.y` or `.l` file is active and a pair is detected.

If no pair is detected: show information message "No paired Flex/Bison files found. Open both files in the workspace."

### Panel HTML structure

```
┌────────────────────────────────────────────────────────────────┐
│  Token Flow — calc.y ↔ calc.l                                  │
│  23 declared  |  21 returned  |  2 missing  |  0 undeclared   │
├─────────────────┬──────────────────────────────────────────────┤
│ Token           │ Declared in Bison    │ Returned in Flex       │
│─────────────────┼──────────────────────┼───────────────────────│
│ PLUS            │ line 5  ↗            │ line 12  ↗            │
│ MINUS           │ line 6  ↗            │ line 13  ↗            │
│ NUMBER          │ line 7  ↗            │ line 20  ↗            │
│ IDENTIFIER      │ line 8  ↗            │ ⚠ never returned      │
│ UNKNOWN_TOK     │ not declared         │ line 45  ↗  ✗ error   │
└─────────────────┴──────────────────────┴───────────────────────┘
```

Rows with `⚠ never returned` are styled with a warning color. Rows with `✗ error` are styled with an error color.

### Webview message protocol

**Extension → Webview:**

```typescript
{ type: 'updateFlow'; map: TokenFlowMap; bisonFile: string; flexFile: string }
```

**Webview → Extension:**

```typescript
{ type: 'navigateToBison'; tokenName: string }
{ type: 'navigateToFlex';  tokenName: string }
```

Navigation opens the file and sets the cursor at the token's `location` using `vscode.window.showTextDocument`.

---

## Rename Support Extension

The existing `rename.ts` provider handles renaming within a single file. PR 9 must extend cross-file rename for tokens.

When the user initiates a rename on a `%token NAME` declaration or a `return NAME;` statement:

1. Collect all `location` and `returnedAt` ranges for the token from the `TokenFlowMap`.
2. Return a `WorkspaceEdit` that covers both the Bison and the Flex file.

This is an extension of the existing rename provider — do not replace the existing single-file rename logic. The cross-file rename only activates when the renamed symbol is found in a `TokenFlowMap`.

---

## Diagnostic Codes to Register

Add to `server/src/providers/diagnosticCodes.ts`:

```typescript
// Token Flow diagnostics (PR 9)
DC_401_TOKEN_NEVER_RETURNED        = 401,
DC_402_TOKEN_NOT_DECLARED_IN_BISON = 402,
```

Both codes must have entries in the `DIAGNOSTIC_REGISTRY` map with `title`, `description`, `severity`, and `category` fields matching the existing pattern.

---

## PR 9 Acceptance Criteria

1. `npm run compile` exits with code 0.
2. `analyzeTokenFlow(bisonDoc, flexDoc)` is a pure function with no side effects.
3. New test `tests/test-token-flow.ts` using `calc.y` / `calc.l` fixtures:
   - Asserts all declared tokens from `calc.y` appear in `declared`
   - Asserts all returned tokens from `calc.l` appear in `returned`
   - Asserts correct `missing` and `unused` arrays
4. `bisonFlex.showTokenFlow` appears in Command Palette when a `.y` or `.l` file is active.
5. Panel opens and shows the token table for a calc.y + calc.l workspace.
6. DC-401 diagnostic appears on Bison file for a token declared but not returned.
7. DC-402 diagnostic appears on Flex file for a token returned but not declared.
8. Renaming a `%token` declaration renames the corresponding `return` statement in the paired Flex file.
9. All existing tests pass unchanged: `test-parsers.ts`, `test-diagnostic-codes.ts`.
10. `WorkspaceIndex` is required for token flow — feature degrades gracefully (no error) when no pair is found.
