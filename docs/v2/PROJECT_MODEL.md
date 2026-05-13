# Project Model — Bison/Flex Workbench 2.0

**Target PR:** PR 4 — ProjectModel foundation  
**Files created:** `server/src/project/projectTypes.ts`, `server/src/project/projectScanner.ts`, `server/src/project/projectModel.ts`  
**Files modified:** `server/src/server.ts` (initialization only)

---

## Purpose

V1 providers operate on a single document at a time. Cross-file knowledge is limited to what `crossFileSync.ts` can derive by scanning the document cache. There is no concept of a parser project — no knowledge of which `.y` file pairs with which `.l` file, where the build directory is, or what generated files exist.

The `ProjectModel` is the foundation for all V2 cross-file features: the Conflict Explorer, Token Flow Analyzer, the tree view, and compiler-backed diagnostics. It is built once at workspace open and updated incrementally on file changes.

---

## TypeScript Interfaces

These are the canonical interface definitions. The implementation in `projectTypes.ts` must match them exactly. Other documents (`CONFLICT_EXPLORER.md`, `TOKEN_FLOW.md`) depend on these types.

```typescript
// server/src/project/projectTypes.ts

export interface BisonFlexProjectModel {
  workspaceRoot: string;
  parsers: BisonSourceFile[];
  scanners: FlexSourceFile[];
  pairs: ParserScannerPair[];
  generatedFiles: GeneratedFile[];
  buildSystems: BuildSystemInfo[];
  lastScanned: number; // Date.now() timestamp
}

export interface BisonSourceFile {
  uri: string;             // file URI (vscode-uri format)
  fsPath: string;          // absolute filesystem path
  language: 'bison';
  buildDirectory?: string; // resolved build directory for this file (from settings or CMake)
  outputFile?: string;     // expected .output report path (if known)
}

export interface FlexSourceFile {
  uri: string;
  fsPath: string;
  language: 'flex' | 'reflex';
}

export interface ParserScannerPair {
  parser: BisonSourceFile;
  scanner: FlexSourceFile;
  confidence: 'explicit' | 'inferred'; // 'explicit' = CMakeLists.txt links them; 'inferred' = name match heuristic
}

export interface GeneratedFile {
  uri: string;
  fsPath: string;
  kind: 'tab.c' | 'tab.cpp' | 'tab.h' | 'lex.yy.c' | 'lex.yy.cpp' | 'output' | 'xml' | 'gv';
  sourceUri: string; // URI of the .y or .l file that generated it
}

export interface BuildSystemInfo {
  kind: 'cmake' | 'make' | 'automake' | 'unknown';
  configFile: string; // absolute path to CMakeLists.txt or Makefile
  buildDirectory?: string; // resolved build directory if detectable
}
```

---

## WorkspaceIndex

The `WorkspaceIndex` is the live, server-side singleton. It wraps the `BisonFlexProjectModel` and exposes query methods to providers.

```typescript
// server/src/project/projectModel.ts

export class WorkspaceIndex {
  private model: BisonFlexProjectModel;

  constructor(workspaceRoot: string) { ... }

  // Full scan — called once at workspace initialization
  async initialize(workspaceFolders: string[]): Promise<void> { ... }

  // Incremental update — called when a file is created, deleted, or renamed
  async onFileChange(uri: string, change: 'created' | 'deleted' | 'renamed'): Promise<void> { ... }

  // Query methods used by providers
  getPairForBison(bisonUri: string): ParserScannerPair | undefined { ... }
  getPairForFlex(flexUri: string): ParserScannerPair | undefined { ... }
  getBisonFiles(): BisonSourceFile[] { ... }
  getFlexFiles(): FlexSourceFile[] { ... }
  getAllPairs(): ParserScannerPair[] { ... }
  getGeneratedFilesFor(sourceUri: string): GeneratedFile[] { ... }
  getBuildInfo(): BuildSystemInfo[] { ... }
  getModel(): BisonFlexProjectModel { ... }
}
```

---

## File Discovery Algorithm

`projectScanner.ts` implements the workspace scan. Order of operations:

### Step 1 — Find source files

Recursively search each workspace folder for:

- `**/*.y`, `**/*.yy` → `BisonSourceFile` (language: `'bison'`)
- `**/*.l`, `**/*.ll` → `FlexSourceFile` (language: `'flex'`)

Exclude paths matching:
- `**/node_modules/**`
- `**/dist/**`
- `**/.git/**`
- `**/vendor/**`

### Step 2 — Find build systems

Look for:
- `CMakeLists.txt` in workspace root and immediate subdirectories (depth ≤ 2)
- `Makefile` in workspace root
- `configure.ac` or `Makefile.am` (automake)

### Step 3 — Detect parser/scanner pairs

**Strategy A — CMake explicit links (confidence: `'explicit'`):**

If a `CMakeLists.txt` contains `BISON_TARGET(..., foo.y, ...)` and `FLEX_TARGET(..., foo.l, ...)` within the same `target_link_libraries` or `add_flex_bison_dependency` call, treat them as a pair.

**Strategy B — Name heuristic (confidence: `'inferred'`):**

If a `.y` file and a `.l` file share the same stem after stripping common suffixes (`_parser`, `_scanner`, `-parser`, `-scanner`, `parser`, `scanner`, `_lex`, `_tab`), treat them as a pair.

Examples:
- `calc.y` + `calc.l` → paired (identical stem)
- `sql_parser.y` + `sql_scanner.l` → paired (stem `sql`)
- `json.y` + `json.l` → paired

If a `.y` file has no matching `.l` file, it is still included in `parsers` with no pair.

### Step 4 — Detect generated files

Look in each `BisonSourceFile.buildDirectory` (or the file's directory if none is configured) for:

| Pattern | Kind |
|---|---|
| `*.tab.c`, `*.tab.cpp` | `'tab.c'` / `'tab.cpp'` |
| `*.tab.h`, `*.tab.hpp` | `'tab.h'` |
| `lex.yy.c`, `lex.yy.cpp`, `*.yy.cpp` | `'lex.yy.c'` / `'lex.yy.cpp'` |
| `*.output` | `'output'` |
| `*.xml` (same stem as source) | `'xml'` |
| `*.gv` (same stem as source) | `'gv'` |

---

## Integration with server.ts

The `WorkspaceIndex` is instantiated and stored in `server.ts` as a module-level variable:

```typescript
let workspaceIndex: WorkspaceIndex | undefined;

connection.onInitialized(async () => {
  const folders = (await connection.workspace.getWorkspaceFolders()) ?? [];
  const roots = folders.map(f => URI.parse(f.uri).fsPath);
  if (roots.length > 0) {
    workspaceIndex = new WorkspaceIndex(roots[0]);
    await workspaceIndex.initialize(roots);
  }
});
```

Providers that need cross-file information receive the `WorkspaceIndex` as a parameter. Do not make `WorkspaceIndex` a global import in provider files — pass it from `server.ts` at call sites.

---

## Constraints

- `projectTypes.ts` must not import from `bisonParser.ts`, `flexParser.ts`, or any provider.
- `projectScanner.ts` must not import from any provider.
- `projectModel.ts` may import from `projectTypes.ts` and `projectScanner.ts` only.
- The scanner must not parse file content — it only inspects file paths and `CMakeLists.txt` content. Actual document parsing stays in `bisonParser.ts` and `flexParser.ts`.
- `initialize()` must be non-blocking for the LSP startup path. Use `setImmediate` or split into microtasks if the scan is slow.
- The `WorkspaceIndex` must degrade gracefully if no workspace folders are open (single-file mode). In that case, the index is empty and all query methods return `undefined` or `[]`.

---

## PR 4 Acceptance Criteria

1. `npm run compile` exits with code 0.
2. `WorkspaceIndex` is initialized in `server.ts` on `onInitialized`.
3. For a workspace containing `calc.y` and `calc.l`, `getAllPairs()` returns one pair with `confidence: 'inferred'`.
4. For a workspace with a `CMakeLists.txt` using `add_flex_bison_dependency(calc calc.y calc.l)`, the pair has `confidence: 'explicit'`.
5. All existing diagnostics pass unchanged — `tests/test-parsers.ts` and `tests/test-diagnostic-codes.ts` green.
6. No new provider files are modified.
7. The `WorkspaceIndex` does not throw when workspace folders is empty.
