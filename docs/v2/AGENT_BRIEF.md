# Agent Brief — Bison/Flex Workbench 2.0

This document is for Claude Code, Codex, and other coding agents working on the `v2/workbench` branch. It is also useful for human contributors. It does not cover project onboarding or generic contribution guidelines.

---

## Purpose

This project is developed with a mix of human and agent authorship. This brief exists so that agents working on any PR can make correct decisions without requiring per-session clarification. Read this document and the target PR section of `ARCHITECTURE_V2.md` before writing any code.

---

## Golden Rules

These rules apply to every PR, every session, every agent.

1. **One PR = one goal.** Never mix a feature implementation with a refactor, or a refactor with a behavior change.
2. **Preserve existing command IDs.** The strings `bisonFlex.compileBison`, `bisonFlex.showGrammarGraph`, etc. are frozen. Do not rename them, remove them, or add aliases. See `ARCHITECTURE_V2.md § Existing Commands`.
3. **Preserve existing settings.** Keys, types, defaults, and descriptions are frozen. New settings may be added; existing ones may not be modified. See `ARCHITECTURE_V2.md § Existing Settings`.
4. **Do not rewrite large files without explicit instruction.** If a file is not in scope for the current PR, do not touch it. If a file needs to shrink (PRs 2–3), extract into new files, do not inline-replace the whole file.
5. **Do not change user-visible behavior unless the PR goal requires it.** A refactor PR (2–3) must be invisible to the user. A new-feature PR (4–9) adds behavior but must not break existing behavior.
6. **Compile must stay green after every PR.** Run `npm run compile` before reporting done. If compile fails, fix it in the same PR — do not defer.
7. **No floating promises.** All `validateDocument()` call sites use `void validateDocument(...)`. This convention must be preserved when adding new async calls.
8. **TypeScript strict mode, no `any`.** The `tsconfig` files enforce this. Do not suppress errors with `any` casts or `@ts-ignore`.

---

## PR Boundaries

Each PR has an explicit scope. Working outside that scope in a PR is a defect, not a bonus.

| PR | Scope | Forbidden in this PR |
|---|---|---|
| PR 1 | Add `docs/v2/` files only | Any source code change |
| PR 2 | Extract commands from `extension.ts` into `commands/` | Behavior changes, `package.json` changes |
| PR 3 | Extract webview renderers from `extension.ts` into `webviews/` | Behavior changes, `package.json` changes |
| PR 4 | Add `server/src/project/` layer | Modifying existing providers, modifying `types.ts` existing interfaces |
| PR 5 | Add tree view panel | Commands that modify files, changes to existing providers |
| PR 6 | Add `server/src/runner/` layer + `analysis.mode` setting | Modifying static diagnostic logic |
| PR 7 | Add `bisonOutputParser.ts` | Modifying `BisonDocument` or `FlexDocument`, touching existing parsers |
| PR 8 | Add conflict explorer panel + command | Changes to PR 7 parser API after it is merged |
| PR 9 | Add `tokenFlow.ts` provider + panel + command | Adding diagnostic codes that overlap existing `DC-1xx` to `DC-3xx` range |

**If a problem is discovered that is outside PR scope**, document it in `docs/TODO.md` with a `BUG file:line — symptom | cause | fix` entry and continue with the current PR.

---

## File Ownership and Areas of Responsibility

When a PR targets a file, that file is in scope. When it does not, the file is read-only for that PR.

### Read-only in all PRs unless explicitly listed as target

- `server/src/parser/bisonParser.ts`
- `server/src/parser/flexParser.ts`
- `server/src/parser/types.ts` — additive changes only (new interfaces may be appended, existing ones are frozen)
- `server/src/providers/diagnosticCodes.ts` — new codes may be appended in the correct range, existing codes are frozen
- `server/src/providers/settings.ts` — new settings may be added; existing `ExtensionSettings` fields are frozen
- `package.json` — changes only in the PR that introduces a new command or setting (see PR table above)
- `client/src/lineDirectiveNavigation.ts`
- `client/src/lineDirectiveUtils.ts`

### Write targets by PR

| File / Directory | Target PR |
|---|---|
| `docs/v2/` | PR 1 |
| `client/src/commands/` | PR 2 |
| `client/src/webviews/` (grammarGraph, parseTable, flexTest panels) | PR 3 |
| `server/src/project/` | PR 4 |
| `client/src/treeview/` | PR 5 |
| `server/src/runner/` | PR 6 |
| `server/src/parser/bisonOutputParser.ts` | PR 7 |
| `client/src/webviews/conflictExplorerPanel.ts` | PR 8 |
| `server/src/providers/tokenFlow.ts`, `client/src/webviews/tokenFlowPanel.ts` | PR 9 |

---

## Safe Refactor Rules (PRs 2–3)

PRs 2 and 3 are mechanical extractions. They must be zero-behavior-change.

**Allowed:**

- Move a function or class from `extension.ts` to a new file and re-export or import it.
- Split a large inline HTML string into a dedicated module function.
- Add an import to `extension.ts`.
- Remove dead code that is already unreachable (but only if you can prove it with `grep`).

**Not allowed:**

- Changing function signatures.
- Changing the behavior of any extracted function, even to "improve" it.
- Merging or splitting existing functions.
- Changing panel creation options (column, retain context, etc.).
- Changing message protocol between extension and webview.
- Adding error handling that changes the error path.

**How to verify a refactor is safe:** After extraction, `grep` for every occurrence of the original symbol name in the full repository and confirm all references still resolve.

---

## Testing Expectations

### Compile check (required for every PR)

```bash
npm run compile
```

Must exit with code 0. No TypeScript errors. No warnings treated as errors.

### Parser tests (required when touching `parser/`)

```bash
npx ts-node --project server/tsconfig.json tests/test-parsers.ts
```

### Diagnostic code tests (required when adding diagnostic codes)

```bash
TS_NODE_PROJECT=tsconfig.base.json npx ts-node tests/test-diagnostic-codes.ts
```

### Version/settings tests (required when touching `settings.ts`)

```bash
TS_NODE_PROJECT=tsconfig.base.json npx ts-node tests/test-version-settings.ts
```

### New tests

When a PR introduces new logic, it must introduce a corresponding test in `tests/`. Tests use `assert(condition, message)` pattern (no test framework). Flex tests use `require('../server/src/parser/flexParser')`. Bison inline rules use `name : body ;` (no line breaks in rule body). Tests must print `Results: X passed, 0 failed`.

### Manual smoke test (for PRs with UI)

After PR 3, 5, 8, or 9: open a real `.y` file, trigger the new command from the Command Palette, verify the panel opens without error.

---

## What Agents Must Not Do

These actions are prohibited without explicit written user instruction.

- **Do not commit or push.** Git operations (add, commit, push, merge, rebase, reset) are performed by the user. Agents modify files locally only.
- **Do not modify `CHANGELOG.md`.** Changelog updates happen at release time, not during feature development.
- **Do not bump `package.json` version.** Version bumps are a separate, explicit step.
- **Do not run `vsce package` or `vsce publish`.**
- **Do not create new GitHub issues or PRs via `gh`.** Documentation of discovered bugs goes into `docs/TODO.md`.
- **Do not install new npm dependencies** without explicit instruction. The dependency footprint of a VS Code extension matters for VSIX size and startup time.
- **Do not add telemetry, analytics, or network calls** of any kind.
- **Do not add console.log statements** in production paths. Debugging output belongs in the LSP output channel only, behind a flag if needed.
- **Do not rename existing exported symbols** in `types.ts`, `settings.ts`, or `diagnosticCodes.ts` — downstream providers depend on these names.

---

## How to Work from the Roadmap Without Drifting

The `ROADMAP.md` describes the full V2 vision across multiple releases (V2.0, V2.1, V2.2). Do not implement V2.1 or V2.2 features while working on a V2.0 PR.

**Before starting any PR:**

1. Read `ROADMAP.md § PR Plan` for the target PR goal.
2. Read `ARCHITECTURE_V2.md § File Ownership by PR` for the exact files in scope.
3. Read this document's PR Boundaries table.
4. Read the relevant feature spec (`PROJECT_MODEL.md`, `CONFLICT_EXPLORER.md`, or `TOKEN_FLOW.md`) if the PR implements a new subsystem.

**When the spec and the code disagree:**

- If existing code has a problem the spec does not mention, document it in `docs/TODO.md` and continue.
- If the spec requires something impossible given the current codebase state, stop and report the conflict before writing code.
- Do not work around a spec conflict silently.

**Scope creep signals to watch for:**

- "While I'm here, I'll also improve X" — do not do this.
- "The spec says A but B would be cleaner" — implement A, note B in `docs/TODO.md`.
- "The PR 5 feature would be easier if I first added Y in PR 4" — only add Y if it is in PR 4's stated scope.

---

## Diagnostic Code Ranges

New diagnostic codes must use the correct range. Existing codes must not be renumbered.

| Range | Owner |
|---|---|
| DC-001 to DC-099 | Bison structural diagnostics |
| DC-100 to DC-199 | Bison semantic diagnostics |
| DC-200 to DC-299 | Flex diagnostics |
| DC-300 to DC-399 | Cross-file diagnostics |
| DC-400 to DC-499 | Token Flow diagnostics (PR 9) |
| DC-500+ | Reserved for future use |

See `server/src/providers/diagnosticCodes.ts` for the full current registry.
