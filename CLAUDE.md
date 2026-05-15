# Bison/Flex Language Support — VS Code Extension
> Extension LSP (TypeScript) pour Bison/Flex : diagnostics, completions, hover, code actions, navigation.

## Architecture
- Client   : `client/src/extension.ts` — thin LSP client, dispatch vers commands/
- Commands : `client/src/commands/` — bisonCommands.ts, flexCommands.ts, navigationCommands.ts
- Webviews : `client/src/webviews/` — grammarGraphPanel.ts, parseTablePanel.ts, explainConflictPanel.ts, flexTestPanel.ts
- Server   : `server/src/server.ts` — LSP server, document cache, routing vers providers
- Parsers  : `server/src/parser/` — bisonParser.ts, flexParser.ts, types.ts
- Providers: `server/src/providers/` — diagnostics, codeActions, completion, hover, codeLens, etc.
- #line nav: `client/src/lineDirectiveNavigation.ts` + `lineDirectiveUtils.ts`
- Build    : webpack, `npm run compile`

## État du projet (2026-05-14) — v1.5.3 + V2 en cours
- ✅ Tous les providers LSP, diagnostics, code actions, #line navigation (v1.5.3)
- ✅ v1.5.3 prête — PR dev→main ouverte, en attente merge + `vsce publish`
- ✅ V2 PR 2 prête — branch `refactor/split-extension-commands` (extension.ts 1822→66 lignes)
- ✅ V2 PR 3 prête — branch `refactor/extract-webview-renderers` (4 webview modules)
- 📋 V2 PR 4 suivante — `server/src/project/` ProjectModel

## Conventions
- TypeScript strict, pas de `any`
- `void validateDocument(...)` aux call sites (floating promise)
- Imports groupés en haut, pas de refactoring hors scope
- voir `.claude/CLAUDE.md` pour le processus complet (bugs, features, commits, PR)

## Fichiers de référence
- `.claude/CLAUDE.md`      ← processus détaillé, commandes, conventions
- `docs/INDEX.md`          ← symboles → file:line (grep uniquement, jamais lire en entier)
- `server/src/parser/types.ts` ← interfaces BisonDocument/FlexDocument (source de vérité)
- `server/src/providers/diagnosticCodes.ts` ← registre DC (30+ codes)
- `server/src/providers/settings.ts` ← ExtensionSettings, parseVersion, versionLt, isCheckEnabled

## Navigation
- Trouver un symbole → `grep "nom" docs/INDEX.md` → file:line → `sed -n 'L,+25p' FILE`
- Architecture complexe → lire `graphify-out/GRAPH_REPORT.md` (~2000 tokens)
- État courant → ce fichier § État
- Changements récents → `git log --oneline -10`
- Contexte > 6000 tokens : prévenir, suggérer nouveau chat
