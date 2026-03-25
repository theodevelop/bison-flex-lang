import {
  Diagnostic,
  DiagnosticSeverity,
  DiagnosticRelatedInformation,
  Range,
  Location,
} from 'vscode-languageserver';
import { BisonDocument, FlexDocument } from '../parser/types';
import { DC } from './diagnosticCodes';

/**
 * Cross-file token synchronization between Bison (.y) and Flex (.l) files.
 *
 * Detects:
 * - Tokens declared in .y but never returned in the companion .l
 * - Tokens returned in .l but never declared in the companion .y
 */

/**
 * Extract token names returned in Flex action blocks: `return TOKEN_NAME;`
 * Returns a Map of token name → line ranges where it's returned.
 */
export function extractReturnedTokens(flexText: string): Map<string, Range[]> {
  const returned = new Map<string, Range[]>();
  const lines = flexText.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Match: return TOKEN_NAME; or return(TOKEN_NAME); or return token::TOKEN_NAME;
    // Token names are ALL_CAPS identifiers
    const matches = line.matchAll(/\breturn\s*\(?\s*(?:[a-zA-Z_][a-zA-Z0-9_]*::)?([A-Z_][A-Z0-9_]+)\s*\)?\s*;/g);
    for (const m of matches) {
      const name = m[1];
      const col = m.index! + m[0].indexOf(name);
      const range = Range.create(i, col, i, col + name.length);
      if (!returned.has(name)) {
        returned.set(name, []);
      }
      returned.get(name)!.push(range);
    }
  }

  return returned;
}

/**
 * Compute cross-file diagnostics for a Bison file against its companion Flex file.
 * Reports tokens declared in .y but never returned in .l.
 */
export function computeBisonCrossFileDiagnostics(
  bisonDoc: BisonDocument,
  flexText: string,
  flexUri: string,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const returnedTokens = extractReturnedTokens(flexText);

  // Tokens known to be internal / not returned by the lexer
  const skipTokens = new Set(['EOF', 'YYEOF', 'YYUNDEF', 'YYerror', 'error']);

  for (const [name, decl] of bisonDoc.tokens) {
    if (skipTokens.has(name)) continue;

    if (!returnedTokens.has(name)) {
      const diag: Diagnostic = {
        severity: DiagnosticSeverity.Warning,
        range: decl.location,
        message: `Token '${name}' is declared but never returned in the companion lexer file.`,
        source: DC.BISON_MISSING_LEXER_RETURN.source,
        code:   DC.BISON_MISSING_LEXER_RETURN.code,
      };

      // Add related information pointing to the flex file
      diag.relatedInformation = [
        DiagnosticRelatedInformation.create(
          Location.create(flexUri, Range.create(0, 0, 0, 0)),
          `No 'return ${name};' found in this lexer file.`
        ),
      ];

      diagnostics.push(diag);
    }
  }

  return diagnostics;
}

/**
 * Compute cross-file diagnostics for a Flex file against its companion Bison file.
 * Reports tokens returned in .l but never declared in .y.
 */
export function computeFlexCrossFileDiagnostics(
  flexText: string,
  bisonDoc: BisonDocument,
  bisonUri: string,
): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const returnedTokens = extractReturnedTokens(flexText);

  const skipTokens = new Set(['EOF', 'YYEOF', 'YYUNDEF', 'YYerror', 'error']);

  for (const [name, ranges] of returnedTokens) {
    if (skipTokens.has(name)) continue;

    if (!bisonDoc.tokens.has(name)) {
      for (const ref of ranges) {
        const diag: Diagnostic = {
          severity: DiagnosticSeverity.Warning,
          range: ref,
          message: `Token '${name}' is returned but not declared with %token in the companion grammar file.`,
          source: DC.FLEX_MISSING_GRAMMAR_TOKEN.source,
          code:   DC.FLEX_MISSING_GRAMMAR_TOKEN.code,
        };

        diag.relatedInformation = [
          DiagnosticRelatedInformation.create(
            Location.create(bisonUri, Range.create(0, 0, 0, 0)),
            `No '%token ${name}' declaration found in this grammar file.`
          ),
        ];

        diagnostics.push(diag);
      }
    }
  }

  return diagnostics;
}
