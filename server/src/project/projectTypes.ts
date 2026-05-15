// server/src/project/projectTypes.ts

export interface BisonFlexProjectModel {
  workspaceRoot: string;
  parsers: BisonSourceFile[];
  scanners: FlexSourceFile[];
  pairs: ParserScannerPair[];
  generatedFiles: GeneratedFile[];
  buildSystems: BuildSystemInfo[];
  lastScanned: number; // Date.now() timestamp
}

export interface BisonSourceFile {
  uri: string;          // file URI (vscode-uri format)
  fsPath: string;       // absolute filesystem path
  workspaceRoot: string; // absolute path of the workspace folder containing this file
  relativePath: string;  // path relative to workspaceRoot
  language: 'bison';
  buildDirectory?: string; // resolved build directory for this file
  outputFile?: string;     // expected .output report path (if known)
}

export interface FlexSourceFile {
  uri: string;
  fsPath: string;
  workspaceRoot: string;
  relativePath: string;
  language: 'flex' | 'reflex';
}

export interface ParserScannerPair {
  parser: BisonSourceFile;
  scanner: FlexSourceFile;
  confidence: 'explicit' | 'inferred';
  source: 'cmake' | 'basename' | 'normalized-stem';
  reason: string; // e.g. "same basename 'calc'" or "CMake add_flex_bison_dependency"
}

export interface GeneratedFile {
  uri: string;
  fsPath: string;
  kind: 'tab.c' | 'tab.cpp' | 'tab.h' | 'lex.yy.c' | 'lex.yy.cpp' | 'output' | 'xml' | 'gv';
  sourceUri: string; // URI of the .y or .l file that generated it
}

export interface BuildSystemInfo {
  kind: 'cmake' | 'make' | 'automake' | 'unknown';
  configFile: string; // absolute path to CMakeLists.txt or Makefile
  buildDirectory?: string;
}
