# Conflict Explorer — Bison/Flex Workbench 2.0

**Target PRs:**
- PR 7 — `server/src/parser/bisonOutputParser.ts` (report parser, server-side)
- PR 8 — `client/src/webviews/conflictExplorerPanel.ts` + command (webview, client-side)

---

## Purpose

The current `bisonFlex.explainConflict` command provides heuristic conflict explanations based on static grammar analysis. It is useful but cannot reproduce what Bison actually computed. V2 adds a real conflict explorer backed by Bison's `.output` report file, which contains the full LR automaton: all states, their items, their transitions, and all conflicts with their resolution decisions.

The goal is to make shift/reduce and reduce/reduce conflicts understandable from inside VS Code, with navigation to the grammar rules that caused them.

---

## Bison `.output` Report Format

Bison writes a `.output` file when invoked with `--report=all` (or the `%verbose` directive). The format is human-readable text, not machine-readable, and must be parsed with a handwritten parser.

### Grammar summary section

```
Grammar

    0 $accept: start $end

    1 expression: expression '+' term
    2           | term

    3 term: NUMBER
```

Each numbered rule appears exactly once. Rules are referenced by their number in the state descriptions.

### Terminal and nonterminal section

```
Terminals, with rules where they appear

$end (0) 0
'+' (43) 1
NUMBER (258) 3
...

Nonterminals, with rules where they appear

$accept (5)
    on left: 0
expression (6)
    on left: 1 2, on right: 0 1
term (7)
    on left: 3, on right: 1 2
```

### State section

Each state block looks like this:

```
State 0

    0 $accept: . start $end

    NUMBER  shift, and go to state 1

    start   go to state 2
```

Or with a conflict:

```
State 5

    1 expression: expression . '+' term
    2 expression: expression .        ['+', $end]

    '+' shift, and go to state 4
    '+' [reduce using rule 2 (expression)]
    $end  reduce using rule 2 (expression)
```

### Conflicts section (summary)

```
State 5 conflicts: 1 shift/reduce
```

Or for reduce/reduce:

```
State 12 conflicts: 2 reduce/reduce
```

---

## Parser Design (PR 7)

`bisonOutputParser.ts` is a pure function: it takes the `.output` file content as a string and returns a `BisonOutputReport`. It has no side effects, no file I/O, and no dependency on the VS Code API.

### Output type interfaces

```typescript
// Append to server/src/parser/types.ts — do not modify existing interfaces

export interface BisonOutputReport {
  rules: OutputRule[];
  states: OutputState[];
  conflicts: ConflictInfo[];
  terminalCount: number;
  nonterminalCount: number;
  stateCount: number;
}

export interface OutputRule {
  number: number;       // rule number as printed by Bison (0-based)
  lhs: string;          // left-hand side non-terminal name
  rhs: string[];        // right-hand side symbols in order
}

export interface OutputState {
  number: number;
  items: StateItem[];
  shifts: Transition[];
  gotos: Transition[];
  reductions: Reduction[];
  conflicts: StateConflict[];
}

export interface StateItem {
  ruleNumber: number;
  dotPosition: number;  // index of the dot in the RHS (0 = before first symbol)
  lookaheads?: string[];
}

export interface Transition {
  symbol: string;
  targetState: number;
}

export interface Reduction {
  lookahead: string;    // token that triggers this reduction
  ruleNumber: number;
}

export interface StateConflict {
  type: 'shift/reduce' | 'reduce/reduce';
  symbol: string;       // the lookahead token that is ambiguous
  shiftTarget?: number; // target state if shift wins
  reduceRule?: number;  // rule number if reduce wins
  resolvedBy?: 'precedence' | 'default'; // how Bison resolved it, if at all
}

export interface ConflictInfo {
  stateNumber: number;
  type: 'shift/reduce' | 'reduce/reduce';
  count: number;
  details: StateConflict[];
}
```

### Parsing strategy

The `.output` file has distinct sections separated by blank lines and section headers. The parser should be a section-by-section scanner, not a line-by-line grammar parser.

```typescript
export function parseBisonOutput(content: string): BisonOutputReport { ... }
```

**Section detection:**

1. `Grammar` header → parse numbered rules until the next section header
2. `Terminals, with rules where they appear` → parse terminal list
3. `Nonterminals, with rules where they appear` → parse non-terminal list
4. `State N` headers → parse state blocks
5. Lines matching `State N conflicts:` → extract conflict summary

**Error handling:** The parser must never throw. If a section is missing or malformed, return an empty array for that section and continue. This is critical because different Bison versions produce slightly different output formats (2.x vs 3.x).

**Bison version differences to handle:**

| Feature | Bison 2.x | Bison 3.x |
|---|---|---|
| State header | `state N` (lowercase) | `State N` |
| Conflict summary | Inline in state | May be separate section |
| Counterexamples | Not present | Present in Bison ≥ 3.6 (`--counterexamples`) |

The parser must handle both forms. Counterexample sections should be skipped for now (V2.1 target).

---

## Source Location Mapping

The conflict explorer must navigate from a conflict to the grammar source lines. The `.output` file does not contain source locations, but `BisonDocument` (from `bisonParser.ts`) does.

**Mapping strategy:**

Given `OutputRule.lhs` and `OutputRule.rhs`, find the matching `RuleDefinition` in `BisonDocument.rules`:

```typescript
function resolveRuleLocation(
  rule: OutputRule,
  doc: BisonDocument
): Range | undefined {
  const def = doc.rules.get(rule.lhs);
  if (!def) return undefined;
  // Find the alternative whose symbols match rule.rhs
  for (const alt of def.alternatives) {
    if (arraysEqual(alt.symbols, rule.rhs)) return alt.range;
  }
  return def.location; // fallback to rule declaration line
}
```

This mapping is performed in the client command handler (PR 8), not in the parser (PR 7). The parser output (rule numbers, symbol names) is matched against the live `BisonDocument` from the document cache.

---

## Webview Architecture (PR 8)

### Command handler

`bisonFlex.showConflictExplorer` command flow:

1. Get the active Bison document URI.
2. Find the `.output` file path: check `buildDirectory` setting, then adjacent directory.
3. If `.output` file does not exist: prompt user to compile first (`bisonFlex.compileBison`).
4. Read `.output` file content (fs.readFileSync — synchronous, small file).
5. Call `parseBisonOutput(content)` → `BisonOutputReport`.
6. Open `conflictExplorerPanel` with the report.

### Panel creation

```typescript
// client/src/webviews/conflictExplorerPanel.ts

export class ConflictExplorerPanel {
  static currentPanel: ConflictExplorerPanel | undefined;
  private readonly panel: WebviewPanel;

  static show(
    context: ExtensionContext,
    report: BisonOutputReport,
    docUri: string,
    bisonDoc: BisonDocument
  ): void { ... }

  private constructor(
    panel: WebviewPanel,
    report: BisonOutputReport,
    docUri: string,
    bisonDoc: BisonDocument
  ) {
    this.panel = panel;
    this.update(report, docUri, bisonDoc);
    this.panel.webview.onDidReceiveMessage(msg => this.handleMessage(msg));
    this.panel.onDidDispose(() => { ConflictExplorerPanel.currentPanel = undefined; });
  }

  private handleMessage(msg: { type: string; ruleNumber?: number; stateNumber?: number }): void {
    if (msg.type === 'navigateToRule' && msg.ruleNumber !== undefined) {
      // resolve source location and open document
    }
  }
}
```

### Webview message protocol

**Extension → Webview:**

```typescript
{ type: 'updateReport'; report: BisonOutputReport }
```

**Webview → Extension:**

```typescript
{ type: 'navigateToRule'; ruleNumber: number }
{ type: 'navigateToState'; stateNumber: number }
```

### Panel HTML structure

The panel renders a three-column layout:

```
┌─────────────────────────────────────────────────────────┐
│  Bison Conflict Explorer                                 │
│  N shift/reduce conflicts   M reduce/reduce conflicts    │
├──────────────┬──────────────────────────────────────────┤
│ Conflict     │  State 5                                  │
│ list         │  ────────────────────────────────────     │
│              │  Item set:                                │
│  • State 5   │    [1] expression → expression . '+' term │
│    S/R on +  │    [2] expression → expression .          │
│              │        lookaheads: ['+', $end]            │
│  • State 12  │                                           │
│    R/R on X  │  Conflict on '+':                         │
│              │    shift → state 4                        │
│              │    reduce → rule 2  [navigate ↗]          │
│              │    resolved by: default (shift wins)      │
└──────────────┴──────────────────────────────────────────┘
```

When the user clicks `[navigate ↗]` next to a rule, the extension opens the grammar file at the corresponding rule's source location using `vscode.window.showTextDocument`.

---

## Error States

| Condition | Behavior |
|---|---|
| `.output` file not found | Show information message: "No Bison report found. Run 'Bison: Compile' first." |
| `.output` file is empty | Show warning: "Bison report is empty." |
| Report has zero conflicts | Show panel with "No conflicts detected." message |
| Rule location not found in BisonDocument | Show rule number only, no navigation link |
| Bison not installed | Handled upstream by compiler runner — not the panel's concern |

---

## PR 7 Acceptance Criteria

1. `npm run compile` exits with code 0.
2. `parseBisonOutput('')` returns an empty report without throwing.
3. A new test `tests/test-bison-output-parser.ts` parses a sample `.output` file from `tests/fixtures/` and asserts:
   - Correct number of states
   - Correct rule LHS/RHS for at least two rules
   - Correct conflict count and type
4. `BisonDocument` and `FlexDocument` interfaces in `types.ts` are unchanged.
5. No changes to `bisonParser.ts` or `flexParser.ts`.

## PR 8 Acceptance Criteria

1. `npm run compile` exits with code 0.
2. `bisonFlex.showConflictExplorer` appears in Command Palette when a `.y` file is open.
3. Running the command with a valid `.output` file in the `buildDirectory` opens the panel.
4. Panel lists all shift/reduce and reduce/reduce conflicts from the report.
5. Clicking a rule link opens the grammar file at the correct line.
6. If `.output` is missing, the information message is shown (not an unhandled exception).
7. Existing `bisonFlex.explainConflict` command continues to work unchanged.
