import * as fs from 'fs';
import * as path from 'path';
import { window, workspace, Uri, Position, Range, ViewColumn } from 'vscode';

export { isGeneratedFile } from './lineDirectiveUtils';
import { isGeneratedFile, findNearestLineDirective } from './lineDirectiveUtils';

// ── Direction 1: generated → source ──────────────────────────────────────────

/** Navigate from the generated C file at cursorLine to the original grammar source. */
export async function showInSource(): Promise<void> {
  const editor = window.activeTextEditor;
  if (!editor) return;

  const text = editor.document.getText();

  if (!isGeneratedFile(text)) {
    window.showWarningMessage('This command is only available inside Bison or Flex generated files.');
    return;
  }

  const lines = text.split('\n');
  const cursorLine = editor.selection.active.line;
  const directive = findNearestLineDirective(lines, cursorLine);

  if (!directive) {
    window.showWarningMessage('No #line directive found above the cursor.');
    return;
  }

  // Resolve path: may be absolute or relative to the generated file's directory
  let sourcePath = directive.sourceFile.replace(/\\\\/g, '/').replace(/\\/g, '/');
  if (!path.isAbsolute(sourcePath)) {
    sourcePath = path.resolve(path.dirname(editor.document.uri.fsPath), sourcePath);
  }

  if (!fs.existsSync(sourcePath)) {
    const baseName = path.basename(sourcePath);
    const found = await findInWorkspace(baseName);
    if (!found) {
      window.showErrorMessage(`Source file not found: ${sourcePath}`);
      return;
    }
    sourcePath = found;
  }

  const offset = cursorLine - directive.directiveLine; // lines between directive and cursor
  const targetLine = Math.max(0, directive.sourceLine - 1 + offset);
  const doc = await workspace.openTextDocument(Uri.file(sourcePath));
  const pos = new Position(targetLine, 0);
  await window.showTextDocument(doc, { selection: new Range(pos, pos), viewColumn: ViewColumn.Active });
}

// ── Direction 2: source → generated ──────────────────────────────────────────

const BISON_CANDIDATES = (base: string, dir: string): string[] => [
  path.join(dir, base + '.tab.c'),
  path.join(dir, base + '.tab.cpp'),
  path.join(dir, base + '.tab.cc'),
  path.join(dir, base + '.c'),
  path.join(dir, base + '.cc'),
  path.join(dir, base + '.c++'),
  path.join(dir, base + '.cxx'),
  path.join(dir, base + '.cpp'),
];

const FLEX_CANDIDATES = (base: string, dir: string): string[] => [
  path.join(dir, 'lex.yy.c'),
  path.join(dir, 'lex.yy.cc'),
  path.join(dir, base + '.yy.c'),
  path.join(dir, base + '.yy.cpp'),
  path.join(dir, base + '.c'),
  path.join(dir, base + '.cc'),
  path.join(dir, base + '.c++'),
  path.join(dir, base + '.cxx'),
  path.join(dir, base + '.cpp'),
];

/** Scan CMakeLists.txt up the directory tree and return a build directory hint. */
function findCmakeBuildDir(sourceFilePath: string): string | undefined {
  const fileName = path.basename(sourceFilePath);
  let dir = path.dirname(sourceFilePath);

  for (let depth = 0; depth < 6; depth++) {
    const cmakePath = path.join(dir, 'CMakeLists.txt');
    if (fs.existsSync(cmakePath)) {
      try {
        const content = fs.readFileSync(cmakePath, 'utf-8').replace(/#[^\n]*/g, '');
        // Only proceed if this CMakeLists references our file
        if (!content.includes(fileName)) break;
        const re = /(?:BISON_TARGET|FLEX_TARGET)\s*\(\s*\w+\s+\S+\s+(\S+)/gi;
        let m: RegExpExecArray | null;
        while ((m = re.exec(content)) !== null) {
          const outputArg = m[1].replace(/^["']|["']$/g, '');
          // Strip CMake variables (e.g. ${CMAKE_CURRENT_BINARY_DIR})
          const stripped = outputArg.replace(/\$\{[^}]+\}\/?/g, '').trim();
          if (stripped) {
            return path.dirname(path.join(dir, stripped));
          }
          // If the output arg is purely a CMake variable (e.g. ${CMAKE_CURRENT_BINARY_DIR}/foo.tab.c),
          // try the standard build subdirectory convention
          return path.join(dir, 'build');
        }
      } catch {
        // ignore unreadable files
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}

/** Scan Makefile for generated output paths. */
function findMakefileBuildDir(sourceFilePath: string): string | undefined {
  const dir = path.dirname(sourceFilePath);
  const base = path.basename(sourceFilePath, path.extname(sourceFilePath));

  for (const name of ['Makefile', 'makefile', 'GNUmakefile']) {
    const mkPath = path.join(dir, name);
    if (!fs.existsSync(mkPath)) continue;
    try {
      const content = fs.readFileSync(mkPath, 'utf-8');
      // Look for lines like:  build/parser.tab.c  or  obj/lex.yy.c
      const re = new RegExp(`([^\\s:]+[\\/\\\\])?${base}\\.tab\\.[ch]|lex\\.yy\\.c`, 'g');
      const m = re.exec(content);
      if (m && m[1]) {
        return path.resolve(dir, m[1].replace(/[\\/]$/, ''));
      }
    } catch {
      // ignore
    }
  }
  return undefined;
}

/** Locate the generated file corresponding to a grammar source file. */
async function findGeneratedFile(sourceFilePath: string): Promise<string | null> {
  const config = workspace.getConfiguration('bisonFlex');
  const settingBuildDir = config.get<string>('buildDirectory', '').trim() || undefined;
  const sourceDir = path.dirname(sourceFilePath);
  const base = path.basename(sourceFilePath, path.extname(sourceFilePath));
  const ext = path.extname(sourceFilePath).toLowerCase();
  const isBison = ['.y', '.yy', '.y++', '.ypp', '.yxx', '.bison'].includes(ext);
  const candidates = isBison ? BISON_CANDIDATES : FLEX_CANDIDATES;

  const dirsToTry: string[] = [];
  if (settingBuildDir) dirsToTry.push(settingBuildDir);
  const cmakeDir = findCmakeBuildDir(sourceFilePath);
  if (cmakeDir) dirsToTry.push(cmakeDir);
  const makeDir = findMakefileBuildDir(sourceFilePath);
  if (makeDir) dirsToTry.push(makeDir);
  dirsToTry.push(sourceDir);

  for (const dir of dirsToTry) {
    for (const c of candidates(base, dir)) {
      if (fs.existsSync(c)) return c;
    }
  }

  // Workspace-wide search as last resort — let user pick if ambiguous
  let pattern = isBison ? `**/${base}.tab.{c,cpp,cc}` : `**/lex.yy.{c,cc}`;
  let found = await workspace.findFiles(pattern, '**/node_modules/**', 10);

  // in case of no results, check for ylwrap names (no tab/lex)
  // we only do that after the initial run to not force a picker if
  // the tool's default names are available somewhere in the workspace
  if (found.length === 0) {
    pattern = `**/${base}.{c,cc,c++,cxx,cpp}`;
    found = await workspace.findFiles(pattern, '**/node_modules/**', 10);
  }
  
  if (found.length === 0) return null;
  if (found.length === 1) return found[0].fsPath;

  const pick = await window.showQuickPick(
    found.map(u => ({ label: workspace.asRelativePath(u), fsPath: u.fsPath })),
    { placeHolder: 'Multiple generated files found — select one' }
  );
  return pick ? pick.fsPath : null;
}

/**
 * In the generated file, find the output line that corresponds to `sourceLine` (1-based)
 * in `sourceFilePath`. Returns the 0-based line index in the generated file.
 */
function findLineInGenerated(generatedLines: string[], sourceFilePath: string, sourceLine: number): number | null {
  const sourceBase = path.basename(sourceFilePath).toLowerCase();
  let bestGenLine = -1;
  let bestSrcLine = -1;

  for (let i = 0; i < generatedLines.length; i++) {
    // NOTE: only handles quoted filenames; unquoted form not yet supported (see showInSource / lineDirectiveUtils.ts)
    const m = generatedLines[i].match(/^#line\s+(\d+)\s+"([^"]+)"/);
    if (!m) continue;
    const dirSrcLine = parseInt(m[1], 10);
    const dirFile = path.basename(m[2]).toLowerCase();
    if (dirFile !== sourceBase) continue;
    if (dirSrcLine <= sourceLine) {
      bestGenLine = i;
      bestSrcLine = dirSrcLine;
    } else {
      break;
    }
  }

  if (bestGenLine === -1) return null;
  return bestGenLine + (sourceLine - bestSrcLine);
}

/** Navigate from a .y/.l source line to the corresponding line in the generated C file. */
export async function showInGenerated(): Promise<void> {
  const editor = window.activeTextEditor;
  if (!editor) return;

  const sourceFilePath = editor.document.uri.fsPath;
  const sourceLine = editor.selection.active.line + 1; // 1-based

  const generatedPath = await findGeneratedFile(sourceFilePath);
  if (!generatedPath) {
    window.showErrorMessage(
      'Generated file not found. Compile the grammar first, or set bisonFlex.buildDirectory in settings.'
    );
    return;
  }

  let generatedText: string;
  try {
    generatedText = fs.readFileSync(generatedPath, 'utf-8');
  } catch {
    window.showErrorMessage(`Cannot read generated file: ${generatedPath}`);
    return;
  }

  const generatedLines = generatedText.split('\n');
  const targetLine = findLineInGenerated(generatedLines, sourceFilePath, sourceLine);
  const pos = new Position(targetLine !== null ? targetLine : 0, 0);
  const doc = await workspace.openTextDocument(Uri.file(generatedPath));
  await window.showTextDocument(doc, { selection: new Range(pos, pos), viewColumn: ViewColumn.Beside });

  if (targetLine === null) {
    window.showWarningMessage(
      `Opened ${path.basename(generatedPath)}, but could not locate the exact line for source line ${sourceLine}.`
    );
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function findInWorkspace(baseName: string): Promise<string | null> {
  const found = await workspace.findFiles(`**/${baseName}`, '**/node_modules/**', 5);
  return found.length > 0 ? found[0].fsPath : null;
}
