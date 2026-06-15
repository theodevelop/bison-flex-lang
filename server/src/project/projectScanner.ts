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

const BISON_EXTENSIONS = new Set(['.y', '.yy']);
const FLEX_EXTENSIONS = new Set(['.l', '.ll']);

const STEM_SUFFIXES = [
  '_parser', '_scanner', '-parser', '-scanner',
  'parser', 'scanner', '_lex', '_tab',
];

async function walkDir(
  dir: string,
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
        await walkDir(path.join(dir, entry.name), bisonFiles, flexFiles);
      }
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      const fsPath = path.join(dir, entry.name);
      const uri = URI.file(fsPath).toString();

      if (BISON_EXTENSIONS.has(ext)) {
        bisonFiles.push({ uri, fsPath, language: 'bison' });
      } else if (FLEX_EXTENSIONS.has(ext)) {
        flexFiles.push({ uri, fsPath, language: 'flex' });
      }
    }
  }
}

async function findBuildSystems(workspaceRoot: string): Promise<BuildSystemInfo[]> {
  const results: BuildSystemInfo[] = [];

  const checkFile = async (filePath: string, kind: BuildSystemInfo['kind']): Promise<void> => {
    try {
      await fs.promises.access(filePath);
      results.push({ kind, configFile: filePath });
    } catch {
      // not found
    }
  };

  await checkFile(path.join(workspaceRoot, 'CMakeLists.txt'), 'cmake');
  await checkFile(path.join(workspaceRoot, 'Makefile'), 'make');
  await checkFile(path.join(workspaceRoot, 'configure.ac'), 'automake');
  await checkFile(path.join(workspaceRoot, 'Makefile.am'), 'automake');

  // Also check immediate subdirectories (depth 1)
  let entries: fs.Dirent[];
  try {
    entries = await fs.promises.readdir(workspaceRoot, { withFileTypes: true });
  } catch {
    return results;
  }

  for (const entry of entries) {
    if (entry.isDirectory() && !EXCLUDE_DIRS.has(entry.name)) {
      const subDir = path.join(workspaceRoot, entry.name);
      await checkFile(path.join(subDir, 'CMakeLists.txt'), 'cmake');
    }
  }

  return results;
}

function normalizeStem(name: string): string {
  let stem = path.basename(name, path.extname(name)).toLowerCase();
  for (const suffix of STEM_SUFFIXES) {
    if (stem.endsWith(suffix)) {
      stem = stem.slice(0, -suffix.length);
      break;
    }
  }
  return stem;
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

    // Match BISON_TARGET and FLEX_TARGET names, then add_flex_bison_dependency
    const bisonTargetRe = /BISON_TARGET\s*\(\s*\w+\s+([^\s)]+)/g;
    const flexTargetRe = /FLEX_TARGET\s*\(\s*\w+\s+([^\s)]+)/g;
    const depRe = /add_flex_bison_dependency\s*\(\s*(\w+)\s+(\w+)\s*\)/g;

    const cmakeDir = path.dirname(bs.configFile);

    // Build maps of CMake target name → source file
    const bisonTargetMap = new Map<string, string>();
    const flexTargetMap = new Map<string, string>();

    let m: RegExpExecArray | null;

    const bisonNameRe = /BISON_TARGET\s*\(\s*(\w+)\s+([^\s)]+)/g;
    while ((m = bisonNameRe.exec(content)) !== null) {
      const targetName = m[1];
      const srcFile = path.resolve(cmakeDir, m[2]);
      bisonTargetMap.set(targetName, srcFile);
    }

    const flexNameRe = /FLEX_TARGET\s*\(\s*(\w+)\s+([^\s)]+)/g;
    while ((m = flexNameRe.exec(content)) !== null) {
      const targetName = m[1];
      const srcFile = path.resolve(cmakeDir, m[2]);
      flexTargetMap.set(targetName, srcFile);
    }

    // add_flex_bison_dependency(FLEX_TARGET BISON_TARGET)
    while ((m = depRe.exec(content)) !== null) {
      const flexName = m[1];
      const bisonName = m[2];
      const flexSrc = flexTargetMap.get(flexName);
      const bisonSrc = bisonTargetMap.get(bisonName);
      if (!flexSrc || !bisonSrc) continue;

      const bison = bisonFiles.find(f => path.resolve(f.fsPath) === path.resolve(bisonSrc));
      const flex = flexFiles.find(f => path.resolve(f.fsPath) === path.resolve(flexSrc));
      if (bison && flex) {
        pairs.push({ parser: bison, scanner: flex, confidence: 'explicit' });
      }
    }

    // Fallback: match by stem if same CMakeLists.txt declares both
    bisonTargetRe.lastIndex = 0;
    flexTargetRe.lastIndex = 0;
    const cmakeBisonSrcs: string[] = [];
    const cmakeFlexSrcs: string[] = [];

    while ((m = bisonTargetRe.exec(content)) !== null) {
      cmakeBisonSrcs.push(path.resolve(cmakeDir, m[1]));
    }
    while ((m = flexTargetRe.exec(content)) !== null) {
      cmakeFlexSrcs.push(path.resolve(cmakeDir, m[1]));
    }

    for (const bSrc of cmakeBisonSrcs) {
      for (const fSrc of cmakeFlexSrcs) {
        const alreadyPaired = pairs.some(
          p => p.parser.fsPath === bSrc || p.scanner.fsPath === fSrc,
        );
        if (alreadyPaired) continue;

        if (normalizeStem(bSrc) === normalizeStem(fSrc)) {
          const bison = bisonFiles.find(f => path.resolve(f.fsPath) === bSrc);
          const flex = flexFiles.find(f => path.resolve(f.fsPath) === fSrc);
          if (bison && flex) {
            pairs.push({ parser: bison, scanner: flex, confidence: 'explicit' });
          }
        }
      }
    }
  }

  return pairs;
}

function detectInferredPairs(
  bisonFiles: BisonSourceFile[],
  flexFiles: FlexSourceFile[],
  explicitPairs: ParserScannerPair[],
): ParserScannerPair[] {
  const pairs: ParserScannerPair[] = [];
  const pairedBison = new Set(explicitPairs.map(p => p.parser.uri));
  const pairedFlex = new Set(explicitPairs.map(p => p.scanner.uri));

  for (const bison of bisonFiles) {
    if (pairedBison.has(bison.uri)) continue;
    const bStem = normalizeStem(bison.fsPath);

    for (const flex of flexFiles) {
      if (pairedFlex.has(flex.uri)) continue;
      const fStem = normalizeStem(flex.fsPath);

      if (bStem === fStem && bStem !== '') {
        pairs.push({ parser: bison, scanner: flex, confidence: 'inferred' });
        pairedBison.add(bison.uri);
        pairedFlex.add(flex.uri);
        break;
      }
    }
  }

  return pairs;
}

async function detectGeneratedFiles(
  bisonFiles: BisonSourceFile[],
  flexFiles: FlexSourceFile[],
): Promise<GeneratedFile[]> {
  const generated: GeneratedFile[] = [];

  for (const bison of bisonFiles) {
    const dir = bison.buildDirectory ?? path.dirname(bison.fsPath);
    const stem = path.basename(bison.fsPath, path.extname(bison.fsPath));

    const candidates: Array<{ file: string; kind: GeneratedFile['kind'] }> = [
      { file: path.join(dir, `${stem}.tab.c`), kind: 'tab.c' },
      { file: path.join(dir, `${stem}.tab.cpp`), kind: 'tab.cpp' },
      { file: path.join(dir, `${stem}.tab.h`), kind: 'tab.h' },
      { file: path.join(dir, `${stem}.tab.hpp`), kind: 'tab.h' },
      { file: path.join(dir, `${stem}.output`), kind: 'output' },
      { file: path.join(dir, `${stem}.xml`), kind: 'xml' },
      { file: path.join(dir, `${stem}.gv`), kind: 'gv' },
    ];

    for (const { file, kind } of candidates) {
      try {
        await fs.promises.access(file);
        generated.push({ uri: URI.file(file).toString(), fsPath: file, kind, sourceUri: bison.uri });
      } catch {
        // not found
      }
    }
  }

  for (const flex of flexFiles) {
    const dir = path.dirname(flex.fsPath);
    const stem = path.basename(flex.fsPath, path.extname(flex.fsPath));

    const candidates: Array<{ file: string; kind: GeneratedFile['kind'] }> = [
      { file: path.join(dir, 'lex.yy.c'), kind: 'lex.yy.c' },
      { file: path.join(dir, 'lex.yy.cpp'), kind: 'lex.yy.cpp' },
      { file: path.join(dir, `${stem}.yy.cpp`), kind: 'lex.yy.cpp' },
    ];

    for (const { file, kind } of candidates) {
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

export async function scanWorkspace(workspaceFolders: string[]): Promise<BisonFlexProjectModel> {
  const bisonFiles: BisonSourceFile[] = [];
  const flexFiles: FlexSourceFile[] = [];
  const buildSystems: BuildSystemInfo[] = [];

  const workspaceRoot = workspaceFolders[0] ?? '';

  for (const folder of workspaceFolders) {
    await walkDir(folder, bisonFiles, flexFiles);
    const bs = await findBuildSystems(folder);
    buildSystems.push(...bs);
  }

  const explicitPairs = await detectExplicitPairs(buildSystems, bisonFiles, flexFiles);
  const inferredPairs = detectInferredPairs(bisonFiles, flexFiles, explicitPairs);
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
