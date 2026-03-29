# Contributing to Bison/Flex Language Support

Thank you for your interest in contributing!

## Getting started

```bash
git clone https://github.com/theodevelop/bison-flex-lang.git
cd bison-flex-lang
npm install
npm run compile
```

Press `F5` in VS Code to launch an Extension Development Host with the extension loaded.

## Project structure

```
client/src/extension.ts              # LSP client (thin wrapper)
server/src/server.ts                 # LSP server — document cache, routing
server/src/parser/
  bisonParser.ts                     # Bison 3-phase parser
  flexParser.ts                      # Flex 3-phase parser
  types.ts                           # Document model interfaces
server/src/providers/
  diagnostics.ts                     # All diagnostic checks
  diagnosticCodes.ts                 # Central registry of diagnostic codes
  codeActions.ts                     # Quick fix / code action provider
  completion.ts                      # Completion provider
  hover.ts                           # Hover provider
  documentation.ts                   # Doc maps (100+ entries)
  settings.ts                        # Version-gated settings helpers
  codeLens.ts                        # Code Lens provider
  documentSymbols.ts                 # Document outline provider
  workspaceSymbols.ts                # Workspace symbol search
  cmake.ts                           # CMake integration
tests/
  test-parsers.ts                    # Parser integration tests
  test-diagnostic-codes.ts           # Diagnostic code tests
  test-version-settings.ts           # Version settings tests
  test-fix-it-hints.ts               # Code action tests
```

## Branches

Always branch off `dev`, never `main`.

| Type | Pattern |
|------|---------|
| Feature | `feat/<short-description>` |
| Bug fix | `fix/<short-description>` |
| Chore / CI | `chore/<short-description>` |

## Commit messages

Short imperative title, no body required:

```
feat: add go-to-definition for Bison rules
fix: correct column offset in parseTokenNames
test: add assertions for flex/unused-sc
chore: bump version to 1.5.0
```

## Running tests

```bash
npm run compile

npx ts-node --project server/tsconfig.json tests/test-parsers.ts
TS_NODE_PROJECT=tsconfig.base.json npx ts-node tests/test-diagnostic-codes.ts
TS_NODE_PROJECT=tsconfig.base.json npx ts-node tests/test-version-settings.ts
TS_NODE_PROJECT=tsconfig.base.json npx ts-node tests/test-fix-it-hints.ts
```

All suites must pass before opening a PR.

## Opening a PR

1. Branch off `dev`.
2. Add or update tests.
3. Fill in the PR template — target `dev`, not `main`.

## Reporting a bug

Use the [Bug Report](https://github.com/theodevelop/bison-flex-lang/issues/new?template=bug_report.yml) template. Include a minimal `.y` or `.l` file that reproduces the issue.

## Requesting a feature

Use the [Feature Request](https://github.com/theodevelop/bison-flex-lang/issues/new?template=feature_request.yml) template, or open a [Discussion](https://github.com/theodevelop/bison-flex-lang/discussions) for larger ideas.
