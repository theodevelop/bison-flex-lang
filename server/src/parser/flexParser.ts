import { Range } from 'vscode-languageserver';
import {
  FlexDocument,
  FlexOption,
  StartCondition,
  Abbreviation,
  FlexRule,
} from './types';

/**
 * All directives recognized by Flex / RE-flex.
 * Anything starting with % that isn't in this set → unknown directive diagnostic.
 */
const KNOWN_FLEX_DIRECTIVES = new Set([
  // Standard Flex directives
  'option', 'x', 's',
  'pointer', 'array',       // old Flex memory model
  // RE-flex block directives (content is treated as embedded C++)
  'top', 'class',
  // RE-flex standalone directives (equivalents of %option name=value)
  'namespace',              // %namespace foo  →  %option namespace=foo
  'lexer',                  // %lexer ClassName
  'lex',                    // %lex name
  'exception',              // %exception type
  'flex',                   // %flex (enable Flex compatibility)
  'graphs-file',            // %graphs-file
  'header-file',            // %header-file "name"
  'regexp-file',            // %regexp-file
  'tabs',                   // %tabs n
  'unicode',                // %unicode
  'yywrap',                 // %yywrap (use yywrap() callback)
]);

/**
 * Code block types in Flex/RE-flex files:
 * - %{ ... %}    prologue block
 * - %top{ ... %} RE-flex top block (closes with %})
 * - %class{ ... } RE-flex class block (closes with } at indent 0)
 */
type CodeBlockState = 'none' | 'prologue' | 'top' | 'class';

function skipCodeBlocks(lines: string[]): boolean[] {
  // Returns a boolean array: true = line is inside a code block (skip it)
  const skip = new Array<boolean>(lines.length).fill(false);
  let state: CodeBlockState = 'none';
  let classBraceDepth = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    switch (state) {
      case 'none':
        // Check for block openers
        if (trimmed === '%{') {
          state = 'prologue';
          skip[i] = true;
        } else if (/^%top\s*\{/.test(trimmed)) {
          state = 'top';
          skip[i] = true;
        } else if (/^%class\s*\{/.test(trimmed)) {
          state = 'class';
          classBraceDepth = 1;
          // Count additional braces on opening line
          for (let j = trimmed.indexOf('{') + 1; j < trimmed.length; j++) {
            if (trimmed[j] === '{') classBraceDepth++;
            if (trimmed[j] === '}') classBraceDepth--;
          }
          skip[i] = true;
          if (classBraceDepth <= 0) state = 'none';
        }
        break;

      case 'prologue':
        skip[i] = true;
        if (trimmed === '%}') state = 'none';
        break;

      case 'top':
        skip[i] = true;
        // %top{ blocks close with %} in RE-flex
        if (trimmed === '%}' || trimmed === '}') state = 'none';
        break;

      case 'class':
        skip[i] = true;
        for (const ch of line) {
          if (ch === '{') classBraceDepth++;
          if (ch === '}') classBraceDepth--;
        }
        if (classBraceDepth <= 0) state = 'none';
        break;
    }
  }
  return skip;
}

export function parseFlexDocument(text: string): FlexDocument {
  const lines = text.split(/\r?\n/);
  const doc: FlexDocument = {
    options: new Map(),
    startConditions: new Map(),
    abbreviations: new Map(),
    codeBlocks: [],
    rules: [],
    separators: [],
    startConditionRefs: new Map(),
    abbreviationRefs: new Map(),
    unknownDirectives: [],
  };

  // Build skip map for code blocks
  const skip = skipCodeBlocks(lines);

  // Phase 1: Find %% separators
  for (let i = 0; i < lines.length; i++) {
    if (skip[i]) continue;
    const trimmed = lines[i].trim();
    if (trimmed === '%%') {
      doc.separators.push(i);
    }
  }

  const definitionsEnd = doc.separators.length > 0 ? doc.separators[0] : lines.length;
  const rulesStart = doc.separators.length > 0 ? doc.separators[0] + 1 : lines.length;
  const rulesEnd = doc.separators.length > 1 ? doc.separators[1] : lines.length;

  // Phase 2: Parse definitions section
  let inBlockComment = false;

  for (let i = 0; i < definitionsEnd; i++) {
    if (skip[i]) continue;
    const line = lines[i];
    const trimmed = line.trim();

    // Track block comments
    if (inBlockComment) {
      if (trimmed.includes('*/')) inBlockComment = false;
      continue;
    }
    if (trimmed.startsWith('/*')) {
      if (!trimmed.includes('*/')) inBlockComment = true;
      continue;
    }

    // Skip line comments
    if (trimmed.startsWith('//')) continue;

    // Skip empty lines
    if (!trimmed) continue;

    // %option directives
    const optionMatch = trimmed.match(/^%option\s+(.+)/);
    if (optionMatch) {
      parseOptions(optionMatch[1], i, line, doc);
      continue;
    }

    // %x exclusive start conditions
    const exclusiveMatch = trimmed.match(/^%x\s+(.+)/);
    if (exclusiveMatch) {
      parseStartConditions(exclusiveMatch[1], true, i, line, doc);
      continue;
    }

    // %s inclusive start conditions
    const inclusiveMatch = trimmed.match(/^%s\s+(.+)/);
    if (inclusiveMatch) {
      parseStartConditions(inclusiveMatch[1], false, i, line, doc);
      continue;
    }

    // Abbreviation definitions: name followed by whitespace then pattern
    // Must start at column 0 with a letter/underscore
    // Use flexible whitespace (tabs or 2+ spaces) between name and pattern
    const abbrMatch = line.match(/^([a-zA-Z_][a-zA-Z0-9_]*)(?:\t+|\s{2,})(\S.*)$/);
    if (abbrMatch && !abbrMatch[1].startsWith('%')) {
      const name = abbrMatch[1];
      const pattern = abbrMatch[2].trim();
      doc.abbreviations.set(name, {
        name,
        pattern,
        location: Range.create(i, 0, i, name.length),
      });
      continue;
    }

    // Unknown directive: any %word that didn't match a known pattern above
    if (trimmed.startsWith('%') && !trimmed.startsWith('%%') && !trimmed.startsWith('%{') && !trimmed.startsWith('%}')) {
      const directiveMatch = trimmed.match(/^%([a-zA-Z][a-zA-Z0-9_-]*)/);
      if (directiveMatch && !KNOWN_FLEX_DIRECTIVES.has(directiveMatch[1])) {
        doc.unknownDirectives.push({
          name: '%' + directiveMatch[1],
          location: Range.create(i, 0, i, directiveMatch[0].length),
        });
      }
    }
  }

  // Phase 3: Parse rules section
  //
  // Two separate depth counters are needed:
  //   actionDepth  — depth of C action blocks ({ ... }); content is skipped
  //   scBlockStack — stack of start-condition lists for <SC>{...} blocks;
  //                  rules INSIDE these blocks inherit the SC names.
  //
  // A <SC>{...} block is NOT an action block: its content is Flex rules.
  // Action blocks nested inside a <SC> block increment actionDepth as usual.
  let actionDepth = 0;
  const scBlockStack: string[][] = [];   // each entry = SC list for one nesting level
  let pendingScHeader: string | null = null; // accumulates multi-line <SC1,\nSC2>{ headers
  inBlockComment = false;

  for (let i = rulesStart; i < rulesEnd; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // Track block comments
    if (inBlockComment) {
      if (trimmed.includes('*/')) inBlockComment = false;
      continue;
    }
    if (trimmed.startsWith('/*')) {
      if (!trimmed.includes('*/')) inBlockComment = true;
      continue; // skip both single-line /* ... */ and multi-line start
    }

    // Skip empty lines and line comments
    if (!trimmed || trimmed.startsWith('//')) continue;

    // ── Handle multi-line <SC1,\nSC2>{ header continuation ────────────────────
    if (pendingScHeader !== null) {
      const closeIdx = trimmed.indexOf('>');
      if (closeIdx >= 0) {
        // Collect any additional SC names before the >
        const before = trimmed.substring(0, closeIdx);
        const moreConds = before.match(/[A-Z_][A-Z0-9_]*/g);
        if (moreConds) pendingScHeader += ',' + moreConds.join(',');
        const conds = pendingScHeader.replace(/^,+/, '').split(',').filter(s => s.length > 0);
        pendingScHeader = null;
        // Expect '{' right after '>' to open the SC block
        const after = trimmed.substring(closeIdx + 1).trim();
        if (after === '{') {
          scBlockStack.push(conds);
          // actionDepth stays 0; the { is the SC block opening, not an action block
        }
      } else {
        // Still accumulating conditions from this line
        const moreConds = trimmed.match(/[A-Z_][A-Z0-9_]*/g);
        if (moreConds) pendingScHeader += ',' + moreConds.join(',');
      }
      continue;
    }

    // ── Skip C action blocks ───────────────────────────────────────────────────
    if (actionDepth > 0) {
      for (const ch of line) {
        if (ch === '{') actionDepth++;
        if (ch === '}') actionDepth = Math.max(0, actionDepth - 1);
      }
      continue;
    }

    // ── SC block closing } (at SC block level, actionDepth === 0) ─────────────
    if (scBlockStack.length > 0 && trimmed === '}') {
      scBlockStack.pop();
      continue;
    }

    // ── SC block opener: <SC1,SC2>{ ───────────────────────────────────────────
    // Single-line header: <SC1,SC2>{ or <SC1,SC2> {
    {
      const scBlockMatch = trimmed.match(/^<([A-Z_][A-Z0-9_]*(?:,[A-Z_][A-Z0-9_]*)*)>\s*\{/);
      if (scBlockMatch) {
        const conds = scBlockMatch[1].split(',');
        scBlockStack.push(conds);
        // Record the start condition references from the block header line
        for (const cond of conds) {
          const col = line.indexOf(cond);
          const range = Range.create(i, col >= 0 ? col : 0, i, (col >= 0 ? col : 0) + cond.length);
          if (!doc.startConditionRefs.has(cond)) doc.startConditionRefs.set(cond, []);
          doc.startConditionRefs.get(cond)!.push(range);
        }
        continue;
      }
      // Multi-line header start: <SC1,   (no closing > on this line)
      const scMultiStart = trimmed.match(/^<([A-Z_][A-Z0-9_]*(?:,[A-Z_][A-Z0-9_]*)*,\s*)$/);
      if (scMultiStart) {
        pendingScHeader = scMultiStart[1].replace(/,\s*$/, '');
        continue;
      }
    }

    // ── Extract start condition references: <SC_NAME> or <SC1,SC2> ────────────
    // Exclude <<EOF>> which is a special pattern, not a start condition
    const scRefs = line.matchAll(/(?<!<)<([A-Z_][A-Z0-9_]*(?:,[A-Z_][A-Z0-9_]*)*)>(?!>)/g);
    for (const m of scRefs) {
      const conditions = m[1].split(',');
      for (const cond of conditions) {
        const col = line.indexOf(cond, m.index);
        const range = Range.create(i, col >= 0 ? col : 0, i, (col >= 0 ? col : 0) + cond.length);
        if (!doc.startConditionRefs.has(cond)) {
          doc.startConditionRefs.set(cond, []);
        }
        doc.startConditionRefs.get(cond)!.push(range);
      }
    }

    // ── Extract abbreviation references: {name} (but not C code {}) ───────────
    // Only match {name} where name is a valid identifier
    const abbrRefs = line.matchAll(/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g);
    for (const m of abbrRefs) {
      const name = m[1];
      // Only count as abbreviation ref if it appears before any action block on this line.
      // If there is no action { on this line (multi-line action), treat actionStart as line.length
      // so all {name} refs on this line are counted.
      const actionMatch = line.match(/\s{2,}\{/);
      const actionStart = actionMatch !== null ? line.indexOf('{', actionMatch.index!) : line.length;
      if (m.index !== undefined && m.index < actionStart) {
        const col = m.index;
        const range = Range.create(i, col, i, col + m[0].length);
        if (!doc.abbreviationRefs.has(name)) {
          doc.abbreviationRefs.set(name, []);
        }
        doc.abbreviationRefs.get(name)!.push(range);
      }
    }

    // ── Build rule entry ───────────────────────────────────────────────────────
    // Start conditions: explicit <SC> prefix on this line PLUS any inherited from <SC>{ block
    const inherited = scBlockStack.length > 0 ? scBlockStack[scBlockStack.length - 1] : [];
    const startConditions: string[] = [...inherited];
    const scMatch = trimmed.match(/^<([A-Z_][A-Z0-9_]*(?:,[A-Z_][A-Z0-9_]*)*)>/);
    if (scMatch) {
      for (const c of scMatch[1].split(',')) {
        if (!startConditions.includes(c)) startConditions.push(c);
      }
    }

    doc.rules.push({
      pattern: trimmed,
      startConditions,
      location: Range.create(i, 0, i, line.length),
    });

    // ── Track action brace depth ───────────────────────────────────────────────
    for (const ch of line) {
      if (ch === '{') actionDepth++;
      if (ch === '}') actionDepth = Math.max(0, actionDepth - 1);
    }
  }

  return doc;
}

function parseOptions(text: string, lineNum: number, fullLine: string, doc: FlexDocument): void {
  // Options can be: name, name=value, or nooption
  const parts = text.split(/\s+/);
  for (const part of parts) {
    const eqIdx = part.indexOf('=');
    let name: string;
    let value: string | undefined;
    if (eqIdx >= 0) {
      name = part.substring(0, eqIdx);
      value = part.substring(eqIdx + 1);
    } else {
      name = part;
    }
    if (!name) continue;
    const col = fullLine.indexOf(name);
    const opt: FlexOption = {
      name,
      value,
      location: Range.create(lineNum, col >= 0 ? col : 0, lineNum, (col >= 0 ? col : 0) + name.length),
    };
    doc.options.set(name, opt);
  }
}

function parseStartConditions(text: string, exclusive: boolean, lineNum: number, fullLine: string, doc: FlexDocument): void {
  const names = text.match(/[A-Z_][A-Z0-9_]*/g);
  if (!names) return;
  for (const name of names) {
    const col = fullLine.indexOf(name);
    const sc: StartCondition = {
      name,
      exclusive,
      location: Range.create(lineNum, col >= 0 ? col : 0, lineNum, (col >= 0 ? col : 0) + name.length),
    };
    doc.startConditions.set(name, sc);
  }
}
