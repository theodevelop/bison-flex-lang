import { CodeLens, Range, Command } from 'vscode-languageserver';
import { DocumentModel, BisonDocument, FlexDocument, isBisonDocument } from '../parser/types';

/**
 * Code Lenses:
 *   Bison rules        → "N references"  +  "⬤ entry point" (start symbol only)
 *   Flex SC decls      → "N references"
 *   Flex abbreviations → "N references"
 *
 * The "N references" lens triggers `bisonFlex.showReferences` (registered
 * client-side) which calls `editor.action.showReferences` with pre-built args.
 */
export function getCodeLenses(doc: DocumentModel, uri: string): CodeLens[] {
  if (isBisonDocument(doc)) {
    return getBisonCodeLenses(doc, uri);
  }
  return getFlexCodeLenses(doc as FlexDocument, uri);
}

// ── Bison ────────────────────────────────────────────────────────────────────

function getBisonCodeLenses(doc: BisonDocument, uri: string): CodeLens[] {
  const lenses: CodeLens[] = [];
  const startSymbol = doc.startSymbol ?? [...doc.rules.keys()][0];

  for (const [name, rule] of doc.rules) {
    const line = rule.location.start.line;
    const lensRange = Range.create(line, 0, line, 0);
    const refCount = doc.ruleReferences.get(name)?.length ?? 0;

    // "N references" — clickable, triggers showReferences on client side
    lenses.push({
      range: lensRange,
      command: Command.create(
        `$(references) ${refCount} reference${refCount !== 1 ? 's' : ''}`,
        'bisonFlex.showReferences',
        uri,
        { line, character: rule.location.start.character },
      ),
    });

    // "entry point" indicator — informational, no-op command
    if (name === startSymbol) {
      lenses.push({
        range: lensRange,
        command: Command.create('$(play-circle) entry point', 'bisonFlex.noOp'),
      });
    }
  }

  return lenses;
}

// ── Flex ─────────────────────────────────────────────────────────────────────

function getFlexCodeLenses(doc: FlexDocument, uri: string): CodeLens[] {
  const lenses: CodeLens[] = [];

  for (const [name, sc] of doc.startConditions) {
    const line = sc.location.start.line;
    const lensRange = Range.create(line, 0, line, 0);
    const refCount = doc.startConditionRefs.get(name)?.length ?? 0;

    lenses.push({
      range: lensRange,
      command: Command.create(
        `$(references) ${refCount} reference${refCount !== 1 ? 's' : ''}`,
        'bisonFlex.showReferences',
        uri,
        { line, character: sc.location.start.character },
      ),
    });
  }

  for (const [name, abbr] of doc.abbreviations) {
    const line = abbr.location.start.line;
    const lensRange = Range.create(line, 0, line, 0);
    const refCount = doc.abbreviationRefs.get(name)?.length ?? 0;

    lenses.push({
      range: lensRange,
      command: Command.create(
        `$(references) ${refCount} reference${refCount !== 1 ? 's' : ''}`,
        'bisonFlex.showReferences',
        uri,
        { line, character: abbr.location.start.character },
      ),
    });
  }

  return lenses;
}
