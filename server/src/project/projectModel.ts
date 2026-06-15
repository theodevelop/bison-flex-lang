import {
  BisonFlexProjectModel,
  BisonSourceFile,
  FlexSourceFile,
  ParserScannerPair,
  GeneratedFile,
  BuildSystemInfo,
} from './projectTypes';
import { scanWorkspace } from './projectScanner';

export class WorkspaceIndex {
  private model: BisonFlexProjectModel;

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
    if (workspaceFolders.length === 0) return;

    await new Promise<void>(resolve => {
      setImmediate(async () => {
        try {
          this.model = await scanWorkspace(workspaceFolders);
        } catch {
          // degrade gracefully
        }
        resolve();
      });
    });
  }

  async onFileChange(uri: string, change: 'created' | 'deleted' | 'renamed'): Promise<void> {
    if (change === 'deleted') {
      this.model.parsers = this.model.parsers.filter(f => f.uri !== uri);
      this.model.scanners = this.model.scanners.filter(f => f.uri !== uri);
      this.model.pairs = this.model.pairs.filter(
        p => p.parser.uri !== uri && p.scanner.uri !== uri,
      );
      this.model.generatedFiles = this.model.generatedFiles.filter(
        f => f.uri !== uri && f.sourceUri !== uri,
      );
      this.model.lastScanned = Date.now();
    } else {
      // created or renamed — full re-scan (rare event)
      const folders = this.model.workspaceRoot ? [this.model.workspaceRoot] : [];
      if (folders.length > 0) {
        try {
          this.model = await scanWorkspace(folders);
        } catch {
          // degrade gracefully
        }
      }
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
