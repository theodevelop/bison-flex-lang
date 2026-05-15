// server/src/project/projectScanner.ts

import * as path from 'path';
import * as fs from 'fs';
import { URI } from 'vscode-uri';
import {
  BisonSourceFile,
  FlexSourceFile,
  ParserScannerPair,
  GeneratedFile,
  BuildSystemInfo,
} from './projectTypes';

// ── Constants ─────────────────────────────────────────────────────────────────

const BISON_EXTENSIONS = new Set(['.y', '.yy', '.ypp', '.bison']);
const FLEX_EXTENSIONS = new Set(['.l', '.ll', '.lex', '.flex']);
const EXCLUDED_DIRS = new Set(['node_modules', 'dist', '.git', 'vendor']);

const STEM_SUFFIXES = [
  '_parser', '-parser', 'parser',
  '_scanner', '-scanner', 'scanner',
  '_lex', '-lex',
  '_tab', '-tab',
];

// ── Pure functions ────────────────────────────────────────────────────────────

/** Strip common parser/scanner suffixes from a basename (case-insensitive). */
export function normalizeStem(basename: string): string {
  const lower = basename.toLowerCase();
  for (const suffix of STEM_SUFFIXES) {
    if (lower.endsWith(suffix) && lower.length > suffix.length) {
      return lower.slice(0, -suffix.length);
    }
  }
  return lower;
}

/**
 * Pair Bison and Flex files by name heuristic.
 * Strategy A: exact basename match → source 'basename'
 * Strategy B: normalized stem match → source 'normalized-stem'
 * Each Flex file is used at most once (first match wins).
 */
export function detectPairsFromPaths(
  bisonPaths: string[],
  flexPaths: string[],
): Array<{ bisonPath: string; flexPath: string; source: 'basename' | 'normalized-stem'; reason: string }> {
  const result: Array<{ bisonPath: string; flexPath: string; source: 'basename' | 'normalized-stem'; reason: string }> = [];
  const usedFlex = new Set<string>();

  for (const bisonPath of bisonPaths) {
    const bisonBase = path.basename(bisonPath, path.extname(bisonPath));
    const bisonLower = bisonBase.toLowerCase();

    // Strategy A: exact basename
    let matched = false;
    for (const flexPath of flexPaths) {
      if (usedFlex.has(flexPath)) continue;
      const flexBase = path.basename(flexPath, path.extname(flexPath));
      if (bisonLower === flexBase.toLowerCase()) {
        result.push({ bisonPath, flexPath, source: 'basename', reason: `same basename '${bisonBase}'` });
        usedFlex.add(flexPath);
        matched = true;
        break;
      }
    }
    if (matched) continue;

    // Strategy B: normalized stem
    const bisonStem = normalizeStem(bisonBase);
    if (bisonStem.length === 0) continue;
    for (const flexPath of flexPaths) {
      if (usedFlex.has(flexPath)) continue;
      const flexBase = path.basename(flexPath, path.extname(flexPath));
      const flexStem = normalizeStem(flexBase);
      if (bisonStem === flexStem) {
        result.push({
          bisonPath,
          flexPath,
          source: 'normalized-stem',
          reason: `normalized stem '${bisonStem}' (from '${bisonBase}' and '${flexBase}')`,
        });
        usedFlex.add(flexPath);
        break;
      }
    }
  }

  return result;
}

/**
 * Parse CMakeLists.txt content and extract explicit parser/scanner pairs.
 *
 * Standard style (case-insensitive):
 *   BISON_TARGET(name input.y output.tab.c ...)
 *   FLEX_TARGET(name input.l output.yy.c ...)
 *   ADD_FLEX_BISON_DEPENDENCY(bisonName flexName)
 *
 * Project-helper style (3-argument form):
 *   add_flex_bison_dependency(target input.y input.l)
 */
export function parseCmakePairs(content: string): Array<{ bisonFile: string; flexFile: string }> {
  const pairs: Array<{ bisonFile: string; flexFile: string }> = [];

  // Standard style: record targets
  const bisonTargets = new Map<string, string>(); // lower(name) → file
  const flexTargets = new Map<string, string>();

  const bisonTargetRe = /bison_target\s*\(\s*(\w+)\s+(\S+\.(?:y|yy|ypp|bison))/gi;
  const flexTargetRe = /flex_target\s*\(\s*(\w+)\s+(\S+\.(?:l|ll|lex|flex))/gi;

  let m: RegExpExecArray | null;
  while ((m = bisonTargetRe.exec(content)) !== null) {
    bisonTargets.set(m[1].toLowerCase(), m[2]);
  }
  while ((m = flexTargetRe.exec(content)) !== null) {
    flexTargets.set(m[1].toLowerCase(), m[2]);
  }

  // Standard 2-arg ADD_FLEX_BISON_DEPENDENCY(bisonName flexName)
  const addDep2Re = /add_flex_bison_dependency\s*\(\s*(\w+)\s+(\w+)\s*\)/gi;
  while ((m = addDep2Re.exec(content)) !== null) {
    const bFile = bisonTargets.get(m[1].toLowerCase());
    const fFile = flexTargets.get(m[2].toLowerCase());
    if (bFile && fFile) pairs.push({ bisonFile: bFile, flexFile: fFile });
  }

  // Project-helper 3-arg add_flex_bison_dependency(target input.y input.l)
  const addDep3Re = /add_flex_bison_dependency\s*\(\s*\w+\s+(\S+\.(?:y|yy|ypp|bison))\s+(\S+\.(?:l|ll|lex|flex))\s*\)/gi;
  while ((m = addDep3Re.exec(content)) !== null) {
    pairs.push({ bisonFile: m[1], flexFile: m[2] });
  }

  return pairs;
}

/**
 * Produce candidate generated-file paths for a Bison or Flex source.
 * Does NOT stat the filesystem — returns candidates only.
 * buildDir defaults to path.dirname(sourcePath) when undefined.
 */
export function generatedCandidates(
  sourcePath: string,
  buildDir: string | undefined,
  lang: 'bison' | 'flex',
): Array<{ fsPath: string; kind: GeneratedFile['kind'] }> {
  const dir = buildDir ?? path.dirname(sourcePath);
  const stem = path.basename(sourcePath, path.extname(sourcePath));
  const results: Array<{ fsPath: string; kind: GeneratedFile['kind'] }> = [];

  if (lang === 'bison') {
    // GNU style
    results.push({ fsPath: path.join(dir, `${stem}.tab.c`),   kind: 'tab.c'  });
    results.push({ fsPath: path.join(dir, `${stem}.tab.cpp`), kind: 'tab.cpp' });
    results.push({ fsPath: path.join(dir, `${stem}.tab.h`),   kind: 'tab.h'  });
    results.push({ fsPath: path.join(dir, `${stem}.tab.hpp`), kind: 'tab.h'  });
    // Automake style
    results.push({ fsPath: path.join(dir, `${stem}_tab.c`),   kind: 'tab.c'  });
    results.push({ fsPath: path.join(dir, `${stem}_tab.cpp`), kind: 'tab.cpp' });
    results.push({ fsPath: path.join(dir, `${stem}_tab.h`),   kind: 'tab.h'  });
    results.push({ fsPath: path.join(dir, `${stem}_tab.hpp`), kind: 'tab.h'  });
    // Reports
    results.push({ fsPath: path.join(dir, `${stem}.output`),  kind: 'output' });
    results.push({ fsPath: path.join(dir, `${stem}.xml`),     kind: 'xml'    });
    results.push({ fsPath: path.join(dir, `${stem}.gv`),      kind: 'gv'     });
  } else {
    // GNU Flex
    results.push({ fsPath: path.join(dir, 'lex.yy.c'),            kind: 'lex.yy.c'   });
    results.push({ fsPath: path.join(dir, 'lex.yy.cpp'),           kind: 'lex.yy.cpp' });
    // Automake lex.stem.c / lex.stem.cpp
    results.push({ fsPath: path.join(dir, `lex.${stem}.c`),        kind: 'lex.yy.c'   });
    results.push({ fsPath: path.join(dir, `lex.${stem}.cpp`),      kind: 'lex.yy.cpp' });
    // stem.yy.cpp
    results.push({ fsPath: path.join(dir, `${stem}.yy.cpp`),       kind: 'lex.yy.cpp' });
  }

  return results;
}

// ── I/O helpers ───────────────────────────────────────────────────────────────

async function readdirRecursive(dir: string): Promise<string[]> {
  const results: string[] = [];
  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true });
  } catch {
    return results;
  }
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!EXCLUDED_DIRS.has(entry.name)) {
        const sub = await readdirRecursive(path.join(dir, entry.name));
        for (const f of sub) results.push(f);
      }
    } else if (entry.isFile()) {
      results.push(path.join(dir, entry.name));
    }
  }
  return results;
}

async function listDepth2(root: string): Promise<string[]> {
  const dirs = [root];
  try {
    const d1 = await fs.promises.readdir(root, { withFileTypes: true });
    for (const e of d1) {
      if (!e.isDirectory() || EXCLUDED_DIRS.has(e.name)) continue;
      const sub = path.join(root, e.name);
      dirs.push(sub);
      try {
        const d2 = await fs.promises.readdir(sub, { withFileTypes: true });
        for (const e2 of d2) {
          if (e2.isDirectory() && !EXCLUDED_DIRS.has(e2.name)) dirs.push(path.join(sub, e2.name));
        }
      } catch { /* ignore unreadable subdir */ }
    }
  } catch { /* ignore unreadable root */ }
  return dirs;
}

// ── Exported I/O functions ───────────────────────────────────────────────────

export async function findSourceFiles(roots: string[]): Promise<{ bisonPaths: string[]; flexPaths: string[] }> {
  const bisonPaths: string[] = [];
  const flexPaths: string[] = [];
  for (const root of roots) {
    const files = await readdirRecursive(root);
    for (const f of files) {
      const ext = path.extname(f).toLowerCase();
      if (BISON_EXTENSIONS.has(ext)) bisonPaths.push(f);
      else if (FLEX_EXTENSIONS.has(ext)) flexPaths.push(f);
    }
  }
  return { bisonPaths, flexPaths };
}

async function fileExists(file: string): Promise<boolean> {
  try { await fs.promises.access(file); return true; } catch { return false; }
}

export async function findBuildSystemFiles(roots: string[]): Promise<BuildSystemInfo[]> {
  const results: BuildSystemInfo[] = [];
  for (const root of roots) {
    const dirs = await listDepth2(root);
    for (const dir of dirs) {
      const cmake  = path.join(dir, 'CMakeLists.txt');
      const make   = path.join(dir, 'Makefile');
      const confAc = path.join(dir, 'configure.ac');
      const makeAm = path.join(dir, 'Makefile.am');
      if (await fileExists(cmake))  results.push({ kind: 'cmake',    configFile: cmake  });
      if (await fileExists(make))   results.push({ kind: 'make',     configFile: make   });
      if (await fileExists(confAc)) results.push({ kind: 'automake', configFile: confAc });
      if (await fileExists(makeAm)) results.push({ kind: 'automake', configFile: makeAm });
    }
  }
  return results;
}

export async function scanWorkspace(roots: string[]): Promise<{
  parsers: BisonSourceFile[];
  scanners: FlexSourceFile[];
  pairs: ParserScannerPair[];
  buildSystems: BuildSystemInfo[];
}> {
  if (roots.length === 0) {
    return { parsers: [], scanners: [], pairs: [], buildSystems: [] };
  }

  const [{ bisonPaths, flexPaths }, buildSystems] = await Promise.all([
    findSourceFiles(roots),
    findBuildSystemFiles(roots),
  ]);

  const parsers: BisonSourceFile[] = bisonPaths.map(fsPath => {
    const root = roots.find(r => fsPath.startsWith(r.endsWith(path.sep) ? r : r + path.sep)) ?? roots[0];
    return {
      uri: URI.file(fsPath).toString(),
      fsPath,
      workspaceRoot: root,
      relativePath: path.relative(root, fsPath),
      language: 'bison' as const,
    };
  });

  const scanners: FlexSourceFile[] = flexPaths.map(fsPath => {
    const root = roots.find(r => fsPath.startsWith(r.endsWith(path.sep) ? r : r + path.sep)) ?? roots[0];
    return {
      uri: URI.file(fsPath).toString(),
      fsPath,
      workspaceRoot: root,
      relativePath: path.relative(root, fsPath),
      language: 'flex' as const,
    };
  });

  // Collect CMake explicit pairs first
  const pairs: ParserScannerPair[] = [];
  for (const bsi of buildSystems) {
    if (bsi.kind !== 'cmake') continue;
    let content: string;
    try {
      content = await fs.promises.readFile(bsi.configFile, 'utf-8');
    } catch {
      continue;
    }
    const cmakeDir = path.dirname(bsi.configFile);
    for (const cp of parseCmakePairs(content)) {
      const bisonAbs = path.resolve(cmakeDir, cp.bisonFile);
      const flexAbs  = path.resolve(cmakeDir, cp.flexFile);
      const parser  = parsers.find(p => p.fsPath === bisonAbs);
      const scanner = scanners.find(s => s.fsPath === flexAbs);
      if (parser && scanner) {
        pairs.push({
          parser, scanner,
          confidence: 'explicit',
          source: 'cmake',
          reason: `CMake ${path.basename(bsi.configFile)}: explicit dependency`,
        });
      }
    }
  }

  // Heuristic pairs for files not already explicitly paired
  const explicitBison = new Set(pairs.map(p => p.parser.fsPath));
  const explicitFlex  = new Set(pairs.map(p => p.scanner.fsPath));
  const remainingBison = bisonPaths.filter(p => !explicitBison.has(p));
  const remainingFlex  = flexPaths.filter(p => !explicitFlex.has(p));

  for (const raw of detectPairsFromPaths(remainingBison, remainingFlex)) {
    const parser  = parsers.find(p => p.fsPath === raw.bisonPath);
    const scanner = scanners.find(s => s.fsPath === raw.flexPath);
    if (parser && scanner) {
      pairs.push({ parser, scanner, confidence: 'inferred', source: raw.source, reason: raw.reason });
    }
  }

  return { parsers, scanners, pairs, buildSystems };
}
