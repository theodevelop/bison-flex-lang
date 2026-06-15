import * as fs from 'fs';
import * as path from 'path';
import { URI } from 'vscode-uri';
import {
  BisonFlexProjectModel,
  BisonSourceFile,
  FlexSourceFile,
  ParserScannerPair,
  GeneratedFile,
  BuildSystemInfo,
} from './projectTypes';

const EXCLUDE_DIRS = new Set(['node_modules', 'dist', '.git', 'vendor']);

const BISON_EXTENSIONS = new Set(['.y', '.yy', '.ypp', '.bison']);
const FLEX_EXTENSIONS = new Set(['.l', '.ll', '.lex', '.flex']);

const STEM_SUFFIXES = [
  '_parser', '_scanner', '-parser', '-scanner',
  'parser', 'scanner', '_lex', '_tab',
];

// ─── Pure exported functions ─────────────────────────────────────────────────

export function normalizeStem(name: string): string {
  let stem = path.basename(name, path.extname(name)).toLowerCase();
  for (const suffix of STEM_SUFFIXES) {
    if (stem.endsWith(suffix) && stem.length > suffix.length) {
      stem = stem.slice(0, -suffix.length);
      break;
    }
  }
  return stem;
}

export function detectPairsFromPaths(
  bisonPaths: string[],
  flexPaths: string[],
): Array<{ bisonPath: string; flexPath: string; source: 'basename' | 'normalized-stem'; reason: string }> {
  const pairs: Array<{ bisonPath: string; flexPath: string; source: 'basename' | 'normalized-stem'; reason: string }> = [];
  const pairedBison = new Set<string>();
  const pairedFlex = new Set<string>();

  // Pass 1 — identical basename (no extension)
  for (const bPath of bisonPaths) {
    const bBase = path.basename(bPath, path.extname(bPath));
    for (const fPath of flexPaths) {
      const fBase = path.basename(fPath, path.extname(fPath));
      if (bBase === fBase) {
        pairs.push({
          bisonPath: bPath,
          flexPath: fPath,
          source: 'basename',
          reason: `same basename "${bBase}"`,
        });
        pairedBison.add(bPath);
        pairedFlex.add(fPath);
        break;
      }
    }
  }

  // Pass 2 — normalized stem (suffix stripping)
  for (const bPath of bisonPaths) {
    if (pairedBison.has(bPath)) continue;
    const bStem = normalizeStem(bPath);
    if (!bStem) continue;

    for (const fPath of flexPaths) {
      if (pairedFlex.has(fPath)) continue;
      const fStem = normalizeStem(fPath);
      if (bStem === fStem) {
        const bBase = path.basename(bPath, path.extname(bPath));
        const fBase = path.basename(fPath, path.extname(fPath));
        pairs.push({
          bisonPath: bPath,
          flexPath: fPath,
          source: 'normalized-stem',
          reason: `normalized stem "${bStem}" from "${bBase}" and "${fBase}"`,
        });
        pairedBison.add(bPath);
        pairedFlex.add(fPath);
        break;
      }
    }
  }

  return pairs;
}

export function parseCmakePairs(
  content: string,
): Array<{ bisonFile: string; flexFile: string }> {
  const bisonTargets = new Map<string, string>(); // target name (upper) → file
  const flexTargets = new Map<string, string>();

  const bisonTargetRe = /BISON_TARGET\s*\(\s*(\w+)\s+(\S+)/gi;
  const flexTargetRe = /FLEX_TARGET\s*\(\s*(\w+)\s+(\S+)/gi;
  const depRe = /ADD_FLEX_BISON_DEPENDENCY\s*\(\s*(\w+)\s+(\w+)\s*\)/gi;

  let m: RegExpExecArray | null;

  while ((m = bisonTargetRe.exec(content)) !== null) {
    bisonTargets.set(m[1].toUpperCase(), m[2]);
  }
  while ((m = flexTargetRe.exec(content)) !== null) {
    flexTargets.set(m[1].toUpperCase(), m[2]);
  }

  const pairs: Array<{ bisonFile: string; flexFile: string }> = [];
  while ((m = depRe.exec(content)) !== null) {
    const flexName = m[1].toUpperCase();
    const bisonName = m[2].toUpperCase();
    const flexFile = flexTargets.get(flexName);
    const bisonFile = bisonTargets.get(bisonName);
    if (flexFile && bisonFile) {
      pairs.push({ bisonFile, flexFile });
    }
  }

  return pairs;
}

export function generatedCandidates(
  sourcePath: string,
  buildDir: string | undefined,
  lang: 'bison' | 'flex',
): Array<{ file: string; kind: GeneratedFile['kind'] }> {
  const dir = buildDir ?? path.dirname(sourcePath);
  const stem = path.basename(sourcePath, path.extname(sourcePath));

  if (lang === 'bison') {
    return [
      // GNU style
      { file: path.join(dir, `${stem}.tab.c`), kind: 'tab.c' },
      { file: path.join(dir, `${stem}.tab.cpp`), kind: 'tab.cpp' },
      { file: path.join(dir, `${stem}.tab.h`), kind: 'tab.h' },
      { file: path.join(dir, `${stem}.tab.hpp`), kind: 'tab.h' },
      { file: path.join(dir, `${stem}.output`), kind: 'output' },
      { file: path.join(dir, `${stem}.xml`), kind: 'xml' },
      { file: path.join(dir, `${stem}.gv`), kind: 'gv' },
      // Automake style
      { file: path.join(dir, `${stem}_tab.c`), kind: 'tab.c' },
      { file: path.join(dir, `${stem}_tab.cpp`), kind: 'tab.cpp' },
      { file: path.join(dir, `${stem}_tab.h`), kind: 'tab.h' },
      { file: path.join(dir, `${stem}_tab.hpp`), kind: 'tab.h' },
    ];
  } else {
    return [
      // GNU style
      { file: path.join(dir, 'lex.yy.c'), kind: 'lex.yy.c' },
      { file: path.join(dir, 'lex.yy.cpp'), kind: 'lex.yy.cpp' },
      { file: path.join(dir, `${stem}.yy.cpp`), kind: 'lex.yy.cpp' },
      // Automake style (dot separator, per-scanner prefix)
      { file: path.join(dir, `lex.${stem}.c`), kind: 'lex.yy.c' },
      { file: path.join(dir, `lex.${stem}.cpp`), kind: 'lex.yy.cpp' },
      // Automake style (underscore separator)
      { file: path.join(dir, 'lex_yy.c'), kind: 'lex.yy.c' },
      { file: path.join(dir, 'lex_yy.cpp'), kind: 'lex.yy.cpp' },
      { file: path.join(dir, 'lex._.c'), kind: 'lex.yy.c' },
      { file: path.join(dir, 'lex._.cpp'), kind: 'lex.yy.cpp' },
    ];
  }
}

// ─── Internal scan helpers ───────────────────────────────────────────────────

async function walkDir(
  dir: string,
  root: string,
  bisonFiles: BisonSourceFile[],
  flexFiles: FlexSourceFile[],
): Promise<void> {
  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (!EXCLUDE_DIRS.has(entry.name)) {
        await walkDir(path.join(dir, entry.name), root, bisonFiles, flexFiles);
      }
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      const fsPath = path.join(dir, entry.name);
      const uri = URI.file(fsPath).toString();
      const relativePath = path.relative(root, fsPath);

      if (BISON_EXTENSIONS.has(ext)) {
        bisonFiles.push({ uri, fsPath, language: 'bison', workspaceRoot: root, relativePath });
      } else if (FLEX_EXTENSIONS.has(ext)) {
        flexFiles.push({ uri, fsPath, language: 'flex', workspaceRoot: root, relativePath });
      }
    }
  }
}

async function findBuildSystems(workspaceRoot: string): Promise<BuildSystemInfo[]> {
  const results: BuildSystemInfo[] = [];

  const tryAdd = async (filePath: string, kind: BuildSystemInfo['kind']): Promise<void> => {
    try {
      await fs.promises.access(filePath);
      results.push({ kind, configFile: filePath });
    } catch {
      // not found
    }
  };

  await tryAdd(path.join(workspaceRoot, 'CMakeLists.txt'), 'cmake');
  await tryAdd(path.join(workspaceRoot, 'Makefile'), 'make');
  await tryAdd(path.join(workspaceRoot, 'configure.ac'), 'automake');
  await tryAdd(path.join(workspaceRoot, 'Makefile.am'), 'automake');

  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(workspaceRoot, { withFileTypes: true });
  } catch {
    return results;
  }

  for (const entry of entries) {
    if (entry.isDirectory() && !EXCLUDE_DIRS.has(entry.name)) {
      await tryAdd(path.join(workspaceRoot, entry.name, 'CMakeLists.txt'), 'cmake');
    }
  }

  return results;
}

async function detectExplicitPairs(
  buildSystems: BuildSystemInfo[],
  bisonFiles: BisonSourceFile[],
  flexFiles: FlexSourceFile[],
): Promise<ParserScannerPair[]> {
  const pairs: ParserScannerPair[] = [];

  for (const bs of buildSystems) {
    if (bs.kind !== 'cmake') continue;

    let content: string;
    try {
      content = await fs.promises.readFile(bs.configFile, 'utf-8');
    } catch {
      continue;
    }

    const cmakeDir = path.dirname(bs.configFile);
    const rawPairs = parseCmakePairs(content);

    for (const raw of rawPairs) {
      const bisonAbs = path.resolve(cmakeDir, raw.bisonFile);
      const flexAbs = path.resolve(cmakeDir, raw.flexFile);

      const bison = bisonFiles.find(f => path.resolve(f.fsPath) === bisonAbs);
      const flex = flexFiles.find(f => path.resolve(f.fsPath) === flexAbs);

      if (bison && flex) {
        pairs.push({
          parser: bison,
          scanner: flex,
          confidence: 'explicit',
          source: 'cmake',
          reason: `ADD_FLEX_BISON_DEPENDENCY in ${path.relative(bison.workspaceRoot, bs.configFile)}`,
        });
      }
    }
  }

  return pairs;
}

function buildInferredPairs(
  bisonFiles: BisonSourceFile[],
  flexFiles: FlexSourceFile[],
  explicitPairs: ParserScannerPair[],
): ParserScannerPair[] {
  const pairedBisonUris = new Set(explicitPairs.map(p => p.parser.uri));
  const pairedFlexUris = new Set(explicitPairs.map(p => p.scanner.uri));

  const unpairedBison = bisonFiles.filter(f => !pairedBisonUris.has(f.uri));
  const unpairedFlex = flexFiles.filter(f => !pairedFlexUris.has(f.uri));

  const rawPairs = detectPairsFromPaths(
    unpairedBison.map(f => f.fsPath),
    unpairedFlex.map(f => f.fsPath),
  );

  return rawPairs.map(raw => {
    const bison = unpairedBison.find(f => f.fsPath === raw.bisonPath)!;
    const flex = unpairedFlex.find(f => f.fsPath === raw.flexPath)!;
    return {
      parser: bison,
      scanner: flex,
      confidence: 'inferred' as const,
      source: raw.source,
      reason: raw.reason,
    };
  });
}

async function detectGeneratedFiles(
  bisonFiles: BisonSourceFile[],
  flexFiles: FlexSourceFile[],
): Promise<GeneratedFile[]> {
  const generated: GeneratedFile[] = [];

  for (const bison of bisonFiles) {
    for (const { file, kind } of generatedCandidates(bison.fsPath, bison.buildDirectory, 'bison')) {
      try {
        await fs.promises.access(file);
        generated.push({ uri: URI.file(file).toString(), fsPath: file, kind, sourceUri: bison.uri });
      } catch {
        // not found
      }
    }
  }

  for (const flex of flexFiles) {
    for (const { file, kind } of generatedCandidates(flex.fsPath, undefined, 'flex')) {
      try {
        await fs.promises.access(file);
        generated.push({ uri: URI.file(file).toString(), fsPath: file, kind, sourceUri: flex.uri });
      } catch {
        // not found
      }
    }
  }

  return generated;
}

// ─── Public scan entry point ─────────────────────────────────────────────────

export async function scanWorkspace(workspaceFolders: string[]): Promise<BisonFlexProjectModel> {
  const bisonFiles: BisonSourceFile[] = [];
  const flexFiles: FlexSourceFile[] = [];
  const buildSystems: BuildSystemInfo[] = [];

  const workspaceRoot = workspaceFolders[0] ?? '';

  for (const folder of workspaceFolders) {
    await walkDir(folder, folder, bisonFiles, flexFiles);
    const bs = await findBuildSystems(folder);
    buildSystems.push(...bs);
  }

  const explicitPairs = await detectExplicitPairs(buildSystems, bisonFiles, flexFiles);
  const inferredPairs = buildInferredPairs(bisonFiles, flexFiles, explicitPairs);
  const pairs = [...explicitPairs, ...inferredPairs];

  const generatedFiles = await detectGeneratedFiles(bisonFiles, flexFiles);

  return {
    workspaceRoot,
    parsers: bisonFiles,
    scanners: flexFiles,
    pairs,
    generatedFiles,
    buildSystems,
    lastScanned: Date.now(),
  };
}
