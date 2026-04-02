# Changelog

All notable changes to the **Bison/Flex Language Support** extension will be documented in this file.

## [1.5.1] - 2026-04-02

### Fixed

- **Flex — escaped quotes in quoted string patterns** (#30): patterns like `X"\'"` and `Y"\""` no longer trigger false `flex/invalid-pattern` errors. The validator now correctly handles `\"` and `\'` escape sequences inside Flex quoted strings.
- **Flex — abbreviation refs on rule lines with no inline action** (#31): `{ABBR}` used after a `^` BOL anchor or on a rule line whose action block appears on the following line was not recorded as an abbreviation reference, causing false `flex/unused-abbrev` warnings.
- **Flex — quoted strings with spaces in `rawPattern`** (audit-A): patterns like `"hello world"` were truncated at the space inside the quoted literal, causing false `flex/unreachable-rule` duplicates for distinct patterns sharing a common word prefix. `rawPattern()` now tracks quoted-string depth.
- **Flex — standalone `{` as multi-line action opener** (audit-B): a `{` appearing alone on the line after a rule pattern (valid Flex multi-line action syntax) was pushed as a spurious rule entry with pattern `{`, producing false `flex/unreachable-rule` diagnostics for every subsequent multi-line-action rule.
- **Flex — lowercase start condition names** (audit-C): all start-condition regex patterns used `[A-Z_][A-Z0-9_]*` (uppercase only). SC names that are valid C identifiers but lowercase (e.g. `%x comment`) were silently ignored, skipping `flex/undefined-sc` and `flex/unused-sc` diagnostics for them entirely.
- **Flex — single-tab action separator in abbreviation ref scan** (audit-D): the heuristic that separates the pattern from the action used `\s{2,}`, which did not match a single-tab separator. `{identifier}` tokens inside the C action body (e.g. compound literals) were falsely counted as abbreviation references, suppressing `flex/unused-abbrev`.
- **Cleanup**: removed two dead entries in the catch-all pattern set that contained a literal newline character and could never match a rule line.
- **Bison — lowercase/mixed-case tokens in precedence declarations** (audit-E): `%left`/`%right`/`%nonassoc` used an uppercase-only regex `[A-Z_][A-Z0-9_]*`, silently dropping tokens like `kPLUS` or `tTOKEN` from the precedence table. This caused false `bison/undeclared-token` warnings and incorrect shift/reduce heuristic results for such tokens.
- **Bison — `$N` references after nested sub-blocks in inline actions** (audit-F): the `extractDollarRefs` scanner used `/\{([^}]*)\}/` which stops at the first `}`, missing `$N` references that appear after a nested `{ … }` block inside the same action (e.g. `{ if (cond) { log(); } $$ = $5; }`). Replaced with a brace-depth scanner; the same fix was applied to `extractSymbols`, `getFirstSymbol`, and `extractRuleReferences` for consistency.

---

## [1.5.0] - 2026-04-01

### Added

- **`#line`-based navigation** (#27): two new commands to jump between Bison/Flex grammar sources and their generated C files:
  - **`Bison/Flex: Show in Source`** — from a generated `.tab.c` / `lex.yy.c` file, reads the nearest `#line N "file.y"` directive above the cursor and opens the grammar source at the correct line. Appears in the context menu only when a generated file is detected.
  - **`Bison/Flex: Show in Generated File`** — from a `.y` / `.l` source, locates the generated file (using `bisonFlex.buildDirectory` setting, CMake detection, Makefile detection, same-directory fallback, then workspace-wide search) and navigates to the matching line. A QuickPick is shown when multiple candidates are found.
  - New setting `bisonFlex.buildDirectory`: optional path to the build output directory, used by **Show in Generated File** to locate generated files when they are not in the same directory as the source.

---

## [1.4.1] - 2026-03-31

### Fixed

- **Bison — mid-rule action `$N` out-of-bounds** (#21): Action blocks `{ }` embedded in the middle of a production are now counted as grammar symbols in Bison's `$N` numbering. Previously they were silently stripped, causing false-positive `bison/out-of-bounds` errors and missed real out-of-bounds accesses.
- **Bison — `%token` numeric value and string alias** (#22): `%token NAME NUMBER "alias"` is now parsed in the correct order (numeric value before string alias). Previously, words inside the alias string were misidentified as token names, generating spurious `bison/undeclared-token` and `bison/unused-token` diagnostics.
- **Flex — `<SC>{ }` block syntax** (#23): Rules grouped inside a `<SC1,SC2>{ ... }` block now correctly inherit their start conditions. Previously, the block header was misidentified as a rule pattern, suppressing all rules inside it and generating false `flex/unreachable-rule` and `flex/unused-sc` diagnostics.

---

## [1.4.0] - 2026-03-30

### Added

- **Fix-it hints (Code Actions)** — 22 quick fixes triggered directly from the Problems panel or the lightbulb (`Ctrl+.`), covering the majority of Bison and Flex diagnostics:
  - *Bison:* insert `%%`, declare `%token`, insert `%empty`, remove unused token, remove unknown directive, add rule stub, add `%type <todo>` declaration, remove invalid `%start`, add `%start`, close `%{` block, and 4 yacc-compat replacements (`%error-verbose`, `%name-prefix`, `%pure-parser`, `%binary`)
  - *Flex:* insert `%%`, define abbreviation stub, remove unused abbreviation, remove unused start condition, remove unknown directive, declare `%x SC_NAME`, remove unused `%option`, remove duplicate `<<EOF>>`, add `%option noyywrap`, close `%{` block, remove inaccessible rule

- **Version-gated diagnostics** — three new settings to target a specific toolchain:
  - `bisonFlex.minVersionBison` — suppress checks that require Bison ≥ the given version (e.g. `"3.0"`)
  - `bisonFlex.minVersionFlex` — same for Flex
  - `bisonFlex.disabledChecks` — array of diagnostic codes to suppress entirely (e.g. `["bison/shift-reduce", "flex/missing-yywrap"]`)
  - New `bison/feature-requires-version` diagnostic when a `%define` feature exceeds the configured min version

### Changed

- Every diagnostic now carries a `source` field (`"bison"`, `"bison-yacc-compat"`, or `"flex"`), a `code` slug (e.g. `bison/unused-token`), and a `codeDescription.href` link to the GNU documentation — the code is rendered as a clickable link in the Problems panel
- `DiagnosticTag.Unnecessary` applied to unused tokens, unused rules, unused start conditions, and unused abbreviations (symbols appear greyed-out in the editor)

### Fixed

- **Bison — `DiagnosticTag.Unnecessary` column offset**: `parseTokenNames()` used a relative column index when highlighting unused token names, causing the grey underline to start mid-token instead of at the first character

### CI

- Pipeline now triggers on `dev` branch (push and pull_request) in addition to `main`
- New step: `vsce package` + artifact upload (`extension-vsix`, 30-day retention)

---

## [1.1.3] - 2026-03-23

### Fixed

- **Bison — comments and action blocks**: Identifiers inside `/* */` block comments
  (including multi-line), `//` line comments, and `{ }` action blocks are no longer
  falsely reported as undeclared tokens

---

## [1.1.2] - 2026-03-20

### Fixed

- **Bison — lowercase and mixed-case token names**: Tokens with lowercase letters or
  digits in their name (e.g. `lower_case_tok`, `STANDARD_202x`, `MIXEDcase123`) are
  now correctly parsed from `%token` declarations and no longer trigger false
  "unused token" warnings

---

## [1.1.1] - 2026-03-19

### Fixed

- **Bison — token aliases**: Tokens declared with a string alias (e.g. `%token LBRACE "{"`)
  are no longer falsely reported as unused when the alias form is used in rules
- **Bison — `$N` out-of-bounds**: String literal tokens (e.g. `"-"` in `"-" exp`) are now
  counted as positional symbols, eliminating false `$2 is out of bounds` errors
- **Bison — shift/reduce false positive**: The S/R heuristic now suppresses warnings when
  all alternatives sharing a first token have distinct second tokens (e.g. `ID "("`,
  `ID "{"`, `ID "["` in expression rules)
- **Bison — `UMINUS` / precedence tokens**: Tokens declared only via `%left`/`%right`/
  `%nonassoc` are no longer reported as undeclared
- **Bison — EOF token**: The end-of-input token (value 0) is no longer reported as unused
- **Bison — `%token` after `%%`**: Token declarations appearing in the rules section
  (valid Bison syntax) are now correctly registered
- **Flex — `/* comment */` in rules section**: Single-line block comments in the rules
  section were incorrectly parsed as Flex rules, producing false duplicate-pattern warnings
- **Flex — `rawPattern` with spaces in character classes**: Patterns like `\\[ \t\n]+\\`
  were truncated at the space inside `[...]`, producing false "invalid regex" errors
- **Flex — RE-flex directives**: `%namespace`, `%lexer`, `%lex`, `%unicode`, and other
  RE-flex-specific directives no longer trigger "unknown directive" errors
- **Flex — RE-flex `noyywrap`**: RE-flex files no longer trigger the missing `noyywrap` warning
- **Flex — `<SC><<EOF>>`**: EOF rules after a catch-all pattern are no longer flagged
  as inaccessible
- **Security**: `.env` file excluded from packaged VSIX (was inadvertently included)

### Added

- Hover and completion documentation for RE-flex built-in methods:
  `size()`, `lineno()`, `columno()`, `in()`, `out()`

---

## [1.1.0] - 2026-03-18

### Added

- **Document Symbols** — Outline view (`Ctrl+Shift+O`) with collapsible sections for declarations, rules, and epilogue (Bison) or definitions, rules, and user code (Flex)
- **Workspace Symbols** — Fuzzy symbol search (`Ctrl+T`) across all open Bison and Flex files (up to 200 results)
- **Code Lens** — "N reference(s)" above each Bison rule and Flex start condition; "⬪ entry point" badge above the start symbol
- **Inlay Hints** — Inline type annotations for `$$`, `$1`, `$2`, etc. derived from `%type`/`%token` declarations
- **CMake Integration**
  - Diagnostic warning when a `.y`/`.l` file is not referenced in a nearby `BISON_TARGET`/`FLEX_TARGET`
  - New command **Bison/Flex: Add CMake Target** — appends the correct `BISON_TARGET` or `FLEX_TARGET` snippet to `CMakeLists.txt`
- **Compile Commands**
  - **Bison: Compile** — runs `bison -d` on the current file and surfaces errors as VS Code diagnostics
  - **Flex: Compile** — runs `flex` on the current file and surfaces errors as VS Code diagnostics
- **Grammar Tools**
  - **Bison: Show Parse Table** — renders the `.output` parse table in a side panel
  - **Bison: Show Grammar Graph** — interactive D3.js force-directed graph; click a node to navigate to the rule; detects left/right recursion
  - **Bison: Explain Conflict** — detailed shift/reduce conflict analysis with fix suggestions and precedence recommendations
  - **Bison: Generate AST Skeleton** — generates a complete C++ AST with visitor pattern, forward declarations, and node classes
  - **Flex: Test Rule** — interactive regex tester for the pattern on the current line
- **Initialize tasks.json** — auto-generates `.vscode/tasks.json` with Bison/Flex problem matchers; auto-detects CMake and Makefile projects
- **Yacc Legacy Hints** — inlay hints for legacy `%pure_parser`, `%union`, and `YYSTYPE` patterns pointing to modern Bison equivalents
- **Smart Indent** — `onEnterRules` for Bison and Flex that indent correctly after rule openers and `%{`/`%}`

### Changed

- README updated with all new features, configuration settings, and screenshots
- Status bar shows a "Grammar Graph" shortcut button when a Bison file is active

### Configuration

Three new settings:

| Setting | Default | Description |
|---------|---------|-------------|
| `bisonFlex.showInlayHints` | `true` | Show inlay hints for `$$`/`$1`/`@$` semantic values |
| `bisonFlex.enableCodeLens` | `true` | Show Code Lens reference counts and entry-point badges |
| `bisonFlex.enableCmakeDiagnostics` | `true` | Warn when a `.y`/`.l` file is missing from `CMakeLists.txt` |

---

## [1.0.0] - 2026-03-13

### Added

- **Syntax highlighting** for Bison (`.y`, `.yy`) and Flex/RE-flex (`.l`, `.ll`)
  - Section-aware grammars (declarations / rules / epilogue)
  - Embedded C/C++ highlighting in code blocks and actions
  - Semantic value highlighting (`$$`, `$1`, `@$`, `@1`)
  - Start condition highlighting (`<SC_NAME>`)
  - Abbreviation reference highlighting (`{name}`)
- **Real-time diagnostics**
  - Bison:
    - Missing `%%` section separator (Error)
    - Unknown/invalid directive — e.g. `%prout` (Error)
    - Token used in grammar rules but not declared with `%token` (Warning)
    - `%type` declared for a non-terminal that has no rule (Warning)
    - Rule missing `%type` declaration when `api.value.type=variant` is active (Info)
    - Unclosed `%{ %}` code block (Error)
    - Unused grammar rules — not reachable from the start symbol (Warning)
    - Unused tokens — declared with `%token` but never referenced in rules (Warning)
    - Shift/reduce conflict heuristic — same terminal appears in two or more alternatives of a rule (Warning)
  - Flex:
    - Missing `%%` section separator (Error)
    - Unknown/invalid directive — e.g. `%woops` (Error)
    - Undefined start condition used in a rule (`<SC>` not declared with `%x`/`%s`) (Error)
    - Undefined abbreviation referenced in a pattern (`{name}` not in definitions section) (Warning)
    - Start condition declared but never used in any rule (Info)
    - Abbreviation declared but never referenced in any pattern (Info)
    - Unclosed `%{ %}` code block (Error)
    - Inaccessible rule — catch-all pattern before a specific pattern, or duplicate pattern (Warning)
- **Autocompletion**
  - 30+ Bison directives with documentation
  - 20+ Flex `%option` values
  - All `%define` configuration variables
  - Token and non-terminal names from declarations
  - Semantic value references (`$$`, `$1`, `@$`)
  - Start conditions and abbreviation names (Flex)
- **Hover documentation**
  - Every Bison directive with signature, description, and example
  - Every `%define` variable
  - Flex directives, options, and built-in functions
  - Token/non-terminal declaration info
- **Code snippets**
  - 14 Bison snippets (grammar skeleton, rules, directives)
  - 12 Flex snippets (scanner skeleton, RE-flex skeleton, comment/string handlers)
- **Language configuration**
  - Bracket matching, auto-closing pairs, comment toggling, folding
- **File icon theme** (`bison-flex-icons`)
  - Distinct orange "B" icon for Bison files (`.y`, `.yy`, `.ypp`, `.bison`)
  - Distinct blue "F" icon for Flex files (`.l`, `.ll`, `.lex`, `.flex`)
