// server/src/project/projectModel.ts

import * as path from 'path';
import * as fs from 'fs';
import { URI } from 'vscode-uri';
import {
  BisonFlexProjectModel,
  BisonSourceFile,
  FlexSourceFile,
  ParserScannerPair,
  GeneratedFile,
  BuildSystemInfo,
} from './projectTypes';
import { scanWorkspace, generatedCandidates } from './projectScanner';

export class WorkspaceIndex {
  private model: BisonFlexProjectModel;
  private roots: string[] = [];

  constructor(workspaceRoot: string) {
    this.model = {
      workspaceRoot,
      parsers: [],
      scanners: [],
      pairs: [],
      generatedFiles: [],
      buildSystems: [],
      lastScanned: 0,
    };
  }

  async initialize(workspaceFolders: string[]): Promise<void> {
    this.roots = workspaceFolders;
    if (workspaceFolders.length === 0) return;

    const { parsers, scanners, pairs, buildSystems } = await scanWorkspace(workspaceFolders);

    // Collect generated files that exist on disk
    const generatedFiles: GeneratedFile[] = [];

    for (const parser of parsers) {
      for (const c of generatedCandidates(parser.fsPath, parser.buildDirectory, 'bison')) {
        try {
          await fs.promises.access(c.fsPath);
          generatedFiles.push({
            uri: URI.file(c.fsPath).toString(),
            fsPath: c.fsPath,
            kind: c.kind,
            sourceUri: parser.uri,
          });
        } catch { /* file does not exist */ }
      }
    }

    for (const scanner of scanners) {
      for (const c of generatedCandidates(scanner.fsPath, undefined, 'flex')) {
        try {
          await fs.promises.access(c.fsPath);
          generatedFiles.push({
            uri: URI.file(c.fsPath).toString(),
            fsPath: c.fsPath,
            kind: c.kind,
            sourceUri: scanner.uri,
          });
        } catch { /* file does not exist */ }
      }
    }

    this.model = {
      workspaceRoot: this.model.workspaceRoot,
      parsers,
      scanners,
      pairs,
      generatedFiles,
      buildSystems,
      lastScanned: Date.now(),
    };
  }

  async onFileChange(uri: string, _change: 'created' | 'deleted' | 'renamed'): Promise<void> {
    const fsPath = URI.parse(uri).fsPath;
    const ext = path.extname(fsPath).toLowerCase();
    const relevant = new Set(['.y', '.yy', '.ypp', '.bison', '.l', '.ll', '.lex', '.flex']);
    if (relevant.has(ext) && this.roots.length > 0) {
      await this.initialize(this.roots);
    }
  }

  getPairForBison(bisonUri: string): ParserScannerPair | undefined {
    return this.model.pairs.find(p => p.parser.uri === bisonUri);
  }

  getPairForFlex(flexUri: string): ParserScannerPair | undefined {
    return this.model.pairs.find(p => p.scanner.uri === flexUri);
  }

  getBisonFiles(): BisonSourceFile[] {
    return this.model.parsers;
  }

  getFlexFiles(): FlexSourceFile[] {
    return this.model.scanners;
  }

  getAllPairs(): ParserScannerPair[] {
    return this.model.pairs;
  }

  getGeneratedFilesFor(sourceUri: string): GeneratedFile[] {
    return this.model.generatedFiles.filter(f => f.sourceUri === sourceUri);
  }

  getBuildInfo(): BuildSystemInfo[] {
    return this.model.buildSystems;
  }

  getModel(): BisonFlexProjectModel {
    return this.model;
  }
}
