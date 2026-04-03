import { Diagnostic, DiagnosticSeverity, DiagnosticTag, Range } from 'vscode-languageserver';
import { DC, codeDesc } from './diagnosticCodes';
import { BisonDocument, FlexDocument } from '../parser/types';
import { ExtensionSettings, DEFAULT_SETTINGS, isCheckEnabled, BISON_FEATURE_VERSIONS, versionLt } from './settings';

export function computeBisonDiagnostics(doc: BisonDocument, text: string, settings: ExtensionSettings = DEFAULT_SETTINGS): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const lines = text.split(/\r?\n/);

  // 1. Missing %% separator
  if (doc.separators.length === 0) {
    diagnostics.push({
      severity: DiagnosticSeverity.Error,
      range: Range.create(0, 0, 0, lines[0]?.length || 0),
      message: 'Missing %% separator between declarations and rules sections.',
      source: DC.BISON_MISSING_SEPARATOR.source,
      code:   DC.BISON_MISSING_SEPARATOR.code,
    });
    return diagnostics; // Can't do much more without sections
  }

  // ── TASK 1: Unknown directives ──────────────────────────────────────────────
  for (const unk of doc.unknownDirectives) {
    diagnostics.push({
      severity: DiagnosticSeverity.Error,
      range: unk.location,
      message: `Unknown Bison directive '${unk.name}'. Check the Bison manual for valid directives.`,
      source: DC.BISON_UNKNOWN_DIRECTIVE.source,
      code:   DC.BISON_UNKNOWN_DIRECTIVE.code,
    });
  }

  // 2. Check for tokens used in rules but not declared
  // ALL_CAPS identifiers in rules that are not in %token
  // Build a set of all precedence-declared symbols (e.g. UMINUS declared with %nonassoc).
  // These are legitimate grammar symbols even without a %token declaration.
  const precDeclaredSymbols = new Set<string>();
  for (const prec of doc.precedence) {
    for (const sym of prec.symbols) precDeclaredSymbols.add(sym);
  }

  if (isCheckEnabled(DC.BISON_UNDECLARED_TOKEN.code, settings))
  for (const [name, refs] of doc.ruleReferences) {
    // String-literal placeholders (e.g. __s2b__ for "+") are internal artifacts;
    // they are all lowercase so they fail the all-caps check below, but guard
    // explicitly for clarity.
    if (name.startsWith('__s') && name.endsWith('__')) continue;
    if (/^[A-Z_][A-Z0-9_]+$/.test(name) && !doc.tokens.has(name)) {
      // Tokens declared only via %left/%right/%nonassoc/%precedence are valid
      // grammar symbols even without %token.  They appear in %prec clauses.
      if (precDeclaredSymbols.has(name)) continue;
      // Skip known keywords, special identifiers, and Yacc C-macro names that
      // may appear inside action blocks but look like ALL_CAPS tokens.
      const bisonKeywords = new Set([
        'EOF', 'YYEOF', 'YYUNDEF', 'YYerror',
        // Yacc/Bison error-recovery magic token
        'error',
        // Yacc C macros (should be stripped by the parser's action-block
        // removal, but guard here for resilience)
        'YYERROR', 'YYACCEPT', 'YYABORT',
        'YYRECOVERING', 'YYMAXDEPTH', 'YYINITDEPTH',
        'YYLTYPE', 'YYSTYPE', 'YYLEX_PARAM', 'YYPARSE_PARAM',
      ]);
      if (bisonKeywords.has(name)) continue;

      for (const ref of refs) {
        diagnostics.push({
          severity: DiagnosticSeverity.Warning,
          range: ref,
          message: `Token '${name}' is used but not declared with %token.`,
          source:          DC.BISON_UNDECLARED_TOKEN.source,
          code:            DC.BISON_UNDECLARED_TOKEN.code,
          codeDescription: codeDesc(DC.BISON_UNDECLARED_TOKEN),
        });
      }
    }
  }

  // 5. Non-terminals in %type that are never defined as rule LHS
  if (isCheckEnabled(DC.BISON_MISSING_RULE.code, settings))
  for (const [name, decl] of doc.nonTerminals) {
    if (!doc.rules.has(name)) {
      diagnostics.push({
        severity: DiagnosticSeverity.Warning,
        range: decl.location,
        message: `Non-terminal '${name}' has a %type declaration but no rule definition.`,
        source: DC.BISON_MISSING_RULE.source,
        code:   DC.BISON_MISSING_RULE.code,
      });
    }
  }

  // 6. Rules defined but no %type declaration (only if api.value.type is variant)
  const isVariant = doc.defines.get('api.value.type')?.value === 'variant';
  if (isVariant && isCheckEnabled(DC.BISON_MISSING_TYPE.code, settings)) {
    for (const [name] of doc.rules) {
      if (!doc.nonTerminals.has(name)) {
        const rule = doc.rules.get(name)!;
        diagnostics.push({
          severity: DiagnosticSeverity.Information,
          range: rule.location,
          message: `Rule '${name}' has no %type declaration. With variant types, this may cause compilation errors.`,
          source: DC.BISON_MISSING_TYPE.source,
          code:   DC.BISON_MISSING_TYPE.code,
        });
      }
    }
  }

  // 7. Check for unclosed %{ blocks
  let prologueOpen = false;
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed === '%{') prologueOpen = true;
    if (trimmed === '%}') prologueOpen = false;
  }
  if (prologueOpen) {
    diagnostics.push({
      severity: DiagnosticSeverity.Error,
      range: Range.create(lines.length - 1, 0, lines.length - 1, 0),
      message: 'Unclosed %{ block — missing %} before end of file.',
      source: DC.BISON_UNCLOSED_BLOCK.source,
      code:   DC.BISON_UNCLOSED_BLOCK.code,
    });
  }

  // ── TASK 2: Unused rules (non-terminals never referenced) ───────────────────
  // If %start is not declared, Bison uses the first rule as the implicit start symbol
  const effectiveStart = doc.startSymbol ?? (doc.rules.size > 0 ? [...doc.rules.keys()][0] : undefined);

  if (isCheckEnabled(DC.BISON_UNUSED_RULE.code, settings))
  for (const [name, rule] of doc.rules) {
    // The start symbol is the grammar entry point — always "used"
    if (name === effectiveStart) continue;
    // If this name never appears in any rule body, it is unreachable
    if (!doc.ruleReferences.has(name)) {
      diagnostics.push({
        severity: DiagnosticSeverity.Warning,
        range: rule.location,
        message: `Non-terminal '${name}' is defined but never referenced in any rule. It is unreachable from the grammar.`,
        source: DC.BISON_UNUSED_RULE.source,
        code:   DC.BISON_UNUSED_RULE.code,
        tags:   [DiagnosticTag.Unnecessary],
      });
    }
  }

  // ── TASK 3: Unused tokens ────────────────────────────────────────────────────
  // A token is "used" if its name OR its string alias appears in any rule body.
  // E.g. `%token AND "&"` is used when the rule body contains `"&"`.
  if (isCheckEnabled(DC.BISON_UNUSED_TOKEN.code, settings))
  for (const [name, decl] of doc.tokens) {
    // EOF (value 0) is Bison's internal end-of-input token.  It is consumed
    // automatically by the parser and never appears explicitly in rule bodies.
    if (decl.value === 0 || name === 'EOF' || name === 'YYEOF') continue;
    const usedByName  = doc.ruleReferences.has(name);
    const usedByAlias = decl.alias !== undefined && doc.ruleReferences.has(decl.alias);
    if (!usedByName && !usedByAlias) {
      diagnostics.push({
        severity: DiagnosticSeverity.Warning,
        range: decl.location,
        message: `Token '${name}' is declared with %token but never used in any rule.`,
        source:          DC.BISON_UNUSED_TOKEN.source,
        code:            DC.BISON_UNUSED_TOKEN.code,
        codeDescription: codeDesc(DC.BISON_UNUSED_TOKEN),
        tags:            [DiagnosticTag.Unnecessary],
      });
    }
  }

  // ── TASK 4: Obvious shift/reduce conflicts ───────────────────────────────────
  // guarded inside the block below
  // Heuristic: same terminal token appears as first symbol in ≥2 alternatives
  // of the same rule. Suppressed when:
  //   (a) the token already has %left/%right/%nonassoc, OR
  //   (b) every alternative sharing that first token has a DISTINCT second symbol
  //       (e.g. ID "(" vs ID "{" vs ID "[" — the parser resolves by 1-token
  //       lookahead without any conflict).
  if (isCheckEnabled(DC.BISON_SHIFT_REDUCE.code, settings)) {
    const declaredPrecTokens = new Set<string>();
    for (const prec of doc.precedence) {
      for (const sym of prec.symbols) {
        declaredPrecTokens.add(sym);
      }
    }

    for (const [name, rule] of doc.rules) {
      // Map: first terminal → list of second symbols of those alternatives.
      // `undefined` means the alternative has only 1 symbol (pure reduce).
      const firstToSeconds = new Map<string, Array<string | undefined>>();
      for (const alt of rule.alternatives) {
        const sym = alt.firstSymbol;
        if (sym && /^[A-Z_][A-Z0-9_]*$/.test(sym) && doc.tokens.has(sym)) {
          if (!firstToSeconds.has(sym)) firstToSeconds.set(sym, []);
          firstToSeconds.get(sym)!.push(alt.symbols[1]);
        }
      }

      for (const [token, seconds] of firstToSeconds) {
        if (seconds.length < 2) continue;
        // Suppressed when %left/%right/%nonassoc covers this token
        if (declaredPrecTokens.has(token)) continue;
        // Suppressed when every alt has a DISTINCT non-undefined second symbol:
        // the grammar is unambiguous with 1-token lookahead at position 2.
        const defined = seconds.filter((s): s is string => s !== undefined);
        const allDistinctDefined = defined.length === seconds.length
          && new Set(defined).size === defined.length;
        if (allDistinctDefined) continue;

        diagnostics.push({
          severity: DiagnosticSeverity.Warning,
          range: rule.location,
          message: `Potential shift/reduce conflict in rule '${name}': token '${token}' starts ${seconds.length} alternatives without precedence disambiguation (%prec / %left / %right).`,
          source:          DC.BISON_SHIFT_REDUCE.source,
          code:            DC.BISON_SHIFT_REDUCE.code,
          codeDescription: codeDesc(DC.BISON_SHIFT_REDUCE),
        });
      }
    }
  }

  // ── NEW 1: $n out of bounds ──────────────────────────────────────────────────
  // Covers both single-line actions { ... } and multi-line action blocks.
  // $$ and $<type>n are never matched by the /\$(\d+)/ scanner, so they are safe.
  if (isCheckEnabled(DC.BISON_OUT_OF_BOUNDS.code, settings))
  for (const [name, rule] of doc.rules) {
    for (const alt of rule.alternatives) {
      const symbolCount = alt.symbols.length;
      for (const ref of alt.dollarRefs ?? []) {
        if (symbolCount === 0 && ref.n > 0) {
          diagnostics.push({
            severity: DiagnosticSeverity.Error,
            range: ref.range,
            message: `$${ref.n} is out of bounds: alternative in rule '${name}' has no symbols (empty production).`,
            source:          DC.BISON_OUT_OF_BOUNDS.source,
            code:            DC.BISON_OUT_OF_BOUNDS.code,
            codeDescription: codeDesc(DC.BISON_OUT_OF_BOUNDS),
          });
        } else if (ref.n > symbolCount) {
          diagnostics.push({
            severity: DiagnosticSeverity.Error,
            range: ref.range,
            message: `$${ref.n} is out of bounds: alternative in rule '${name}' has only ${symbolCount} symbol${symbolCount !== 1 ? 's' : ''} ($1–$${symbolCount}).`,
            source:          DC.BISON_OUT_OF_BOUNDS.source,
            code:            DC.BISON_OUT_OF_BOUNDS.code,
            codeDescription: codeDesc(DC.BISON_OUT_OF_BOUNDS),
          });
        }
      }
    }
  }

  // ── NEW 2: Undeclared binary operators — unresolved shift/reduce conflict ────
  // Fires when a rule has ≥2 left-recursive binary alternatives whose operator
  // tokens have NO %left / %right / %nonassoc declaration.
  if (isCheckEnabled(DC.BISON_SHIFT_REDUCE.code, settings)) {
    const tokenPrecLevel = new Map<string, number>();
    for (let i = 0; i < doc.precedence.length; i++) {
      for (const sym of doc.precedence[i].symbols) {
        tokenPrecLevel.set(sym, i);
      }
    }

    for (const [name, rule] of doc.rules) {
      const undeclaredOps: string[] = [];
      for (const alt of rule.alternatives) {
        if (alt.hasPrec) continue;
        const syms = alt.symbols;
        // Require a symmetric binary pattern: name OP... name
        // Both the first AND last symbol must be the rule's own name.
        // This avoids false positives on asymmetric rules like `term TIMES NUMBER`.
        if (syms.length >= 3 && syms[0] === name && syms[syms.length - 1] === name) {
          // Tokens in between are the operator(s)
          for (let k = 1; k < syms.length - 1; k++) {
            const sym = syms[k];
            if (doc.tokens.has(sym) && !tokenPrecLevel.has(sym) && !undeclaredOps.includes(sym)) {
              undeclaredOps.push(sym);
            }
          }
        }
      }
      if (undeclaredOps.length >= 2) {
        diagnostics.push({
          severity: DiagnosticSeverity.Warning,
          range: rule.location,
          message: `Rule '${name}' has recursive alternatives using undeclared operators [${undeclaredOps.join(', ')}]. Add %left/%right/%nonassoc to resolve the shift/reduce conflict explicitly.`,
          source:          DC.BISON_SHIFT_REDUCE.source,
          code:            DC.BISON_SHIFT_REDUCE.code,
          codeDescription: codeDesc(DC.BISON_SHIFT_REDUCE),
        });
      }
    }
  }

  // ── NEW 3: Missing %start directive ─────────────────────────────────────────
  if (!doc.startSymbol && doc.rules.size > 2 && isCheckEnabled(DC.BISON_MISSING_START.code, settings)) {
    const firstRuleName = [...doc.rules.keys()][0];
    diagnostics.push({
      severity: DiagnosticSeverity.Information,
      range: Range.create(0, 0, 0, 0),
      message: `No %start directive found. Bison implicitly uses '${firstRuleName}' as the start symbol. Consider adding '%start ${firstRuleName}' for clarity.`,
      source:          DC.BISON_MISSING_START.source,
      code:            DC.BISON_MISSING_START.code,
      codeDescription: codeDesc(DC.BISON_MISSING_START),
    });
  }

  // ── NEW 4: Empty production without %empty ───────────────────────────────────
  if (isCheckEnabled(DC.BISON_MISSING_EMPTY.code, settings))
  for (const [name, rule] of doc.rules) {
    for (const alt of rule.alternatives) {
      if (alt.symbols.length === 0 && !alt.hasExplicitEmpty) {
        // Guard against false positives on bare "rule :" header lines.
        // The parser now accumulates continuation-line symbols into the phantom
        // alt, so symbols.length === 0 after accumulation means either:
        //   (a) the rule truly has an empty first alternative ("rule:\n| alt"),
        //   (b) or there really is no content yet (unusual edge case).
        // Perform a one-line lookahead: if the next meaningful line starts with
        // something OTHER than '|' or ';', the body has not been appended yet
        // (transient state) and we must not fire.
        const altLine = lines[alt.range.start.line]?.trim() ?? '';
        if (/^[a-zA-Z_][a-zA-Z0-9_.]*\s*:(\s*(\/\/.*)?)?$/.test(altLine)) {
          let nextContent = '';
          for (let ln = alt.range.start.line + 1; ln < lines.length; ln++) {
            const t = lines[ln].trim();
            if (t && !t.startsWith('//') && !t.startsWith('/*')) { nextContent = t; break; }
          }
          // Continuation body found → symbols will be accumulated; not an empty production
          if (!nextContent.startsWith('|') && !nextContent.startsWith(';')) continue;
        }

        diagnostics.push({
          severity: DiagnosticSeverity.Warning,
          range: alt.range,
          message: `Empty production in rule '${name}' without %empty. Modern Bison (3.x+) recommends writing '%empty' to make empty productions explicit.`,
          source:          DC.BISON_MISSING_EMPTY.source,
          code:            DC.BISON_MISSING_EMPTY.code,
          codeDescription: codeDesc(DC.BISON_MISSING_EMPTY),
        });
      }
    }
  }

  // ── NEW 5: %start references a non-existent rule ─────────────────────────────
  if (doc.startSymbol && !doc.rules.has(doc.startSymbol)) {
    diagnostics.push({
      severity: DiagnosticSeverity.Error,
      range: doc.startSymbolLocation ?? Range.create(0, 0, 0, 0),
      message: `%start symbol '${doc.startSymbol}' has no corresponding rule definition.`,
      source:          DC.BISON_UNDEFINED_START.source,
      code:            DC.BISON_UNDEFINED_START.code,
      codeDescription: codeDesc(DC.BISON_UNDEFINED_START),
    });
  }

  // ── NEW 6: %prec used with undeclared token ───────────────────────────────────
  if (isCheckEnabled(DC.BISON_UNDECLARED_TOKEN.code, settings)) {
    const declaredPrecSymbols = new Set<string>();
    for (const prec of doc.precedence) {
      for (const sym of prec.symbols) declaredPrecSymbols.add(sym);
    }
    for (const [name, rule] of doc.rules) {
      for (const alt of rule.alternatives) {
        if (alt.precToken && !declaredPrecSymbols.has(alt.precToken) && !doc.tokens.has(alt.precToken)) {
          diagnostics.push({
            severity: DiagnosticSeverity.Warning,
            range: alt.range,
            message: `%prec uses '${alt.precToken}' in rule '${name}', but '${alt.precToken}' is not declared with %token or a precedence directive.`,
            source:          DC.BISON_UNDECLARED_TOKEN.source,
            code:            DC.BISON_UNDECLARED_TOKEN.code,
            codeDescription: codeDesc(DC.BISON_UNDECLARED_TOKEN),
          });
        }
      }
    }
  }

  // ── NEW 7: Duplicate rule definitions ────────────────────────────────────────
  if (isCheckEnabled(DC.BISON_DUPLICATE_RULE.code, settings))
  for (const dup of doc.duplicateRules) {
    diagnostics.push({
      severity: DiagnosticSeverity.Warning,
      range: dup.location,
      message: `Rule '${dup.name}' is defined more than once. Only the first definition is used by Bison.`,
      source: DC.BISON_DUPLICATE_RULE.source,
      code:   DC.BISON_DUPLICATE_RULE.code,
    });
  }

  // ── NEW 8: Rule with no base case (all alternatives are directly recursive) ──
  if (isCheckEnabled(DC.BISON_INFINITE_RECURSION.code, settings))
  for (const [name, rule] of doc.rules) {
    if (rule.alternatives.length === 0) continue;
    // A base case is an alternative that does NOT contain the rule's own name in symbols.
    const hasBaseCase = rule.alternatives.some(alt => !alt.symbols.includes(name));
    if (!hasBaseCase) {
      diagnostics.push({
        severity: DiagnosticSeverity.Warning,
        range: rule.location,
        message: `Rule '${name}' has no base case: every alternative is directly recursive. This grammar will loop infinitely.`,
        source: DC.BISON_INFINITE_RECURSION.source,
        code:   DC.BISON_INFINITE_RECURSION.code,
      });
    }
  }

  // ── Yacc legacy migration hints ──────────────────────────────────────────
  diagnostics.push(...computeYaccLegacyHints(lines, settings));

  // ── Version compatibility: warn when a feature requires a newer Bison ────────
  if (settings.minVersionBison) {
    for (const { pattern, version, label } of BISON_FEATURE_VERSIONS) {
      if (!versionLt(settings.minVersionBison, version)) continue;
      const declEnd = doc.separators.length > 0 ? doc.separators[0] : lines.length;
      for (let i = 0; i < declEnd; i++) {
        if (pattern.test(lines[i])) {
          const col = lines[i].search(/\S/);
          diagnostics.push({
            severity: DiagnosticSeverity.Warning,
            range: Range.create(i, col >= 0 ? col : 0, i, lines[i].length),
            message: `'${label}' requires Bison ${version}, but your configured minimum is ${settings.minVersionBison}.`,
            source:          DC.BISON_FEATURE_REQUIRES_VERSION.source,
            code:            DC.BISON_FEATURE_REQUIRES_VERSION.code,
            codeDescription: codeDesc(DC.BISON_FEATURE_REQUIRES_VERSION),
          });
          break;
        }
      }
    }
  }

  return diagnostics;
}

/**
 * Scan for Yacc legacy directives / constructs and emit Information-level
 * suggestions pointing to the modern Bison 3.x equivalent.
 *
 * These are tolerated (no error) but flagged so the author can modernise.
 */
function computeYaccLegacyHints(lines: string[], settings: ExtensionSettings): Diagnostic[] {
  if (!isCheckEnabled(DC.BISON_YACC_COMPAT.code, settings)) return [];
  const hints: Diagnostic[] = [];

  // Map of legacy directive regex → modern replacement message
  const migrations: Array<{ re: RegExp; message: string }> = [
    {
      re: /^\s*%(?:pure[_-]parser)\b/,
      message:
        "Yacc legacy '%pure-parser': migrate to '%define api.pure full' (Bison 3.x).",
    },
    {
      re: /^\s*%(?:union)\b/,
      message:
        "Yacc legacy '%union': consider migrating to '%define api.value.type variant' " +
        "with per-token <%type> declarations for type-safe semantic values (Bison 3.x).",
    },
    {
      re: /^\s*%error[_-]verbose\b/,
      message:
        "Yacc legacy '%error-verbose': migrate to '%define parse.error verbose' (Bison 3.x).",
    },
    {
      re: /^\s*%name[_-]prefix\b/,
      message:
        "Yacc legacy '%name-prefix': migrate to '%define api.prefix {prefix}' (Bison 3.x).",
    },
    {
      re: /^\s*%pure_parser\b/,
      message:
        "Yacc legacy '%pure_parser': migrate to '%define api.pure full' (Bison 3.x).",
    },
    {
      re: /^\s*%binary\b/,
      message:
        "Yacc legacy '%binary': use '%nonassoc' instead (standard Bison / POSIX Yacc).",
    },
    // Note: %lex-param and %parse-param are valid Bison 3.x directives (not Yacc legacy).
    // %param is a newer combined form but both forms are fully supported; no migration hint.
  ];

  for (let i = 0; i < lines.length; i++) {
    for (const { re, message } of migrations) {
      if (re.test(lines[i])) {
        const col = lines[i].search(/\S/);
        hints.push({
          severity: DiagnosticSeverity.Information,
          range: Range.create(i, col >= 0 ? col : 0, i, lines[i].length),
          message,
          source: DC.BISON_YACC_COMPAT.source,
          code:   DC.BISON_YACC_COMPAT.code,
          tags: [],
        });
        break; // one hint per line is enough
      }
    }
  }

  // Also warn about YYLEX / YYPARSE function-style prototypes in prologue
  for (let i = 0; i < lines.length; i++) {
    if (/\byylex\s*\(/.test(lines[i]) || /\byyparse\s*\(/.test(lines[i])) {
      hints.push({
        severity: DiagnosticSeverity.Information,
        range: Range.create(i, 0, i, lines[i].length),
        message:
          'Yacc-style yylex/yyparse declarations: consider using %define api.pure full ' +
          'and passing parameters via %lex-param / %parse-param (Bison 3.x).',
        source: DC.BISON_YACC_COMPAT.source,
        code:   DC.BISON_YACC_COMPAT.code,
      });
    }
  }

  return hints;
}

export function computeFlexDiagnostics(doc: FlexDocument, text: string, settings: ExtensionSettings = DEFAULT_SETTINGS): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const lines = text.split(/\r?\n/);

  // 1. Missing %% separator
  if (doc.separators.length === 0) {
    diagnostics.push({
      severity: DiagnosticSeverity.Error,
      range: Range.create(0, 0, 0, lines[0]?.length || 0),
      message: 'Missing %% separator between definitions and rules sections.',
      source: DC.FLEX_MISSING_SEPARATOR.source,
      code:   DC.FLEX_MISSING_SEPARATOR.code,
    });
    return diagnostics;
  }

  // ── TASK 1: Unknown directives ──────────────────────────────────────────────
  for (const unk of doc.unknownDirectives) {
    diagnostics.push({
      severity: DiagnosticSeverity.Error,
      range: unk.location,
      message: `Unknown Flex directive '${unk.name}'. Valid directives are %option, %x, %s, %top, %class.`,
      source: DC.FLEX_UNKNOWN_DIRECTIVE.source,
      code:   DC.FLEX_UNKNOWN_DIRECTIVE.code,
    });
  }

  // 2. Undefined start conditions used in rules
  if (isCheckEnabled(DC.FLEX_UNDEFINED_SC.code, settings))
  for (const [name, refs] of doc.startConditionRefs) {
    if (!doc.startConditions.has(name) && name !== 'INITIAL') {
      for (const ref of refs) {
        diagnostics.push({
          severity: DiagnosticSeverity.Error,
          range: ref,
          message: `Start condition '${name}' is used but not declared with %x or %s.`,
          source: DC.FLEX_UNDEFINED_SC.source,
          code:   DC.FLEX_UNDEFINED_SC.code,
        });
      }
    }
  }

  // 3. Undefined abbreviations used in rules
  if (isCheckEnabled(DC.FLEX_UNDEFINED_ABBREV.code, settings))
  for (const [name, refs] of doc.abbreviationRefs) {
    if (!doc.abbreviations.has(name)) {
      for (const ref of refs) {
        diagnostics.push({
          severity: DiagnosticSeverity.Warning,
          range: ref,
          message: `Abbreviation '{${name}}' is used but not defined in the definitions section.`,
          source: DC.FLEX_UNDEFINED_ABBREV.source,
          code:   DC.FLEX_UNDEFINED_ABBREV.code,
        });
      }
    }
  }

  // 4. Declared start conditions never used
  if (isCheckEnabled(DC.FLEX_UNUSED_SC.code, settings))
  for (const [name, decl] of doc.startConditions) {
    if (!doc.startConditionRefs.has(name)) {
      diagnostics.push({
        severity: DiagnosticSeverity.Information,
        range: decl.location,
        message: `Start condition '${name}' is declared but never used in any rule.`,
        source: DC.FLEX_UNUSED_SC.source,
        code:   DC.FLEX_UNUSED_SC.code,
        tags:   [DiagnosticTag.Unnecessary],
      });
    }
  }

  // 5. Declared abbreviations never used
  if (isCheckEnabled(DC.FLEX_UNUSED_ABBREV.code, settings))
  for (const [name, abbr] of doc.abbreviations) {
    if (!doc.abbreviationRefs.has(name)) {
      diagnostics.push({
        severity: DiagnosticSeverity.Information,
        range: abbr.location,
        message: `Abbreviation '${name}' is defined but never used in any rule pattern.`,
        source: DC.FLEX_UNUSED_ABBREV.source,
        code:   DC.FLEX_UNUSED_ABBREV.code,
        tags:   [DiagnosticTag.Unnecessary],
      });
    }
  }

  // 6. Check for unclosed %{ blocks
  let prologueOpen = false;
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (trimmed === '%{') prologueOpen = true;
    if (trimmed === '%}') prologueOpen = false;
  }
  if (prologueOpen) {
    diagnostics.push({
      severity: DiagnosticSeverity.Error,
      range: Range.create(lines.length - 1, 0, lines.length - 1, 0),
      message: 'Unclosed %{ block — missing %} before end of file.',
      source: DC.FLEX_UNCLOSED_BLOCK.source,
      code:   DC.FLEX_UNCLOSED_BLOCK.code,
    });
  }

  // ── TASK 5: Inaccessible Flex rules ─────────────────────────────────────────
  // Heuristic A: Exact duplicate pattern → second one is always shadowed.
  // Heuristic B: Catch-all pattern (. or .* or .*\n etc.) before specific patterns
  //              in the same start-condition context → subsequent rules unreachable.

  // Build a canonical "context key" for a rule: sorted start conditions, or "INITIAL"
  const contextKey = (rule: typeof doc.rules[0]): string =>
    rule.startConditions.length > 0 ? [...rule.startConditions].sort().join(',') : 'INITIAL';

  /**
   * Extract just the regex part of a Flex rule pattern string.
   * doc.rules[].pattern is the full trimmed line: "<SC> pattern   { action }"
   * We strip the optional <SC> prefix, then take the first non-space token (the regex).
   * In Flex, patterns cannot contain unescaped spaces, so the pattern ends at
   * the first whitespace after the regex.
   */
  const rawPattern = (pattern: string): string => {
    // Remove optional <SC> or <SC1,SC2> prefix (SC names may be upper or lower case; * is the wildcard)
    let p = pattern.replace(/^<[A-Za-z_*][A-Za-z0-9_,*]*>\s*/, '').trimStart();
    // Extract the pattern token, tracking [] bracket depth and "..." quoted strings
    // so spaces inside character classes (e.g. "[ \t\n]") or quoted literals
    // (e.g. "hello world") are included, not treated as delimiters.
    // Backslash-escape handling: \X consumes both chars as a unit.
    let result = '';
    let depth = 0;
    let inQuote = false;
    for (let i = 0; i < p.length; i++) {
      const ch = p[i];
      if (ch === '\\') {
        // Escaped char: consume both as-is (e.g. "\[" or "\\" or "\"")
        result += ch + (p[i + 1] ?? '');
        i++;
        continue;
      }
      if (ch === '"' && !inQuote && depth === 0) { inQuote = true;  result += ch; continue; }
      if (ch === '"' && inQuote)                  { inQuote = false; result += ch; continue; }
      if (ch === '[' && !inQuote) { depth++; result += ch; continue; }
      if (ch === ']' && depth > 0 && !inQuote) { depth--; result += ch; continue; }
      if ((ch === ' ' || ch === '\t') && depth === 0 && !inQuote) break;
      result += ch;
    }
    return result || p;
  };

  // Catch-all patterns that would shadow everything after them
  const CATCHALL_PATTERNS = new Set(['.', '.*', '.+', '.|\\n', '(.|\\n)*', '(.|\\n)+']);

  // Track: first seen pattern per context (for duplicate detection)
  const seenPatterns = new Map<string, number>(); // "context|pattern" -> line number of first occurrence

  // Track: catch-all line per context key
  const catchallLine = new Map<string, number>(); // context -> line number

  if (isCheckEnabled(DC.FLEX_UNREACHABLE_RULE.code, settings))
  for (const rule of doc.rules) {
    const ctx = contextKey(rule);
    const pat = rawPattern(rule.pattern);
    const lineNum = rule.location.start.line;
    const dupKey = `${ctx}|${pat}`;

    // Heuristic B: is this rule after a catch-all in the same context?
    // <<EOF>> is never shadowed by a regular catch-all (`.` doesn't match EOF).
    if (catchallLine.has(ctx) && !CATCHALL_PATTERNS.has(pat) && pat !== '<<EOF>>') {
      const catchLine = catchallLine.get(ctx)!;
      diagnostics.push({
        severity: DiagnosticSeverity.Warning,
        range: rule.location,
        message: `Flex rule '${pat}' may be inaccessible: catch-all pattern at line ${catchLine + 1} will always match first.`,
        source: DC.FLEX_UNREACHABLE_RULE.source,
        code:   DC.FLEX_UNREACHABLE_RULE.code,
      });
    }

    // Heuristic A: duplicate pattern in same context?
    if (seenPatterns.has(dupKey)) {
      const firstLine = seenPatterns.get(dupKey)!;
      diagnostics.push({
        severity: DiagnosticSeverity.Warning,
        range: rule.location,
        message: `Flex rule '${pat}' is inaccessible: identical pattern already defined at line ${firstLine + 1}.`,
        source: DC.FLEX_UNREACHABLE_RULE.source,
        code:   DC.FLEX_UNREACHABLE_RULE.code,
      });
    } else {
      seenPatterns.set(dupKey, lineNum);
    }

    // Register catch-all (only on first occurrence in this context)
    if (CATCHALL_PATTERNS.has(pat) && !catchallLine.has(ctx)) {
      catchallLine.set(ctx, lineNum);
    }
  }

  // ── NEW 5: Invalid regex patterns ────────────────────────────────────────────
  if (isCheckEnabled(DC.FLEX_INVALID_PATTERN.code, settings))
  for (const rule of doc.rules) {
    const pat = rawPattern(rule.pattern);
    // Skip special/trivial patterns that we know are valid
    if (!pat || pat === '.' || pat === '<<EOF>>' || pat === '.*' || pat === '.+') continue;
    const err = validateFlexRegex(pat);
    if (err) {
      diagnostics.push({
        severity: DiagnosticSeverity.Error,
        range: rule.location,
        message: `Invalid regex pattern '${pat}': ${err}.`,
        source: DC.FLEX_INVALID_PATTERN.source,
        code:   DC.FLEX_INVALID_PATTERN.code,
      });
    }
  }

  // ── NEW 6: Keyword shadowed by a general identifier pattern ──────────────────
  // In Flex, longest match wins; for equal-length matches the FIRST rule wins.
  // If an identifier-like pattern appears before a literal keyword in the same
  // start-condition context, the keyword rule can never match.
  if (isCheckEnabled(DC.FLEX_UNREACHABLE_RULE.code, settings)) {
    const rulesByContext = new Map<string, Array<{ rule: typeof doc.rules[0]; pat: string }>>();
    for (const rule of doc.rules) {
      const ctx = contextKey(rule);
      const pat = rawPattern(rule.pattern);
      if (!rulesByContext.has(ctx)) rulesByContext.set(ctx, []);
      rulesByContext.get(ctx)!.push({ rule, pat });
    }

    for (const [, entries] of rulesByContext) {
      // Collect indices of word-like patterns and literal-keyword patterns
      const wordPatternIdxs: number[] = [];
      const literalEntries: Array<{ idx: number; word: string }> = [];

      for (let i = 0; i < entries.length; i++) {
        const { pat } = entries[i];
        const lit = getLiteralKeyword(pat);
        if (lit) {
          literalEntries.push({ idx: i, word: lit });
        } else if (isWordPattern(pat)) {
          wordPatternIdxs.push(i);
        }
      }

      // Warn when a word pattern precedes a literal keyword in the same context
      for (const wordIdx of wordPatternIdxs) {
        for (const { idx: litIdx, word } of literalEntries) {
          if (wordIdx < litIdx) {
            const wordPat = entries[wordIdx].pat;
            diagnostics.push({
              severity: DiagnosticSeverity.Warning,
              range: entries[litIdx].rule.location,
              message: `Flex rule '${word}': this keyword may be shadowed by the more general pattern '${wordPat}' at line ${entries[wordIdx].rule.location.start.line + 1}. Place keyword rules before identifier patterns.`,
              source: DC.FLEX_UNREACHABLE_RULE.source,
              code:   DC.FLEX_UNREACHABLE_RULE.code,
            });
          }
        }
      }
    }
  }

  // ── NEW 8: Multiple <<EOF>> rules for the same start condition ───────────────
  if (isCheckEnabled(DC.FLEX_DUPLICATE_EOF.code, settings)) {
    const eofContexts = new Map<string, number>(); // context -> first line
    for (const rule of doc.rules) {
      const pat = rawPattern(rule.pattern);
      if (pat === '<<EOF>>') {
        const ctx = contextKey(rule);
        if (eofContexts.has(ctx)) {
          diagnostics.push({
            severity: DiagnosticSeverity.Warning,
            range: rule.location,
            message: `Duplicate <<EOF>> rule for context '${ctx}': first defined at line ${eofContexts.get(ctx)! + 1}. Only the first one will be used.`,
            source: DC.FLEX_DUPLICATE_EOF.source,
            code:   DC.FLEX_DUPLICATE_EOF.code,
          });
        } else {
          eofContexts.set(ctx, rule.location.start.line);
        }
      }
    }
  }

  // ── NEW 9: %option stack declared but stack functions never used ──────────────
  if (doc.options.has('stack') && isCheckEnabled(DC.FLEX_UNUSED_OPTION.code, settings)) {
    const stackUsed = text.includes('yy_push_state') || text.includes('yy_pop_state') || text.includes('yy_top_state');
    if (!stackUsed) {
      diagnostics.push({
        severity: DiagnosticSeverity.Warning,
        range: doc.options.get('stack')!.location,
        message: '%option stack is declared but yy_push_state/yy_pop_state are never called. Remove this option if the state stack is not needed.',
        source: DC.FLEX_UNUSED_OPTION.source,
        code:   DC.FLEX_UNUSED_OPTION.code,
      });
    }
  }

  // ── NEW 7: Missing %option noyywrap ─────────────────────────────────────────
  // Skip this check for RE-flex files: RE-flex handles end-of-file through the
  // scanner base class and doesn't require noyywrap.  Detect RE-flex by the
  // presence of RE-flex-specific options (bison-complete, bison-cc-parser,
  // namespace, lexer) or by an explicit %option yywrap.
  const isReflex = doc.options.has('bison-complete') || doc.options.has('bison-cc-parser')
    || doc.options.has('bison-locations') || doc.options.has('namespace')
    || doc.options.has('lexer') || doc.options.has('unicode') || doc.options.has('yywrap');
  if (!isReflex && !doc.options.has('noyywrap') && isCheckEnabled(DC.FLEX_MISSING_YYWRAP.code, settings)) {
    const hasYywrap = text.includes('yywrap');
    if (!hasYywrap) {
      diagnostics.push({
        severity: DiagnosticSeverity.Warning,
        range: Range.create(0, 0, 0, lines[0]?.length ?? 0),
        message: 'Missing %option noyywrap and no yywrap() function defined. Add "%option noyywrap" to prevent linker errors, or define int yywrap(void) { return 1; }.',
        source: DC.FLEX_MISSING_YYWRAP.source,
        code:   DC.FLEX_MISSING_YYWRAP.code,
      });
    }
  }

  return diagnostics;
}

// ── Helpers for Flex diagnostics ────────────────────────────────────────────

/**
 * Try to validate a Flex regex pattern by converting Flex-specific constructs
 * to JS equivalents and calling new RegExp().
 * Returns an error message string on failure, or null on success.
 */
function validateFlexRegex(pat: string): string | null {
  // Convert Flex-specific syntax → approximate JS regex
  let p = pat
    .replace(/\{[a-zA-Z_][a-zA-Z0-9_]*\}/g, 'x')           // {abbr} → placeholder
    .replace(/"((?:[^"\\]|\\.)*)"/g, (_, s) =>                 // "str" → escaped literal (handles \" inside)
      s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .replace(/\[:(alpha|upper|lower):\]/g, 'a-zA-Z')         // POSIX classes (inside [...])
    .replace(/\[:digit:\]/g, '0-9')
    .replace(/\[:alnum:\]/g, 'a-zA-Z0-9')
    .replace(/\[:space:\]/g, ' \\t\\n\\r')
    .replace(/\[:word:\]/g, 'a-zA-Z0-9_')
    .replace(/\[:print:\]/g, '\\x20-\\x7E');
  try {
    new RegExp(p);
    return null;
  } catch (e: any) {
    return e.message ?? 'syntax error';
  }
}

/**
 * If `pat` is a bare literal word (only letters/digits/underscore) or a
 * double-quoted word, return the word string; otherwise return null.
 */
function getLiteralKeyword(pat: string): string | null {
  if (/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(pat)) return pat;
  const m = pat.match(/^"([a-zA-Z_][a-zA-Z0-9_]*)"$/);
  return m ? m[1] : null;
}

/**
 * Return true if this pattern looks like a "general word / identifier" matcher,
 * i.e., could match arbitrary letter sequences including keywords.
 */
function isWordPattern(pat: string): boolean {
  // Only patterns that are purely sequences of character-class groups (e.g., [A-Z_]+ or
  // [a-z][a-z0-9]*) count as "word patterns" that can shadow keyword literals.
  // Patterns with mandatory non-class components — such as [A-Z]+(\.[A-Z]+)+ which
  // requires a literal dot — cannot match simple keyword strings and must be excluded.
  if (/^\[[a-zA-Z_]/.test(pat) && /^(\[(?:[^\]\\]|\\.)*\][+*?]?)+$/.test(pat)) return true;
  // POSIX character-class expressions that match letter sequences: [[:alpha:]], [[:alnum:]], etc.
  if (/^\[\[:(alpha|upper|lower|alnum|word):\]\][+*?]*$/.test(pat)) return true;
  // Common abbreviation references for identifiers
  if (/^\{(id|identifier|ident|IDENT|word|alpha)\}$/.test(pat)) return true;
  return false;
}
