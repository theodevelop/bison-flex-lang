/**
 * Central registry of all diagnostic codes emitted by the Bison/Flex LSP server.
 *
 * Each entry carries:
 *   code   – the string shown in the VS Code Problems "Code" column
 *   source – the diagnostic source / owner
 *   href   – (optional) link to GNU documentation shown as "Code (link)" in Problems
 */

interface EntryWithHref {
  readonly code: string;
  readonly source: string;
  readonly href: string;
}

interface EntryNoHref {
  readonly code: string;
  readonly source: string;
}

export type DiagEntry = EntryWithHref | EntryNoHref;

// ── Registry ──────────────────────────────────────────────────────────────────

export const DC = {

  // ── Bison: structural ────────────────────────────────────────────────────────
  BISON_MISSING_SEPARATOR:    { code: 'bison/missing-separator',    source: 'bison' },
  BISON_UNKNOWN_DIRECTIVE:    { code: 'bison/unknown-directive',    source: 'bison' },
  BISON_UNCLOSED_BLOCK:       { code: 'bison/unclosed-block',       source: 'bison' },
  BISON_DUPLICATE_RULE:       { code: 'bison/duplicate-rule',       source: 'bison' },
  BISON_INFINITE_RECURSION:   { code: 'bison/infinite-recursion',   source: 'bison' },

  // ── Bison: tokens ────────────────────────────────────────────────────────────
  BISON_UNDECLARED_TOKEN: {
    code: 'bison/undeclared-token',
    source: 'bison',
    href: 'https://www.gnu.org/software/bison/manual/html_node/Token-Decl.html',
  },
  BISON_UNUSED_TOKEN: {
    code: 'bison/unused-token',
    source: 'bison',
    href: 'https://www.gnu.org/software/bison/manual/html_node/Token-Decl.html',
  },

  // ── Bison: rules ─────────────────────────────────────────────────────────────
  BISON_UNUSED_RULE:          { code: 'bison/unused-rule',          source: 'bison' },
  BISON_MISSING_RULE:         { code: 'bison/missing-rule',         source: 'bison' },
  BISON_MISSING_TYPE:         { code: 'bison/missing-type',         source: 'bison' },
  BISON_MISSING_EMPTY: {
    code: 'bison/missing-empty',
    source: 'bison',
    href: 'https://www.gnu.org/software/bison/manual/html_node/Empty-Rules.html',
  },
  BISON_MISSING_START: {
    code: 'bison/missing-start',
    source: 'bison',
    href: 'https://www.gnu.org/software/bison/manual/html_node/Start-Decl.html',
  },
  BISON_UNDEFINED_START: {
    code: 'bison/undefined-start',
    source: 'bison',
    href: 'https://www.gnu.org/software/bison/manual/html_node/Start-Decl.html',
  },

  // ── Bison: conflicts ─────────────────────────────────────────────────────────
  BISON_SHIFT_REDUCE: {
    code: 'bison/shift-reduce',
    source: 'bison',
    href: 'https://www.gnu.org/software/bison/manual/html_node/Shift_002fReduce.html',
  },
  BISON_OUT_OF_BOUNDS: {
    code: 'bison/out-of-bounds',
    source: 'bison',
    href: 'https://www.gnu.org/software/bison/manual/html_node/Actions.html',
  },

  // ── Bison: cross-file ────────────────────────────────────────────────────────
  BISON_MISSING_LEXER_RETURN: { code: 'bison/missing-lexer-return', source: 'bison' },

  // ── Yacc compatibility ───────────────────────────────────────────────────────
  BISON_YACC_COMPAT: { code: 'bison/yacc-compat', source: 'bison-yacc-compat' },

  // ── Flex: structural ─────────────────────────────────────────────────────────
  FLEX_MISSING_SEPARATOR:    { code: 'flex/missing-separator',    source: 'flex' },
  FLEX_UNKNOWN_DIRECTIVE:    { code: 'flex/unknown-directive',    source: 'flex' },
  FLEX_UNCLOSED_BLOCK:       { code: 'flex/unclosed-block',       source: 'flex' },
  FLEX_INVALID_PATTERN:      { code: 'flex/invalid-pattern',      source: 'flex' },
  FLEX_DUPLICATE_EOF:        { code: 'flex/duplicate-eof',        source: 'flex' },

  // ── Flex: start conditions ───────────────────────────────────────────────────
  FLEX_UNDEFINED_SC: { code: 'flex/undefined-sc', source: 'flex' },
  FLEX_UNUSED_SC:    { code: 'flex/unused-sc',    source: 'flex' },

  // ── Flex: abbreviations ──────────────────────────────────────────────────────
  FLEX_UNDEFINED_ABBREV: { code: 'flex/undefined-abbrev', source: 'flex' },
  FLEX_UNUSED_ABBREV:    { code: 'flex/unused-abbrev',    source: 'flex' },

  // ── Flex: rules ──────────────────────────────────────────────────────────────
  FLEX_UNREACHABLE_RULE: { code: 'flex/unreachable-rule', source: 'flex' },
  FLEX_UNUSED_OPTION:    { code: 'flex/unused-option',    source: 'flex' },
  FLEX_MISSING_YYWRAP:   { code: 'flex/missing-yywrap',   source: 'flex' },

  // ── Flex: cross-file ─────────────────────────────────────────────────────────
  FLEX_MISSING_GRAMMAR_TOKEN: { code: 'flex/missing-grammar-token', source: 'flex' },

} as const;

export type DC = typeof DC;

/**
 * Typed accessor — returns the registry entry for a given key.
 * Useful in tests to avoid string-indexing `DC` directly.
 */
export function diagEntry<K extends keyof DC>(key: K): DC[K] {
  return DC[key];
}

/**
 * Build the `codeDescription` object for a diagnostic entry.
 * Returns `undefined` when no `href` is defined, so callers can spread it safely.
 */
export function codeDesc(entry: DiagEntry): { href: string } | undefined {
  return 'href' in entry ? { href: entry.href } : undefined;
}
