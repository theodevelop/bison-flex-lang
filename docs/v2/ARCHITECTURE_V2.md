# Architecture V2 — Bison/Flex Workbench 2.0

## Current Architecture (V1 — baseline)

```
VS Code extension process
└── client/src/
    ├── extension.ts              (1800+ lines — LSP client + all webviews + compiler commands)
    ├── lineDirectiveNavigation.ts
    └── lineDirectiveUtils.ts

Node.js language server process
└── server/src/
    ├── server.ts                 (LSP router, document cache, request dispatch)
    ├── parser/
    │   ├── bisonParser.ts
    │   ├── flexParser.ts
    │   └── types.ts              (BisonDocument, FlexDocument — source of truth)
    └── providers/                (20 providers — one file per LSP feature)
        ├── diagnostics.ts
        ├── codeActions.ts
        ├── completion.ts
        ├── hover.ts
        ├── definition.ts
        ├── references.ts
        ├── rename.ts
        ├── inlayHints.ts
        ├── codeLens.ts
        ├── foldingRanges.ts
        ├── formatting.ts
        ├── documentSymbols.ts
        ├── workspaceSymbols.ts
        ├── crossFileSync.ts
        ├── firstFollow.ts
        ├── documentation.ts
        ├── cmake.ts
        ├── diagnosticCodes.ts
        ├── settings.ts
        └── utils.ts
```

**V1 problems addressed by V2:**

- `extension.ts` is 1800+ lines mixing LSP client setup, compiler invocation, and 5 webview panels.
- No project model — providers see one document at a time, cross-file knowledge is ad-hoc.
- Compiler integration is inline in `extension.ts`, not abstracted or testable.
- No `.output` report parsing — conflict explanations are heuristic.
- No token-level cross-file analysis.

---

## Target Architecture (V2)

```
VS Code extension process
└── client/src/
    ├── extension.ts              (thin — LSP client setup + command registration dispatch only)
    ├── commands/                 (PR 2 — extracted command handlers)
    │   ├── bisonCommands.ts      (compileBison, showParseTable, showGrammarGraph, explainConflict,
    │   │                          generateAstSkeleton, showConflictExplorer)
    │   ├── flexCommands.ts       (compileFlex, flexTestRule, showTokenFlow)
    │   └── navigationCommands.ts (showInSource, showInGenerated, showReferences, initTasksJson,
    │                              addCmakeTarget)
    ├── webviews/                 (PR 3 — extracted panel renderers)
    │   ├── grammarGraphPanel.ts
    │   ├── parseTablePanel.ts
    │   ├── flexTestPanel.ts
    │   ├── conflictExplorerPanel.ts   (PR 8)
    │   └── tokenFlowPanel.ts          (PR 9)
    ├── treeview/                 (PR 5)
    │   └── projectTreeProvider.ts
    ├── lineDirectiveNavigation.ts
    └── lineDirectiveUtils.ts

Node.js language server process
└── server/src/
    ├── server.ts                 (unchanged structure)
    ├── parser/
    │   ├── bisonParser.ts        (unchanged)
    │   ├── flexParser.ts         (unchanged)
    │   ├── bisonOutputParser.ts  (PR 7 — .output file parser)
    │   └── types.ts              (additive changes only)
    ├── project/                  (PR 4 — new layer)
    │   ├── projectModel.ts       (WorkspaceIndex, file discovery, pair detection)
    │   ├── projectScanner.ts     (file system scan logic)
    │   └── projectTypes.ts       (BisonFlexProjectModel and related interfaces)
    ├── runner/                   (PR 6 — new layer)
    │   ├── bisonRunner.ts        (bison child_process wrapper, stderr parser)
    │   ├── flexRunner.ts         (flex/reflex child_process wrapper, stderr parser)
    │   └── runnerTypes.ts        (CompilerResult, CompilerDiagnostic interfaces)
    └── providers/                (unchanged structure — additions only)
        ├── tokenFlow.ts          (PR 9 — new: cross-file token analysis)
        └── ... (all existing providers unchanged)
```

---

## Layer Responsibilities

| Layer | Location | Responsibility | Can import from |
|---|---|---|---|
| LSP types | `server/src/parser/types.ts` | BisonDocument, FlexDocument, all parsed AST types | Nothing internal |
| Parsers | `server/src/parser/` | Parse source text → document model | `types.ts` |
| Providers | `server/src/providers/` | Handle LSP requests, compute diagnostics | `parser/`, `types.ts` |
| Project | `server/src/project/` | Workspace file index, parser/scanner pair detection | `parser/`, `types.ts` |
| Runner | `server/src/runner/` | Spawn bison/flex/reflex, parse stderr/stdout | `types.ts`, `runnerTypes.ts` |
| Commands | `client/src/commands/` | VS Code command handlers, user interactions | VS Code API, LSP client |
| Webviews | `client/src/webviews/` | Panel creation, HTML generation, message passing | VS Code API |
| Treeview | `client/src/treeview/` | TreeDataProvider for Project view | VS Code API, LSP client |

**Rule:** No circular imports. Lower layers never import from higher layers. Providers do not import from runner. Runner does not import from providers.

---

## Data Flows

### Static analysis (V1 — preserved unchanged)

```
File open or change
  → TextDocuments cache (server.ts)
  → parseBisonDocument() or parseFlexDocument()
  → BisonDocument or FlexDocument (in-memory AST)
  → validateDocument()
      → computeBisonDiagnostics() / computeFlexDiagnostics()
      → computeBisonCrossFileDiagnostics() / computeFlexCrossFileDiagnostics()
  → connection.sendDiagnostics()
```

### Compiler-backed diagnostics (V2 — PR 6)

```
Save event or bisonFlex.compileBison command
  → bisonRunner.run(filePath, config)
      → child_process.spawn('bison', [...args])
      → parse stderr → CompilerDiagnostic[]
  → LSP notification → client
  → compilerDiagnostics DiagnosticCollection (VS Code)
```

### Project Model maintenance (V2 — PR 4)

```
Workspace open or file change
  → projectScanner.scan(workspaceFolders)
  → WorkspaceIndex { parsers, scanners, pairs, generatedFiles, buildSystems }
  → stored in server.ts global state
  → providers query WorkspaceIndex on request
```

### Conflict Explorer (V2 — PRs 7–8)

```
bisonFlex.compileBison or bisonFlex.showConflictExplorer command
  → bisonRunner.run(filePath, { reportFile: true })
  → .output file written to buildDirectory
  → bisonOutputParser.parse(outputFilePath)
  → BisonOutputReport { states, rules, conflicts }
  → LSP notification → client
  → conflictExplorerPanel.show(report)
  → webview message 'updateReport'
  → HTML panel renders conflict table with rule source links
  → user clicks rule → vscode.window.showTextDocument(uri, { selection: range })
```

### Token Flow Analysis (V2 — PR 9)

```
File save or bisonFlex.showTokenFlow command
  → WorkspaceIndex identifies parser/scanner pairs
  → tokenFlow.analyze(bisonDoc, flexDoc)
  → TokenFlowMap { declared, returned, aliases, missing, unused }
  → diagnostics: DC-401 missing token return / DC-402 declared but never returned
  → LSP publishDiagnostics (cross-file, on the flex file)
  → tokenFlowPanel.show(map)
  → webview renders token table with navigation links
```

---

## Existing Commands (must not change)

All command IDs and titles below are frozen. PRs 2–9 must not rename them.

| Command ID | Title |
|---|---|
| `bisonFlex.compileBison` | Bison: Compile |
| `bisonFlex.compileFlex` | Flex: Compile |
| `bisonFlex.showParseTable` | Bison: Show Parse Table |
| `bisonFlex.showGrammarGraph` | Bison: Show Grammar Graph |
| `bisonFlex.flexTestRule` | Flex: Test Rule |
| `bisonFlex.explainConflict` | Bison: Explain Conflict |
| `bisonFlex.generateAstSkeleton` | Bison: Generate AST Skeleton |
| `bisonFlex.initTasksJson` | Bison/Flex: Initialize tasks.json |
| `bisonFlex.addCmakeTarget` | Bison/Flex: Add CMake Target |
| `bisonFlex.showReferences` | Bison/Flex: Show References |
| `bisonFlex.noOp` | Bison/Flex: No-Op (internal) |
| `bisonFlex.showInSource` | Bison/Flex: Show in Source |
| `bisonFlex.showInGenerated` | Bison/Flex: Show in Generated File |

**New V2 commands** (added in their respective PRs):

| Command ID | Title | PR |
|---|---|---|
| `bisonFlex.showConflictExplorer` | Bison: Show Conflict Explorer | PR 8 |
| `bisonFlex.showTokenFlow` | Bison/Flex: Show Token Flow | PR 9 |

---

## Existing Settings (must not change)

All settings below are frozen. Their keys, types, defaults, and descriptions must not be modified.

| Setting | Type | Default |
|---|---|---|
| `bisonFlex.enableDiagnostics` | boolean | true |
| `bisonFlex.maxDiagnostics` | number | 100 |
| `bisonFlex.bisonPath` | string | `"bison"` |
| `bisonFlex.flexPath` | string | `"flex"` |
| `bisonFlex.showInlayHints` | boolean | true |
| `bisonFlex.enableCodeLens` | boolean | true |
| `bisonFlex.enableCmakeDiagnostics` | boolean | true |
| `bisonFlex.minVersionBison` | string | `""` |
| `bisonFlex.minVersionFlex` | string | `""` |
| `bisonFlex.disabledChecks` | array | `[]` |
| `bisonFlex.buildDirectory` | string | `""` |

**New V2 settings** (added in their respective PRs):

| Setting | Type | Default | PR |
|---|---|---|---|
| `bisonFlex.analysis.mode` | `"static" \| "compiler" \| "hybrid"` | `"static"` | PR 6 |
| `bisonFlex.reflexPath` | string | `"reflex"` | PR 6 |

---

## File Ownership by PR

### PR 2 — Split client commands

- **Extract from:** `client/src/extension.ts`
- **Create:** `client/src/commands/bisonCommands.ts`, `flexCommands.ts`, `navigationCommands.ts`
- **Constraint:** `extension.ts` becomes a thin dispatcher. All existing command IDs and behaviors identical. No `package.json` changes.
- **Acceptance:** `npm run compile` clean. All commands reachable from Command Palette. No behavior change observable to users.

### PR 3 — Split webview renderers

- **Extract from:** `client/src/extension.ts`
- **Create:** `client/src/webviews/grammarGraphPanel.ts`, `parseTablePanel.ts`, `flexTestPanel.ts`
- **Constraint:** Panel titles, icons, column positions, and message protocols unchanged. No `package.json` changes.
- **Acceptance:** `npm run compile` clean. All three panels open correctly. No visual regression.

### PR 4 — ProjectModel foundation

- **Create:** `server/src/project/projectTypes.ts`, `projectScanner.ts`, `projectModel.ts`
- **Modify:** `server/src/server.ts` — add `WorkspaceIndex` initialization on `onInitialized`
- **Constraint:** No changes to existing providers. No changes to `types.ts` interfaces. No new LSP capabilities registered.
- **Acceptance:** `npm run compile` clean. WorkspaceIndex populated on workspace open. Existing diagnostics unaffected.

### PR 5 — Project tree view

- **Create:** `client/src/treeview/projectTreeProvider.ts`
- **Modify:** `client/src/extension.ts` — register tree view. `package.json` — add `views` contribution under new `bisonFlexExplorer` container.
- **Constraint:** Tree view is read-only. No commands that modify files. Existing command palette unchanged.
- **Acceptance:** Tree view appears in Activity Bar. Shows parser/scanner pairs from WorkspaceIndex.

### PR 6 — Compiler runner foundation

- **Create:** `server/src/runner/runnerTypes.ts`, `bisonRunner.ts`, `flexRunner.ts`
- **Modify:** `package.json` — add `bisonFlex.analysis.mode` and `bisonFlex.reflexPath` settings. Client command modules — wire `compileBison`/`compileFlex` commands through runner.
- **Constraint:** `analysis.mode` defaults to `"static"` — no behavioral change until user opts in. Existing static diagnostics unaffected in all modes.
- **Acceptance:** With `analysis.mode: "compiler"` set, real bison errors appear as diagnostics. With `"static"`, behavior identical to V1.

### PR 7 — Bison report parser

- **Create:** `server/src/parser/bisonOutputParser.ts`
- **Modify:** `server/src/parser/types.ts` — additive: add `BisonOutputReport`, `ConflictInfo`, `StateInfo` interfaces
- **Constraint:** No changes to `BisonDocument` or `FlexDocument`. No changes to existing parsers. Parser is pure (no file I/O, no side effects — takes string content, returns model).
- **Acceptance:** Unit test in `tests/` parses a sample `.output` file, asserts states and conflicts are correctly extracted.

### PR 8 — Conflict Explorer webview

- **Create:** `client/src/webviews/conflictExplorerPanel.ts`
- **Modify:** `client/src/commands/bisonCommands.ts` — add `showConflictExplorer` handler. `package.json` — add command.
- **Constraint:** Reads from PR 7 parser output only. No direct bison process spawning in the panel. Navigation uses `vscode.window.showTextDocument` with `Range` from parsed locations.
- **Acceptance:** Panel opens, lists conflicts from a real `.output` file. Clicking a rule navigates to correct grammar line.

### PR 9 — Token Flow Analyzer

- **Create:** `server/src/providers/tokenFlow.ts`, `client/src/webviews/tokenFlowPanel.ts`
- **Modify:** `server/src/server.ts` — call tokenFlow on validated document pairs. Client command module — add `showTokenFlow` handler. `package.json` — add command.
- **Constraint:** New diagnostics use codes in `DC-4xx` range (not overlapping existing codes). Cross-file diagnostics published on the Flex file, not the Bison file. Rename support extended, not replaced.
- **Acceptance:** Missing token return → DC-401 diagnostic on flex file. Unused token → DC-402 diagnostic on bison file. Panel shows full token table with source links.
