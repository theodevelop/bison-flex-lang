export interface BisonFlexProjectModel {
  workspaceRoot: string;
  parsers: BisonSourceFile[];
  scanners: FlexSourceFile[];
  pairs: ParserScannerPair[];
  generatedFiles: GeneratedFile[];
  buildSystems: BuildSystemInfo[];
  lastScanned: number;
}

export interface BisonSourceFile {
  uri: string;
  fsPath: string;
  language: 'bison';
  buildDirectory?: string;
  outputFile?: string;
}

export interface FlexSourceFile {
  uri: string;
  fsPath: string;
  language: 'flex' | 'reflex';
}

export interface ParserScannerPair {
  parser: BisonSourceFile;
  scanner: FlexSourceFile;
  confidence: 'explicit' | 'inferred';
}

export interface GeneratedFile {
  uri: string;
  fsPath: string;
  kind: 'tab.c' | 'tab.cpp' | 'tab.h' | 'lex.yy.c' | 'lex.yy.cpp' | 'output' | 'xml' | 'gv';
  sourceUri: string;
}

export interface BuildSystemInfo {
  kind: 'cmake' | 'make' | 'automake' | 'unknown';
  configFile: string;
  buildDirectory?: string;
}
