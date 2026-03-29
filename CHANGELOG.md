# Changelog

All notable changes to the **Bison/Flex Language Support** extension will be documented in this file.

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
