# Bison/Flex Workbench 2.0 — Document Map

Entry point for all V2 documentation. Start here.

## V2 Documentation Index

| Document | Purpose |
|---|---|
| [ROADMAP.md](ROADMAP.md) | Full vision, pillars, PR plan, success criteria |
| [ARCHITECTURE_V2.md](ARCHITECTURE_V2.md) | Layer diagram, module map, data flow, file ownership per PR |
| [AGENT_BRIEF.md](AGENT_BRIEF.md) | Agent workflow guide — constraints, PR rules, what not to do |
| [PROJECT_MODEL.md](PROJECT_MODEL.md) | ProjectModel TypeScript interfaces — PR 4 spec |
| [CONFLICT_EXPLORER.md](CONFLICT_EXPLORER.md) | `.output` parser, conflict model, webview — PRs 7–8 spec |
| [TOKEN_FLOW.md](TOKEN_FLOW.md) | Token cross-file analysis, diagnostics, webview — PR 9 spec |

## Branch

```
Branch  : v2/workbench
Base    : main (v1.5.3)
Version : 2.0.0-dev
```

## PR Sequence

```
PR 1  — V2 documentation foundation          (this PR — docs only, no source changes)
PR 2  — Split client commands                (refactor only, no behavior change)
PR 3  — Split webview renderers              (refactor only, no behavior change)
PR 4  — ProjectModel foundation              (new layer, no existing code modified)
PR 5  — Project tree view                    (new tree view contribution)
PR 6  — Compiler runner foundation           (new runner layer + analysis.mode setting)
PR 7  — Bison report parser                  (new bisonOutputParser.ts)
PR 8  — Conflict Explorer webview            (new panel + command)
PR 9  — Token Flow Analyzer                  (new cross-file analysis + panel + command)
```

## V2.0 Target Scope

- Architecture refactor (PRs 2–3)
- Project Model + tree view (PRs 4–5)
- Compiler-backed diagnostics (PR 6)
- Bison Conflict Explorer v1 (PRs 7–8)
- Token Flow Analysis v1 (PR 9)
- Marketplace and README refresh

## V2.0 Non-Goals

See `ROADMAP.md § Non-goals for V2.0`.

## V2.0 Success Criteria

See `ROADMAP.md § Success Criteria`.
