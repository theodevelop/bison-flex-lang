import * as path from 'path';
import * as cp from 'child_process';
import * as fs from 'fs';
import { isGeneratedFile, showInSource, showInGenerated } from './lineDirectiveNavigation';
import {
  ExtensionContext,
  workspace,
  window,
  commands,
  languages,
  Diagnostic as VDiagnostic,
  DiagnosticSeverity as VDiagnosticSeverity,
  Range as VRange,
  Position as VPosition,
  Uri,
  DiagnosticCollection,
  ViewColumn,
  WebviewPanel,
  StatusBarItem,
  StatusBarAlignment,
} from 'vscode';
import {
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
  TransportKind,
} from 'vscode-languageclient/node';

let client: LanguageClient;
let compilerDiagnostics: DiagnosticCollection;

export function activate(context: ExtensionContext): void {
  const serverModule = context.asAbsolutePath(
    path.join('dist', 'server', 'server.js')
  );

  const serverOptions: ServerOptions = {
    run: { module: serverModule, transport: TransportKind.ipc },
    debug: {
      module: serverModule,
      transport: TransportKind.ipc,
      options: { execArgv: ['--nolazy', '--inspect=6009'] },
    },
  };

  const clientOptions: LanguageClientOptions = {
    documentSelector: [
      { scheme: 'file', language: 'bison' },
      { scheme: 'file', language: 'flex' },
    ],
    synchronize: {
      configurationSection: 'bisonFlex',
      fileEvents: workspace.createFileSystemWatcher('**/*.{y,yy,l,ll}'),
    },
  };

  client = new LanguageClient(
    'bisonFlexLanguageServer',
    'Bison & Flex Language Server',
    serverOptions,
    clientOptions
  );

  client.start();

  // Diagnostic collection for compiler output
  compilerDiagnostics = languages.createDiagnosticCollection('bisonFlexCompiler');
  context.subscriptions.push(compilerDiagnostics);

  // ── Command: Bison: Compile ──────────────────────────────────────────────
  context.subscriptions.push(
    commands.registerCommand('bisonFlex.compileBison', () => {
      const editor = window.activeTextEditor;
      if (!editor || editor.document.languageId !== 'bison') {
        window.showWarningMessage('Open a Bison file (.y, .yy) to compile.');
        return;
      }
      editor.document.save().then(() => {
        const filePath = editor.document.uri.fsPath;
        const config = workspace.getConfiguration('bisonFlex');
        const bisonPath = config.get<string>('bisonPath', 'bison');
        const cwd = path.dirname(filePath);

        compilerDiagnostics.clear();
        const outputChannel = window.createOutputChannel('Bison Compile');
        outputChannel.show(true);
        outputChannel.appendLine(`Running: ${bisonPath} -d "${path.basename(filePath)}"`);

        cp.exec(
          `"${bisonPath}" -d "${path.basename(filePath)}"`,
          { cwd },
          (error, stdout, stderr) => {
            const output = stderr || stdout || '';
            outputChannel.appendLine(output);

            if (!error) {
              outputChannel.appendLine('Compilation successful.');
              window.showInformationMessage('Bison compilation successful.');
            } else {
              outputChannel.appendLine(`Exit code: ${error.code}`);
            }

            // Parse diagnostics from output
            const diags = parseCompilerOutput(output, cwd);
            for (const [uri, fileDiags] of diags) {
              compilerDiagnostics.set(uri, fileDiags);
            }
          }
        );
      });
    })
  );

  // ── Command: Flex: Compile ───────────────────────────────────────────────
  context.subscriptions.push(
    commands.registerCommand('bisonFlex.compileFlex', () => {
      const editor = window.activeTextEditor;
      if (!editor || editor.document.languageId !== 'flex') {
        window.showWarningMessage('Open a Flex file (.l, .ll) to compile.');
        return;
      }
      editor.document.save().then(() => {
        const filePath = editor.document.uri.fsPath;
        const config = workspace.getConfiguration('bisonFlex');
        const flexPath = config.get<string>('flexPath', 'flex');
        const cwd = path.dirname(filePath);

        compilerDiagnostics.clear();
        const outputChannel = window.createOutputChannel('Flex Compile');
        outputChannel.show(true);
        outputChannel.appendLine(`Running: ${flexPath} "${path.basename(filePath)}"`);

        cp.exec(
          `"${flexPath}" "${path.basename(filePath)}"`,
          { cwd },
          (error, stdout, stderr) => {
            const output = stderr || stdout || '';
            outputChannel.appendLine(output);

            if (!error) {
              outputChannel.appendLine('Compilation successful.');
              window.showInformationMessage('Flex compilation successful.');
            } else {
              outputChannel.appendLine(`Exit code: ${error.code}`);
            }

            const diags = parseCompilerOutput(output, cwd);
            for (const [uri, fileDiags] of diags) {
              compilerDiagnostics.set(uri, fileDiags);
            }
          }
        );
      });
    })
  );

  // ── Command: Bison: Show Parse Table ─────────────────────────────────────
  let parseTablePanel: WebviewPanel | undefined;

  context.subscriptions.push(
    commands.registerCommand('bisonFlex.showParseTable', () => {
      const editor = window.activeTextEditor;
      if (!editor || editor.document.languageId !== 'bison') {
        window.showWarningMessage('Open a Bison file (.y, .yy) to show parse table.');
        return;
      }
      editor.document.save().then(() => {
        const filePath = editor.document.uri.fsPath;
        const config = workspace.getConfiguration('bisonFlex');
        const bisonPath = config.get<string>('bisonPath', 'bison');
        const cwd = path.dirname(filePath);
        const baseName = path.basename(filePath, path.extname(filePath));
        const outputFile = path.join(cwd, baseName + '.output');

        window.withProgress(
          { location: { viewId: 'explorer' }, title: 'Generating parse table...' },
          () => new Promise<void>((resolve) => {
            cp.exec(
              `"${bisonPath}" -v "${path.basename(filePath)}"`,
              { cwd },
              (error, _stdout, stderr) => {
                if (error && !fs.existsSync(outputFile)) {
                  window.showErrorMessage(`Bison failed: ${stderr || error.message}`);
                  resolve();
                  return;
                }

                let content: string;
                try {
                  content = fs.readFileSync(outputFile, 'utf-8');
                } catch {
                  window.showErrorMessage(`Cannot read ${outputFile}`);
                  resolve();
                  return;
                }

                if (parseTablePanel) {
                  parseTablePanel.reveal(ViewColumn.Beside);
                } else {
                  parseTablePanel = window.createWebviewPanel(
                    'bisonParseTable',
                    `Parse Table — ${baseName}`,
                    ViewColumn.Beside,
                    { enableScripts: false }
                  );
                  parseTablePanel.onDidDispose(() => { parseTablePanel = undefined; });
                }

                parseTablePanel.title = `Parse Table — ${baseName}`;
                parseTablePanel.webview.html = renderParseTableHtml(content, baseName);
                resolve();
              }
            );
          })
        );
      });
    })
  );

  // ── Command: Bison: Show Grammar Graph ───────────────────────────────────
  let grammarGraphPanel: WebviewPanel | undefined;

  context.subscriptions.push(
    commands.registerCommand('bisonFlex.showGrammarGraph', async () => {
      const editor = window.activeTextEditor;
      if (!editor || editor.document.languageId !== 'bison') {
        window.showWarningMessage('Open a Bison file (.y, .yy) to show grammar graph.');
        return;
      }

      const uri = editor.document.uri.toString();

      const result = await client.sendRequest('bisonFlex/grammarGraph', { uri });
      if (!result) {
        window.showErrorMessage('Could not build grammar graph. Ensure the file has valid Bison content.');
        return;
      }

      const graphData = result as {
        nodes: { id: string; type: string; line: number; recursive?: boolean; first?: string[]; follow?: string[]; alternatives?: string[][] }[];
        edges: { source: string; target: string }[];
        startSymbol: string;
      };

      if (grammarGraphPanel) {
        grammarGraphPanel.reveal(ViewColumn.Beside);
      } else {
        grammarGraphPanel = window.createWebviewPanel(
          'bisonGrammarGraph',
          'Grammar Graph',
          ViewColumn.Beside,
          { enableScripts: true }
        );
        grammarGraphPanel.onDidDispose(() => { grammarGraphPanel = undefined; });
      }

      grammarGraphPanel.webview.html = renderGrammarGraphHtml(graphData);

      // Handle click messages from WebView → navigate to rule
      grammarGraphPanel.webview.onDidReceiveMessage((msg: { command: string; line: number }) => {
        if (msg.command === 'navigateToRule') {
          const targetLine = msg.line;
          const doc = editor.document;
          const pos = new VPosition(targetLine, 0);
          const range = new VRange(pos, pos);
          window.showTextDocument(doc, { selection: range, viewColumn: ViewColumn.One });
        }
      });
    })
  );

  // ── Status Bar: Show Grammar Graph button ─────────────────────────────────
  const graphStatusBar: StatusBarItem = window.createStatusBarItem(
    StatusBarAlignment.Right,
    100
  );
  graphStatusBar.command = 'bisonFlex.showGrammarGraph';
  graphStatusBar.text = '$(type-hierarchy) Grammar Graph';
  graphStatusBar.tooltip = 'Bison: Show Grammar Graph';
  context.subscriptions.push(graphStatusBar);

  function updateGraphStatusBar(): void {
    const editor = window.activeTextEditor;
    if (editor && editor.document.languageId === 'bison') {
      graphStatusBar.show();
    } else {
      graphStatusBar.hide();
    }
  }

  context.subscriptions.push(window.onDidChangeActiveTextEditor(updateGraphStatusBar));
  updateGraphStatusBar();

  // ── Command: Flex: Test Rule ────────────────────────────────────────────────
  let flexTestRulePanel: WebviewPanel | undefined;

  context.subscriptions.push(
    commands.registerCommand('bisonFlex.flexTestRule', () => {
      const editor = window.activeTextEditor;
      if (!editor || editor.document.languageId !== 'flex') {
        window.showWarningMessage('Open a Flex file (.l, .ll) to test rules.');
        return;
      }

      // Try to extract pattern from current line
      const currentLine = editor.document.lineAt(editor.selection.active.line).text;
      const patternMatch = currentLine.match(/^(?:<[A-Z_*][A-Z0-9_,*]*>\s*)?(\S+)/);
      const initialPattern = patternMatch ? patternMatch[1] : '';

      if (flexTestRulePanel) {
        flexTestRulePanel.reveal(ViewColumn.Beside);
      } else {
        flexTestRulePanel = window.createWebviewPanel(
          'flexTestRule',
          'Flex: Test Rule',
          ViewColumn.Beside,
          { enableScripts: true }
        );
        flexTestRulePanel.onDidDispose(() => { flexTestRulePanel = undefined; });
      }

      flexTestRulePanel.webview.html = renderFlexTestRuleHtml(initialPattern);
    })
  );

  // ── Command: Bison: Explain Conflict ──────────────────────────────────────
  let explainConflictPanel: WebviewPanel | undefined;

  context.subscriptions.push(
    commands.registerCommand('bisonFlex.explainConflict', async () => {
      const editor = window.activeTextEditor;
      if (!editor || editor.document.languageId !== 'bison') {
        window.showWarningMessage('Open a Bison file (.y, .yy) to explain conflicts.');
        return;
      }

      const uri = editor.document.uri.toString();
      const line = editor.selection.active.line;

      const result = await client.sendRequest('bisonFlex/explainConflict', { uri, line });
      if (!result) {
        window.showInformationMessage('No shift/reduce conflict detected at this position.');
        return;
      }

      if (explainConflictPanel) {
        explainConflictPanel.reveal(ViewColumn.Beside);
      } else {
        explainConflictPanel = window.createWebviewPanel(
          'bisonExplainConflict',
          'Bison: Explain Conflict',
          ViewColumn.Beside,
          { enableScripts: false }
        );
        explainConflictPanel.onDidDispose(() => { explainConflictPanel = undefined; });
      }

      const data = result as {
        ruleName: string;
        conflictTokens: string[];
        alternatives: string[][];
        hasPrec: boolean;
        explanation: string;
        derivations: string[];
        fixes: Array<{ title: string; code: string; description: string }>;
      };

      explainConflictPanel.title = `Conflict — ${data.ruleName}`;
      explainConflictPanel.webview.html = renderExplainConflictHtml(data);
    })
  );

  // ── Command: Bison: Generate AST Skeleton ─────────────────────────────────
  context.subscriptions.push(
    commands.registerCommand('bisonFlex.generateAstSkeleton', async () => {
      const editor = window.activeTextEditor;
      if (!editor || editor.document.languageId !== 'bison') {
        window.showWarningMessage('Open a Bison file (.y, .yy) to generate an AST skeleton.');
        return;
      }

      const uri = editor.document.uri.toString();
      const result = await client.sendRequest('bisonFlex/astSkeleton', { uri });
      if (!result) {
        window.showErrorMessage('Could not generate AST. Ensure the file has valid Bison rules.');
        return;
      }

      const data = result as { code: string; fileName: string };
      const dir = path.dirname(editor.document.uri.fsPath);
      const targetPath = path.join(dir, data.fileName);

      // Check if file exists
      if (fs.existsSync(targetPath)) {
        const choice = await window.showWarningMessage(
          `${data.fileName} already exists. Overwrite?`,
          'Overwrite', 'Cancel'
        );
        if (choice !== 'Overwrite') return;
      }

      fs.writeFileSync(targetPath, data.code, 'utf-8');
      const doc = await workspace.openTextDocument(Uri.file(targetPath));
      await window.showTextDocument(doc, ViewColumn.Beside);
      window.showInformationMessage(`AST skeleton generated: ${data.fileName}`);
    })
  );

  // ── Command: Bison/Flex: Initialize tasks.json ────────────────────────────
  context.subscriptions.push(
    commands.registerCommand('bisonFlex.initTasksJson', async () => {
      const editor = window.activeTextEditor;
      if (!editor) {
        window.showWarningMessage('Open a Bison or Flex file first.');
        return;
      }

      const workspaceFolder = workspace.workspaceFolders?.[0];
      if (!workspaceFolder) {
        window.showErrorMessage('No workspace folder open.');
        return;
      }

      const wsRoot = workspaceFolder.uri.fsPath;
      const vscodePath = path.join(wsRoot, '.vscode');
      const tasksPath = path.join(vscodePath, 'tasks.json');

      if (fs.existsSync(tasksPath)) {
        const choice = await window.showWarningMessage(
          'tasks.json already exists. Overwrite?',
          'Overwrite', 'Cancel'
        );
        if (choice !== 'Overwrite') return;
      }

      // Detect CMake
      const hasCMake = fs.existsSync(path.join(wsRoot, 'CMakeLists.txt'));
      // Detect Makefile
      const hasMakefile = fs.existsSync(path.join(wsRoot, 'Makefile'))
        || fs.existsSync(path.join(wsRoot, 'makefile'));

      const config = workspace.getConfiguration('bisonFlex');
      const bisonPath = config.get<string>('bisonPath', 'bison');
      const flexPath = config.get<string>('flexPath', 'flex');

      const tasks = generateTasksJson(bisonPath, flexPath, hasCMake, hasMakefile);

      if (!fs.existsSync(vscodePath)) {
        fs.mkdirSync(vscodePath, { recursive: true });
      }
      fs.writeFileSync(tasksPath, JSON.stringify(tasks, null, 2), 'utf-8');

      const doc = await workspace.openTextDocument(Uri.file(tasksPath));
      await window.showTextDocument(doc);
      window.showInformationMessage(
        `tasks.json generated${hasCMake ? ' (CMake detected)' : hasMakefile ? ' (Makefile detected)' : ''}.`
      );
    })
  );

  // ── Command: No-Op (used as placeholder by Code Lens "entry point" badge) ─
  context.subscriptions.push(
    commands.registerCommand('bisonFlex.noOp', () => { /* intentionally empty */ })
  );

  // ── Commands: #line navigation ────────────────────────────────────────────
  context.subscriptions.push(
    commands.registerCommand('bisonFlex.showInSource', () => void showInSource())
  );

  context.subscriptions.push(
    commands.registerCommand('bisonFlex.showInGenerated', () => void showInGenerated())
  );

  // Set context variable so the "Show in Source" menu entry only appears in generated files
  function updateGeneratedFileContext(): void {
    const editor = window.activeTextEditor;
    if (!editor) {
      void commands.executeCommand('setContext', 'bisonFlexIsGeneratedFile', false);
      return;
    }
    const text = editor.document.getText();
    void commands.executeCommand('setContext', 'bisonFlexIsGeneratedFile', isGeneratedFile(text));
  }

  context.subscriptions.push(window.onDidChangeActiveTextEditor(updateGeneratedFileContext));
  updateGeneratedFileContext();

  // ── Command: Show References (triggered by "N references" Code Lenses) ────
  // Args: [uriString, { line, character }]
  context.subscriptions.push(
    commands.registerCommand('bisonFlex.showReferences', (uriString: string, position: { line: number; character: number }) => {
      const uri = Uri.parse(uriString);
      const pos = new VPosition(position.line, position.character);
      commands.executeCommand('editor.action.goToReferences', uri, pos).then(undefined, () => {
        // Fallback: place cursor and trigger the standard find-references UI
        workspace.openTextDocument(uri).then(doc => {
          window.showTextDocument(doc).then(editor => {
            editor.selection = new (require('vscode').Selection)(pos, pos);
            commands.executeCommand('references-view.findReferences');
          });
        });
      });
    })
  );

  // ── Command: Add CMake Target ─────────────────────────────────────────────
  context.subscriptions.push(
    commands.registerCommand('bisonFlex.addCmakeTarget', async () => {
      const editor = window.activeTextEditor;
      if (!editor) {
        window.showWarningMessage('Open a Bison or Flex file to add a CMake target.');
        return;
      }
      const langId = editor.document.languageId as 'bison' | 'flex';
      if (langId !== 'bison' && langId !== 'flex') {
        window.showWarningMessage('This command is only available for Bison (.y) and Flex (.l) files.');
        return;
      }

      const filePath = editor.document.uri.fsPath;
      const fileName = path.basename(filePath);
      const fileDir = path.dirname(filePath);

      // Walk up to find CMakeLists.txt
      let cmakeDir: string | undefined;
      let dir = fileDir;
      for (let depth = 0; depth < 6; depth++) {
        if (fs.existsSync(path.join(dir, 'CMakeLists.txt'))) {
          cmakeDir = dir;
          break;
        }
        const parent = path.dirname(dir);
        if (parent === dir) break;
        dir = parent;
      }

      if (!cmakeDir) {
        const choice = await window.showWarningMessage(
          'No CMakeLists.txt found in parent directories. Create one?',
          'Create CMakeLists.txt', 'Cancel'
        );
        if (choice !== 'Create CMakeLists.txt') return;
        cmakeDir = fileDir;
        fs.writeFileSync(
          path.join(cmakeDir, 'CMakeLists.txt'),
          'cmake_minimum_required(VERSION 3.15)\nproject(MyParser)\n\nfind_package(BISON REQUIRED)\nfind_package(FLEX REQUIRED)\n\n',
          'utf-8'
        );
      }

      // Suggest a target name from the file's base name (PascalCase)
      const base = path.basename(fileName, path.extname(fileName));
      const defaultTarget = base.charAt(0).toUpperCase() + base.slice(1);
      const targetName = await window.showInputBox({
        prompt: 'CMake target name',
        value: defaultTarget,
        validateInput: v => /^\w+$/.test(v) ? undefined : 'Target name must be alphanumeric/underscore',
      });
      if (!targetName) return;

      // Generate the snippet
      const outExt = langId === 'bison' ? '.tab.cpp' : '.yy.cpp';
      const macro = langId === 'bison' ? 'BISON_TARGET' : 'FLEX_TARGET';
      const relativeInput = path.relative(cmakeDir, filePath).replace(/\\/g, '/');
      let snippet: string;
      if (langId === 'bison') {
        snippet =
          `\nBISON_TARGET(${targetName} ${relativeInput} \${CMAKE_CURRENT_BINARY_DIR}/${base}.tab.cpp\n` +
          `  DEFINES_FILE \${CMAKE_CURRENT_BINARY_DIR}/${base}.tab.h)\n`;
      } else {
        snippet =
          `\nFLEX_TARGET(${targetName} ${relativeInput} \${CMAKE_CURRENT_BINARY_DIR}/${base}.yy.cpp)\n`;
      }

      // Append to CMakeLists.txt
      const cmakePath = path.join(cmakeDir, 'CMakeLists.txt');
      fs.appendFileSync(cmakePath, snippet, 'utf-8');

      // Open the file so the user sees what was added
      const cmakeDoc = await workspace.openTextDocument(Uri.file(cmakePath));
      const cmakeEditor = await window.showTextDocument(cmakeDoc, { preview: false });
      // Scroll to the end where the snippet was appended
      const lastLine = cmakeDoc.lineCount - 1;
      cmakeEditor.revealRange(
        new (require('vscode').Range)(lastLine, 0, lastLine, 0),
        (require('vscode').TextEditorRevealType).InCenter
      );

      window.showInformationMessage(
        `${macro}(${targetName} ...) added to CMakeLists.txt.`
      );
      void outExt; // suppress unused variable lint
    })
  );
}

/** Render the grammar graph WebView with Dagre hierarchical layout + D3.js rendering */
function renderGrammarGraphHtml(data: {
  nodes: { id: string; type: string; line: number; recursive?: boolean; first?: string[]; follow?: string[]; alternatives?: string[][] }[];
  edges: { source: string; target: string }[];
  startSymbol: string;
}): string {
  const graphJSON = JSON.stringify(data);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Grammar Graph</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      background: var(--vscode-editor-background, #1e1e1e);
      color: var(--vscode-editor-foreground, #d4d4d4);
      font-family: var(--vscode-editor-font-family, 'Consolas', monospace);
      overflow: hidden;
      width: 100vw;
      height: 100vh;
    }
    #main-svg { width: 100%; height: 100%; }

    /* ── Edges ── */
    .edge path {
      fill: none;
      stroke: var(--vscode-editorWidget-border, #555);
      stroke-width: 1.5;
    }
    .edge path.self-loop {
      stroke-dasharray: 5,3;
    }
    .edge:hover path { stroke-width: 2.5; stroke-opacity: 1; }

    /* ── Node base ── */
    .node { cursor: pointer; }
    .node rect, .node ellipse {
      stroke-width: 2;
      transition: filter 0.15s;
    }
    .node:hover rect, .node:hover ellipse {
      filter: brightness(1.25);
    }
    .node .label {
      font-size: 12px;
      font-weight: 600;
      fill: #fff;
      text-anchor: middle;
      dominant-baseline: central;
      pointer-events: none;
    }
    .node .alt-text {
      font-size: 10px;
      fill: var(--vscode-editor-foreground, #ccc);
      text-anchor: middle;
      pointer-events: none;
      opacity: 0.85;
    }

    /* ── Color scheme ── */
    .node.start rect      { fill: #2b7bd6; stroke: #5aa3ee; }
    .node.nonterminal rect { fill: #2d8a4e; stroke: #4ec97a; }
    .node.recursive rect   { fill: #c04040; stroke: #e06060; }
    .node.token ellipse    { fill: #555; stroke: #888; }

    /* ── Toolbar ── */
    #toolbar {
      position: fixed; top: 8px; left: 8px;
      display: flex; gap: 6px; z-index: 200;
    }
    #toolbar button {
      background: var(--vscode-button-background, #0e639c);
      color: var(--vscode-button-foreground, #fff);
      border: none; border-radius: 4px;
      padding: 5px 10px; font-size: 12px;
      cursor: pointer;
      font-family: inherit;
    }
    #toolbar button:hover {
      background: var(--vscode-button-hoverBackground, #1177bb);
    }
    #toolbar button.active {
      background: var(--vscode-button-secondaryBackground, #3a3d41);
      outline: 2px solid var(--vscode-focusBorder, #007fd4);
    }

    /* ── Legend ── */
    #legend {
      position: fixed; top: 8px; right: 8px;
      background: var(--vscode-editorWidget-background, #252526);
      border: 1px solid var(--vscode-editorWidget-border, #454545);
      border-radius: 6px;
      padding: 10px 14px;
      font-size: 12px; z-index: 200;
    }
    #legend h4 { margin-bottom: 6px; font-size: 12px; opacity: 0.8; }
    .legend-item { display: flex; align-items: center; gap: 8px; margin: 4px 0; }
    .legend-dot {
      width: 12px; height: 12px; border-radius: 3px; display: inline-block;
      border: 1px solid rgba(255,255,255,0.2);
    }
    .legend-dot.token-dot { border-radius: 50%; }

    /* ── Tooltip ── */
    #tooltip {
      position: fixed; display: none;
      background: var(--vscode-editorHoverWidget-background, #2d2d30);
      border: 1px solid var(--vscode-editorHoverWidget-border, #454545);
      color: var(--vscode-editorHoverWidget-foreground, #d4d4d4);
      padding: 8px 12px; border-radius: 4px;
      font-size: 12px; pointer-events: none;
      z-index: 300; max-width: 400px;
      line-height: 1.5;
    }
    #tooltip .tt-title { font-weight: bold; margin-bottom: 4px; }
    #tooltip .tt-section { margin-top: 4px; }
    #tooltip .tt-label { opacity: 0.7; font-size: 11px; }
    #tooltip code {
      background: rgba(255,255,255,0.08);
      padding: 1px 4px; border-radius: 2px;
      font-size: 11px;
    }

    /* ── Minimap ── */
    #minimap {
      position: fixed; bottom: 12px; right: 12px;
      width: 180px; height: 120px;
      background: var(--vscode-editorWidget-background, #252526);
      border: 1px solid var(--vscode-editorWidget-border, #454545);
      border-radius: 4px; z-index: 200; overflow: hidden;
    }
    #minimap svg { width: 100%; height: 100%; }
    #minimap .viewport-rect {
      fill: rgba(0,127,212,0.15);
      stroke: var(--vscode-focusBorder, #007fd4);
      stroke-width: 1.5;
    }
  </style>
</head>
<body>
  <div id="toolbar">
    <button id="btn-reset" title="Reset zoom">⟳ Reset</button>
    <button id="btn-compact" class="active" title="Compact view">Compact</button>
    <button id="btn-detailed" title="Show alternatives">Detailed</button>
    <button id="btn-svg" title="Export as SVG">Export SVG</button>
    <button id="btn-png" title="Export as PNG">Export PNG</button>
  </div>

  <div id="legend">
    <h4>Legend</h4>
    <div class="legend-item"><span class="legend-dot" style="background:#2b7bd6"></span> Start symbol (%start)</div>
    <div class="legend-item"><span class="legend-dot" style="background:#2d8a4e"></span> Non-terminal</div>
    <div class="legend-item"><span class="legend-dot" style="background:#c04040"></span> Recursive (cycle)</div>
    <div class="legend-item"><span class="legend-dot token-dot" style="background:#555"></span> Terminal (token)</div>
  </div>

  <div id="tooltip"></div>
  <div id="minimap"><svg></svg></div>

  <svg id="main-svg"></svg>

  <script src="https://d3js.org/d3.v7.min.js"></script>
  <script src="https://unpkg.com/@dagrejs/dagre@1.1.4/dist/dagre.min.js"></script>
  <script>
  (function() {
    const vscode = acquireVsCodeApi();
    const data = ${graphJSON};
    const tooltip = document.getElementById('tooltip');

    // ── State ──
    let displayMode = 'compact'; // 'compact' | 'detailed'
    const NODE_H_COMPACT = 32;
    const NODE_H_DETAILED_BASE = 36;
    const NODE_H_ALT_LINE = 16;
    const NODE_W_MIN = 100;
    const CHAR_W = 7.5;
    const TOKEN_GROUP_THRESHOLD = 50; // group tokens if total rules > 50

    // ── Dagre layout ──
    function computeLayout(mode) {
      const g = new dagre.graphlib.Graph({ compound: true });
      g.setGraph({
        rankdir: 'TB',
        nodesep: 30,
        ranksep: 60,
        marginx: 40,
        marginy: 40,
        acyclicer: 'greedy',
        ranker: 'network-simplex'
      });
      g.setDefaultEdgeLabel(() => ({}));

      const ruleCount = data.nodes.filter(n => n.type === 'rule').length;
      const shouldGroupTokens = ruleCount > TOKEN_GROUP_THRESHOLD;
      const tokenNodes = data.nodes.filter(n => n.type === 'token');
      const ruleNodes = data.nodes.filter(n => n.type === 'rule');

      // Add rule nodes
      for (const n of ruleNodes) {
        let h = NODE_H_COMPACT;
        let label = n.id;
        if (mode === 'detailed' && n.alternatives && n.alternatives.length > 0) {
          h = NODE_H_DETAILED_BASE + n.alternatives.length * NODE_H_ALT_LINE;
        }
        const w = Math.max(NODE_W_MIN, label.length * CHAR_W + 24);
        g.setNode(n.id, { label: n.id, width: w, height: h });
      }

      if (shouldGroupTokens && tokenNodes.length > 0) {
        // Grouped token node
        const groupLabel = tokenNodes.length + ' terminals';
        const w = Math.max(NODE_W_MIN, groupLabel.length * CHAR_W + 24);
        g.setNode('__tokens__', { label: groupLabel, width: w, height: NODE_H_COMPACT });
        // Edges: any rule referencing any token → single edge to group
        const rulesWithTokenEdge = new Set();
        for (const e of data.edges) {
          const targetNode = data.nodes.find(nn => nn.id === e.target);
          if (targetNode && targetNode.type === 'token') {
            if (!rulesWithTokenEdge.has(e.source)) {
              rulesWithTokenEdge.add(e.source);
              g.setEdge(e.source, '__tokens__');
            }
          }
        }
      } else {
        // Individual token nodes
        for (const n of tokenNodes) {
          const w = Math.max(80, n.id.length * CHAR_W + 20);
          g.setNode(n.id, { label: n.id, width: w, height: NODE_H_COMPACT });
        }
      }

      // Add edges (skip token edges if grouped)
      for (const e of data.edges) {
        const sourceInGraph = g.hasNode(e.source);
        const targetInGraph = g.hasNode(e.target);
        if (sourceInGraph && targetInGraph) {
          // Self-loops: dagre doesn't handle them, we'll draw manually
          if (e.source !== e.target) {
            g.setEdge(e.source, e.target);
          }
        } else if (sourceInGraph && shouldGroupTokens) {
          // Target is a token that was grouped
          const targetNode = data.nodes.find(nn => nn.id === e.target);
          if (targetNode && targetNode.type === 'token' && g.hasNode('__tokens__')) {
            // Already handled above
          }
        }
      }

      dagre.layout(g);
      return g;
    }

    // ── Render ──
    function render(mode) {
      displayMode = mode;
      const g = computeLayout(mode);
      const graphInfo = g.graph();
      const gw = graphInfo.width || 800;
      const gh = graphInfo.height || 600;

      const svgEl = d3.select('#main-svg');
      svgEl.selectAll('*').remove();

      svgEl.attr('viewBox', '0 0 ' + gw + ' ' + gh);

      // Defs: arrowhead
      const defs = svgEl.append('defs');
      defs.append('marker')
        .attr('id', 'arrow')
        .attr('viewBox', '0 -5 10 10')
        .attr('refX', 8).attr('refY', 0)
        .attr('markerWidth', 7).attr('markerHeight', 7)
        .attr('orient', 'auto')
        .append('path')
        .attr('d', 'M0,-4L8,0L0,4Z')
        .attr('fill', '#888');

      const container = svgEl.append('g').attr('class', 'graph-container');

      // ── Draw edges ──
      const edgeGroup = container.append('g').attr('class', 'edges');
      for (const e of g.edges()) {
        const edgeData = g.edge(e);
        if (!edgeData || !edgeData.points) continue;
        const pts = edgeData.points;

        // Compute path
        const line = d3.line().x(p => p.x).y(p => p.y).curve(d3.curveBasis);
        const eg = edgeGroup.append('g').attr('class', 'edge');
        eg.append('path')
          .attr('d', line(pts))
          .attr('marker-end', 'url(#arrow)');
      }

      // ── Draw self-loops ──
      const selfLoops = data.edges.filter(e => e.source === e.target);
      for (const sl of selfLoops) {
        const nodeInfo = g.node(sl.source);
        if (!nodeInfo) continue;
        const cx = nodeInfo.x;
        const cy = nodeInfo.y - nodeInfo.height / 2;
        const r = 20;
        const eg = edgeGroup.append('g').attr('class', 'edge');
        eg.append('path')
          .attr('class', 'self-loop')
          .attr('d', 'M' + (cx - 10) + ',' + cy +
            ' C' + (cx - 10) + ',' + (cy - r * 2) +
            ' ' + (cx + 10) + ',' + (cy - r * 2) +
            ' ' + (cx + 10) + ',' + cy)
          .attr('marker-end', 'url(#arrow)');
      }

      // ── Draw nodes ──
      const nodeGroup = container.append('g').attr('class', 'nodes');
      const nodeMap = new Map();
      for (const n of data.nodes) nodeMap.set(n.id, n);

      for (const nid of g.nodes()) {
        const pos = g.node(nid);
        if (!pos) continue;
        const nd = nodeMap.get(nid);
        const isGroupedToken = (nid === '__tokens__');
        const isToken = isGroupedToken || (nd && nd.type === 'token');
        const isStart = nd && nd.id === data.startSymbol;
        const isRecursive = nd && nd.recursive;

        let cls = 'node ';
        if (isGroupedToken) cls += 'token';
        else if (isStart) cls += 'start';
        else if (isRecursive) cls += 'recursive';
        else if (isToken) cls += 'token';
        else cls += 'nonterminal';

        const ng = nodeGroup.append('g')
          .attr('class', cls)
          .attr('transform', 'translate(' + pos.x + ',' + pos.y + ')');

        const hw = pos.width / 2;
        const hh = pos.height / 2;

        if (isToken) {
          // Ellipse for terminals
          ng.append('ellipse')
            .attr('rx', hw).attr('ry', hh);
        } else {
          // Rounded rect for rules
          ng.append('rect')
            .attr('x', -hw).attr('y', -hh)
            .attr('width', pos.width).attr('height', pos.height)
            .attr('rx', 6).attr('ry', 6);
        }

        // Label
        if (mode === 'detailed' && nd && nd.alternatives && nd.alternatives.length > 0 && !isToken) {
          // Title at top
          ng.append('text')
            .attr('class', 'label')
            .attr('y', -hh + 16)
            .text(nd.id);
          // Alternatives
          for (let i = 0; i < nd.alternatives.length; i++) {
            const altText = nd.alternatives[i].join(' ');
            const display = altText.length > 30 ? altText.slice(0, 28) + '…' : altText;
            ng.append('text')
              .attr('class', 'alt-text')
              .attr('y', -hh + 34 + i * NODE_H_ALT_LINE)
              .text('→ ' + display);
          }
        } else {
          // Simple centered label
          const label = isGroupedToken ? pos.label : (nd ? nd.id : nid);
          ng.append('text')
            .attr('class', 'label')
            .text(label.length > 20 ? label.slice(0, 18) + '…' : label);
        }

        // Click → navigate
        if (nd) {
          ng.on('click', () => {
            vscode.postMessage({ command: 'navigateToRule', line: nd.line });
          });
        }

        // Hover → tooltip with First/Follow
        if (nd) {
          ng.on('mouseover', (event) => {
            let html = '<div class="tt-title">' + escHtml(nd.id) + '</div>';
            html += '<div>Line ' + (nd.line + 1) + ' · ' + nd.type + '</div>';
            if (nd.first && nd.first.length > 0) {
              html += '<div class="tt-section"><span class="tt-label">First:</span> ' +
                nd.first.map(s => '<code>' + escHtml(s) + '</code>').join(' ') + '</div>';
            }
            if (nd.follow && nd.follow.length > 0) {
              html += '<div class="tt-section"><span class="tt-label">Follow:</span> ' +
                nd.follow.map(s => '<code>' + escHtml(s) + '</code>').join(' ') + '</div>';
            }
            if (nd.recursive) {
              html += '<div class="tt-section" style="color:#e06060">⟲ Recursive (participates in a cycle)</div>';
            }
            tooltip.innerHTML = html;
            tooltip.style.display = 'block';
          });
          ng.on('mousemove', (event) => {
            tooltip.style.left = (event.clientX + 14) + 'px';
            tooltip.style.top = (event.clientY - 14) + 'px';
          });
          ng.on('mouseout', () => { tooltip.style.display = 'none'; });
        }
      }

      // ── Zoom ──
      const zoom = d3.zoom()
        .scaleExtent([0.1, 5])
        .on('zoom', (event) => {
          container.attr('transform', event.transform);
          updateMinimap(event.transform);
        });
      svgEl.call(zoom);

      // Center the graph initially
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const scale = Math.min(vw / gw, vh / gh, 1) * 0.9;
      const tx = (vw - gw * scale) / 2;
      const ty = (vh - gh * scale) / 2;
      const initialTransform = d3.zoomIdentity.translate(tx, ty).scale(scale);
      svgEl.call(zoom.transform, initialTransform);

      // ── Reset button ──
      document.getElementById('btn-reset').onclick = () => {
        svgEl.transition().duration(400).call(zoom.transform, initialTransform);
      };

      // ── Minimap ──
      renderMinimap(g, gw, gh);
      updateMinimap(initialTransform);

      // Store zoom ref for buttons
      window.__zoom = zoom;
      window.__svg = svgEl;
      window.__initialTransform = initialTransform;
    }

    // ── Minimap ──
    function renderMinimap(g, gw, gh) {
      const mmSvg = d3.select('#minimap svg');
      mmSvg.selectAll('*').remove();
      mmSvg.attr('viewBox', '0 0 ' + gw + ' ' + gh);

      const mmg = mmSvg.append('g');

      // Mini edges
      for (const e of g.edges()) {
        const edgeData = g.edge(e);
        if (!edgeData || !edgeData.points) continue;
        const line = d3.line().x(p => p.x).y(p => p.y).curve(d3.curveBasis);
        mmg.append('path')
          .attr('d', line(edgeData.points))
          .attr('fill', 'none').attr('stroke', '#555').attr('stroke-width', 1);
      }

      // Mini nodes
      const nodeMap = new Map();
      for (const n of data.nodes) nodeMap.set(n.id, n);
      for (const nid of g.nodes()) {
        const pos = g.node(nid);
        if (!pos) continue;
        const nd = nodeMap.get(nid);
        const isStart = nd && nd.id === data.startSymbol;
        const isRecursive = nd && nd.recursive;
        const isToken = (nid === '__tokens__') || (nd && nd.type === 'token');
        let color = '#2d8a4e';
        if (isStart) color = '#2b7bd6';
        else if (isRecursive) color = '#c04040';
        else if (isToken) color = '#555';
        mmg.append('rect')
          .attr('x', pos.x - pos.width / 2)
          .attr('y', pos.y - pos.height / 2)
          .attr('width', pos.width).attr('height', pos.height)
          .attr('rx', 3).attr('fill', color).attr('opacity', 0.7);
      }

      // Viewport rectangle
      mmSvg.append('rect')
        .attr('class', 'viewport-rect')
        .attr('x', 0).attr('y', 0)
        .attr('width', 100).attr('height', 100);
    }

    function updateMinimap(transform) {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const mmRect = d3.select('#minimap .viewport-rect');
      if (mmRect.empty()) return;
      // Invert the transform to find the visible area in graph coordinates
      const inv = transform.invert([0, 0]);
      const inv2 = transform.invert([vw, vh]);
      mmRect
        .attr('x', inv[0]).attr('y', inv[1])
        .attr('width', inv2[0] - inv[0])
        .attr('height', inv2[1] - inv[1]);
    }

    // ── Export SVG ──
    function exportSVG() {
      const svgEl = document.getElementById('main-svg');
      const clone = svgEl.cloneNode(true);
      // Reset transform for export
      const container = clone.querySelector('.graph-container');
      if (container) container.removeAttribute('transform');
      const serializer = new XMLSerializer();
      const svgString = serializer.serializeToString(clone);
      const blob = new Blob([svgString], { type: 'image/svg+xml' });
      downloadBlob(blob, 'grammar-graph.svg');
    }

    // ── Export PNG ──
    function exportPNG() {
      const svgEl = document.getElementById('main-svg');
      const clone = svgEl.cloneNode(true);
      const container = clone.querySelector('.graph-container');
      if (container) container.removeAttribute('transform');
      const serializer = new XMLSerializer();
      const svgString = serializer.serializeToString(clone);

      const canvas = document.createElement('canvas');
      const vb = svgEl.getAttribute('viewBox');
      const parts = vb ? vb.split(' ').map(Number) : [0, 0, 1200, 800];
      const scale = 2; // retina
      canvas.width = parts[2] * scale;
      canvas.height = parts[3] * scale;
      const ctx = canvas.getContext('2d');
      ctx.scale(scale, scale);

      const img = new Image();
      img.onload = () => {
        // Fill background
        ctx.fillStyle = getComputedStyle(document.body).backgroundColor || '#1e1e1e';
        ctx.fillRect(0, 0, parts[2], parts[3]);
        ctx.drawImage(img, 0, 0, parts[2], parts[3]);
        canvas.toBlob(blob => {
          if (blob) downloadBlob(blob, 'grammar-graph.png');
        }, 'image/png');
      };
      img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgString)));
    }

    function downloadBlob(blob, filename) {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }

    function escHtml(s) {
      return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    }

    // ── Toolbar bindings ──
    document.getElementById('btn-compact').onclick = () => {
      document.getElementById('btn-compact').classList.add('active');
      document.getElementById('btn-detailed').classList.remove('active');
      render('compact');
    };
    document.getElementById('btn-detailed').onclick = () => {
      document.getElementById('btn-detailed').classList.add('active');
      document.getElementById('btn-compact').classList.remove('active');
      render('detailed');
    };
    document.getElementById('btn-svg').onclick = exportSVG;
    document.getElementById('btn-png').onclick = exportPNG;

    // ── Initial render ──
    render('compact');
  })();
  </script>
</body>
</html>`;
}

export function deactivate(): Thenable<void> | undefined {
  if (!client) {
    return undefined;
  }
  return client.stop();
}

/**
 * Parse compiler output (bison/flex) into VS Code diagnostics.
 * Supports formats:
 *   file:line.col: error: message
 *   file:line.col-col: warning: message
 *   file:line: error: message
 *   "file", line N: message
 */
function parseCompilerOutput(output: string, cwd: string): Map<Uri, VDiagnostic[]> {
  const result = new Map<Uri, VDiagnostic[]>();
  const lines = output.split(/\r?\n/);

  for (const line of lines) {
    // Bison format: file:line.col[-line.col]: severity: message
    let m = line.match(/^(.+?):(\d+)(?:\.(\d+))?(?:-(\d+)(?:\.(\d+))?)?:\s*(error|warning|note):\s*(.+)/);
    if (m) {
      const file = path.isAbsolute(m[1]) ? m[1] : path.join(cwd, m[1]);
      const lineNum = Math.max(0, parseInt(m[2]) - 1);
      const colStart = m[3] ? Math.max(0, parseInt(m[3]) - 1) : 0;
      const lineEnd = m[4] ? Math.max(0, parseInt(m[4]) - 1) : lineNum;
      const colEnd = m[5] ? parseInt(m[5]) : colStart + 1;
      const severity = m[6] === 'error' ? VDiagnosticSeverity.Error
        : m[6] === 'warning' ? VDiagnosticSeverity.Warning
        : VDiagnosticSeverity.Information;
      const message = m[7];

      const uri = Uri.file(file);
      const diag = new VDiagnostic(
        new VRange(lineNum, colStart, lineEnd, colEnd),
        message,
        severity
      );
      diag.source = 'bison/flex compiler';

      if (!result.has(uri)) result.set(uri, []);
      result.get(uri)!.push(diag);
      continue;
    }

    // Flex format: "file", line N: message
    m = line.match(/^"(.+?)",\s*line\s+(\d+):\s*(.+)/);
    if (m) {
      const file = path.isAbsolute(m[1]) ? m[1] : path.join(cwd, m[1]);
      const lineNum = Math.max(0, parseInt(m[2]) - 1);
      const message = m[3];
      const severity = /error/i.test(message) ? VDiagnosticSeverity.Error : VDiagnosticSeverity.Warning;

      const uri = Uri.file(file);
      const diag = new VDiagnostic(
        new VRange(lineNum, 0, lineNum, 1000),
        message,
        severity
      );
      diag.source = 'bison/flex compiler';

      if (!result.has(uri)) result.set(uri, []);
      result.get(uri)!.push(diag);
    }
  }

  return result;
}

/** Render the Flex Test Rule interactive WebView. */
function renderFlexTestRuleHtml(initialPattern: string): string {
  const escPattern = initialPattern.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Flex: Test Rule</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      background: var(--vscode-editor-background, #1e1e1e);
      color: var(--vscode-editor-foreground, #d4d4d4);
      font-family: var(--vscode-editor-font-family, 'Consolas', monospace);
      font-size: var(--vscode-editor-font-size, 13px);
      padding: 20px;
      line-height: 1.6;
    }
    h2 { font-size: 16px; margin-bottom: 16px; color: var(--vscode-symbolIcon-classForeground, #4ec9b0); }
    .section { margin-bottom: 20px; }
    label {
      display: block; margin-bottom: 6px; font-weight: 600;
      color: var(--vscode-descriptionForeground, #aaa);
      font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px;
    }
    input[type="text"] {
      width: 100%; padding: 8px 12px;
      background: var(--vscode-input-background, #3c3c3c);
      color: var(--vscode-input-foreground, #d4d4d4);
      border: 1px solid var(--vscode-input-border, #555);
      border-radius: 4px; font-family: inherit; font-size: 14px;
    }
    input:focus { outline: 1px solid var(--vscode-focusBorder, #007fd4); }
    .help { font-size: 11px; color: var(--vscode-descriptionForeground, #888); margin-top: 4px; }

    /* Result area */
    #result {
      background: var(--vscode-editorWidget-background, #252526);
      border: 1px solid var(--vscode-editorWidget-border, #454545);
      border-radius: 6px; padding: 16px; min-height: 120px;
    }
    .match-yes { color: var(--vscode-charts-green, #4ec9b0); }
    .match-no { color: var(--vscode-editorError-foreground, #f44747); }
    .match-error { color: var(--vscode-editorWarning-foreground, #ff9900); }

    .highlight-container {
      font-family: inherit; font-size: 14px;
      padding: 8px 12px; margin-top: 8px;
      background: var(--vscode-editor-background, #1e1e1e);
      border-radius: 4px; white-space: pre-wrap; word-break: break-all;
    }
    .hl-match {
      background: rgba(78, 201, 176, 0.3);
      border-bottom: 2px solid var(--vscode-charts-green, #4ec9b0);
      border-radius: 2px;
    }
    .hl-rest { opacity: 0.5; }

    table.details { margin-top: 12px; border-collapse: collapse; width: 100%; }
    table.details td { padding: 4px 12px 4px 0; vertical-align: top; }
    table.details td:first-child {
      font-weight: 600; white-space: nowrap;
      color: var(--vscode-descriptionForeground, #aaa);
      width: 120px;
    }
    code {
      background: rgba(255,255,255,0.06); padding: 2px 5px; border-radius: 3px;
      font-size: 13px;
    }

    /* Flex behavior note */
    .flex-note {
      margin-top: 16px; padding: 10px 14px;
      background: var(--vscode-editorInfo-background, rgba(0,127,212,0.1));
      border-left: 3px solid var(--vscode-editorInfo-foreground, #3794ff);
      border-radius: 0 4px 4px 0; font-size: 12px;
    }
    .flex-note strong { color: var(--vscode-editorInfo-foreground, #3794ff); }

    /* All-matches list */
    .all-matches { margin-top: 12px; }
    .all-matches .match-item {
      display: flex; gap: 12px; padding: 4px 0;
      border-bottom: 1px solid var(--vscode-editorWidget-border, #333);
    }
    .all-matches .match-item:last-child { border-bottom: none; }
    .match-idx { color: var(--vscode-descriptionForeground, #888); min-width: 30px; }
  </style>
</head>
<body>
  <h2>Flex: Test Rule</h2>

  <div class="section">
    <label>Flex Pattern (regex)</label>
    <input type="text" id="pattern" value="${escPattern}" placeholder='e.g. [0-9]+  or  "while"  or  [a-zA-Z_][a-zA-Z0-9_]*' spellcheck="false" />
    <div class="help">
      Supports Flex syntax: character classes, <code>"literals"</code>, <code>{abbreviations}</code>,
      <code>.</code>, <code>|</code>, quantifiers. POSIX classes like <code>[:alpha:]</code> are approximated.
    </div>
  </div>

  <div class="section">
    <label>Test String</label>
    <input type="text" id="teststr" placeholder="Enter text to match against the pattern" spellcheck="false" />
  </div>

  <div id="result">
    <span style="opacity:0.5">Enter a pattern and test string to see results.</span>
  </div>

  <div class="flex-note">
    <strong>How Flex matches:</strong> Flex uses <em>leftmost longest match</em>.
    Among all rules whose pattern matches a prefix of the remaining input, Flex picks the one
    that matches the <strong>longest</strong> prefix. If two rules match the same length,
    the <strong>first rule</strong> in the file wins. This tester simulates that behavior.
  </div>

  <script>
  (function() {
    const patternEl = document.getElementById('pattern');
    const teststrEl = document.getElementById('teststr');
    const resultEl = document.getElementById('result');

    function escHtml(s) {
      return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    }

    /** Convert a Flex pattern to a JavaScript RegExp source string. */
    function flexToJs(pat) {
      var p = pat;
      // Handle Flex double-quoted literals: "..." -> escaped literal
      p = p.replace(/"([^"]*)"/g, function(_, s) {
        return s.replace(/[.*+?^{}$()|\\[\\]\\\\]/g, '\\\\$&');
      });
      // Replace {abbrev} references with a generic placeholder (word chars)
      p = p.replace(/[{]([a-zA-Z_][a-zA-Z0-9_]*)[}]/g, '[a-zA-Z0-9_]+');
      // POSIX character classes (inside [...])
      p = p.replace(/\\[:alpha:\\]/g, 'a-zA-Z');
      p = p.replace(/\\[:upper:\\]/g, 'A-Z');
      p = p.replace(/\\[:lower:\\]/g, 'a-z');
      p = p.replace(/\\[:digit:\\]/g, '0-9');
      p = p.replace(/\\[:alnum:\\]/g, 'a-zA-Z0-9');
      p = p.replace(/\\[:space:\\]/g, ' \\t\\n\\r');
      p = p.replace(/\\[:word:\\]/g, 'a-zA-Z0-9_');
      p = p.replace(/\\[:print:\\]/g, '\\x20-\\x7E');
      return p;
    }

    function runTest() {
      const pat = patternEl.value.trim();
      const testStr = teststrEl.value;

      if (!pat || testStr === '') {
        resultEl.innerHTML = '<span style="opacity:0.5">Enter a pattern and test string to see results.</span>';
        return;
      }

      let jsSource;
      try {
        jsSource = flexToJs(pat);
      } catch(e) {
        resultEl.innerHTML = '<span class="match-error">Invalid pattern: ' + escHtml(e.message) + '</span>';
        return;
      }

      let re;
      try {
        re = new RegExp(jsSource, 'g');
      } catch(e) {
        resultEl.innerHTML = '<span class="match-error">Regex error: ' + escHtml(e.message) + '</span>';
        return;
      }

      // Flex behavior: find the longest match starting at position 0
      // Also show all matches for reference
      const allMatches = [];
      let m;
      re.lastIndex = 0;
      while ((m = re.exec(testStr)) !== null) {
        allMatches.push({ index: m.index, text: m[0], length: m[0].length });
        if (m[0].length === 0) { re.lastIndex++; }
      }

      // Flex leftmost-longest: find the match at position 0 (if any)
      // Then simulate iterative tokenization
      let html = '';
      const anchoredRe = new RegExp(jsSource);
      const anchoredMatch = anchoredRe.exec(testStr);

      if (anchoredMatch && anchoredMatch.index === 0 && anchoredMatch[0].length > 0) {
        const matchText = anchoredMatch[0];
        const rest = testStr.slice(matchText.length);

        html += '<div class="match-yes" style="font-size:16px;font-weight:bold;">Match!</div>';

        // Highlighted string
        html += '<div class="highlight-container">';
        html += '<span class="hl-match">' + escHtml(matchText) + '</span>';
        if (rest) html += '<span class="hl-rest">' + escHtml(rest) + '</span>';
        html += '</div>';

        // Details table
        html += '<table class="details">';
        html += '<tr><td>yytext</td><td><code>' + escHtml(matchText) + '</code></td></tr>';
        html += '<tr><td>yyleng</td><td><code>' + matchText.length + '</code></td></tr>';
        html += '<tr><td>Position</td><td><code>0..' + (matchText.length - 1) + '</code></td></tr>';
        if (rest) {
          html += '<tr><td>Remaining</td><td><code>' + escHtml(rest.length > 60 ? rest.slice(0, 57) + '...' : rest) + '</code></td></tr>';
        }
        html += '</table>';
      } else {
        html += '<div class="match-no" style="font-size:16px;font-weight:bold;">No match at start of input</div>';
        html += '<div style="margin-top:8px;opacity:0.7">Flex requires the pattern to match a prefix of the remaining input (anchored at position 0).</div>';
      }

      // Show all matches in the string (for reference)
      if (allMatches.length > 0) {
        html += '<div class="all-matches">';
        html += '<label style="margin-top:14px;display:block">All matches in string (' + allMatches.length + ')</label>';
        // Build highlighted view
        let hlHtml = '<div class="highlight-container">';
        let cursor = 0;
        for (const am of allMatches) {
          if (am.index > cursor) {
            hlHtml += '<span class="hl-rest">' + escHtml(testStr.slice(cursor, am.index)) + '</span>';
          }
          hlHtml += '<span class="hl-match">' + escHtml(am.text) + '</span>';
          cursor = am.index + am.length;
        }
        if (cursor < testStr.length) {
          hlHtml += '<span class="hl-rest">' + escHtml(testStr.slice(cursor)) + '</span>';
        }
        hlHtml += '</div>';
        html += hlHtml;

        for (let i = 0; i < Math.min(allMatches.length, 20); i++) {
          const am = allMatches[i];
          html += '<div class="match-item">';
          html += '<span class="match-idx">#' + (i + 1) + '</span>';
          html += '<code>' + escHtml(am.text) + '</code>';
          html += '<span style="opacity:0.6">pos ' + am.index + '..' + (am.index + am.length - 1) + ', len ' + am.length + '</span>';
          html += '</div>';
        }
        if (allMatches.length > 20) {
          html += '<div style="opacity:0.6;padding:4px 0">...and ' + (allMatches.length - 20) + ' more</div>';
        }
        html += '</div>';
      }

      resultEl.innerHTML = html;
    }

    patternEl.addEventListener('input', runTest);
    teststrEl.addEventListener('input', runTest);
    // Run on load if pattern is pre-filled
    if (patternEl.value.trim()) { teststrEl.focus(); } else { patternEl.focus(); }
    runTest();
  })();
  </script>
</body>
</html>`;
}

/** Render the Bison Explain Conflict WebView. */
function renderExplainConflictHtml(data: {
  ruleName: string;
  conflictTokens: string[];
  alternatives: string[][];
  hasPrec: boolean;
  explanation: string;
  derivations: string[];
  fixes: Array<{ title: string; code: string; description: string }>;
}): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Explain Conflict — ${esc(data.ruleName)}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      background: var(--vscode-editor-background, #1e1e1e);
      color: var(--vscode-editor-foreground, #d4d4d4);
      font-family: var(--vscode-editor-font-family, 'Consolas', monospace);
      font-size: var(--vscode-editor-font-size, 13px);
      padding: 24px; line-height: 1.7;
    }
    h2 { color: var(--vscode-symbolIcon-classForeground, #4ec9b0); font-size: 18px; margin-bottom: 4px; }
    h3 { color: var(--vscode-symbolIcon-functionForeground, #dcdcaa); font-size: 14px; margin: 20px 0 8px; text-transform: uppercase; letter-spacing: 0.5px; }
    .badge {
      display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600;
      background: var(--vscode-editorWarning-background, rgba(255,153,0,0.2));
      color: var(--vscode-editorWarning-foreground, #ff9900);
      margin-left: 8px; vertical-align: middle;
    }
    .explanation {
      background: var(--vscode-editorWidget-background, #252526);
      border: 1px solid var(--vscode-editorWidget-border, #454545);
      border-radius: 6px; padding: 16px; margin: 12px 0;
    }
    .derivation {
      background: var(--vscode-editor-background, #1e1e1e);
      border-left: 3px solid var(--vscode-editorInfo-foreground, #3794ff);
      padding: 10px 16px; margin: 8px 0; font-size: 13px;
      white-space: pre-wrap;
    }
    .fix-card {
      background: var(--vscode-editorWidget-background, #252526);
      border: 1px solid var(--vscode-editorWidget-border, #454545);
      border-radius: 6px; padding: 14px 16px; margin: 10px 0;
    }
    .fix-card h4 { color: var(--vscode-charts-green, #4ec9b0); font-size: 13px; margin-bottom: 6px; }
    .fix-card p { font-size: 12px; opacity: 0.85; margin-bottom: 8px; }
    .fix-card pre {
      background: var(--vscode-editor-background, #1e1e1e);
      padding: 10px 14px; border-radius: 4px; overflow-x: auto;
      font-size: 12px; line-height: 1.5;
    }
    .token-list { display: flex; gap: 6px; flex-wrap: wrap; margin: 8px 0; }
    .token-chip {
      background: rgba(255,153,0,0.15); color: var(--vscode-editorWarning-foreground, #ff9900);
      padding: 2px 10px; border-radius: 12px; font-size: 12px; font-weight: 600;
    }
    .alt-list { margin: 8px 0; }
    .alt-item {
      padding: 4px 12px; margin: 4px 0;
      border-left: 2px solid var(--vscode-editorWidget-border, #555);
      font-size: 13px;
    }
  </style>
</head>
<body>
  <h2>${esc(data.ruleName)} <span class="badge">shift/reduce</span></h2>

  <h3>Conflicting Tokens</h3>
  <div class="token-list">
    ${data.conflictTokens.map(t => `<span class="token-chip">${esc(t)}</span>`).join('')}
  </div>

  <h3>Alternatives in this Rule</h3>
  <div class="alt-list">
    ${data.alternatives.map((a, i) => `<div class="alt-item"><strong>${i + 1}.</strong> ${esc(data.ruleName)} &rarr; ${esc(a.join(' ') || '%empty')}</div>`).join('')}
  </div>

  <h3>Why does this conflict exist?</h3>
  <div class="explanation">${esc(data.explanation)}</div>

  <h3>Ambiguous Derivations</h3>
  ${data.derivations.map(d => `<div class="derivation">${esc(d)}</div>`).join('')}

  <h3>How to Resolve</h3>
  ${data.fixes.map(f => `
    <div class="fix-card">
      <h4>${esc(f.title)}</h4>
      <p>${esc(f.description)}</p>
      <pre>${esc(f.code)}</pre>
    </div>
  `).join('')}
</body>
</html>`;
}

/** Generate tasks.json content for Bison/Flex projects. */
function generateTasksJson(
  bisonPath: string,
  flexPath: string,
  hasCMake: boolean,
  hasMakefile: boolean
): object {
  const tasks: object[] = [];

  // Bison compile task
  tasks.push({
    label: 'Bison: Compile',
    type: 'shell',
    command: bisonPath,
    args: ['-d', '${file}'],
    group: 'build',
    presentation: { reveal: 'always', panel: 'shared' },
    problemMatcher: {
      owner: 'bison',
      fileLocation: ['relative', '${fileDirname}'],
      pattern: {
        regexp: '^(.+?):(\\d+)\\.?(\\d+)?(?:-(\\d+)\\.?(\\d+)?)?:\\s*(error|warning|note):\\s*(.+)$',
        file: 1, line: 2, column: 3, severity: 6, message: 7,
      },
    },
  });

  // Flex compile task
  tasks.push({
    label: 'Flex: Compile',
    type: 'shell',
    command: flexPath,
    args: ['${file}'],
    group: 'build',
    presentation: { reveal: 'always', panel: 'shared' },
    problemMatcher: {
      owner: 'flex',
      fileLocation: ['relative', '${fileDirname}'],
      pattern: {
        regexp: '^"(.+?)",\\s*line\\s+(\\d+):\\s*(.+)$',
        file: 1, line: 2, message: 3,
      },
    },
  });

  if (hasCMake) {
    // CMake build
    tasks.push({
      label: 'CMake: Build',
      type: 'shell',
      command: 'cmake',
      args: ['--build', 'build', '--parallel'],
      group: { kind: 'build', isDefault: true },
      presentation: { reveal: 'always', panel: 'shared' },
      problemMatcher: '$gcc',
    });
    // CMake configure
    tasks.push({
      label: 'CMake: Configure',
      type: 'shell',
      command: 'cmake',
      args: ['-S', '.', '-B', 'build'],
      presentation: { reveal: 'always', panel: 'shared' },
      problemMatcher: [],
    });
    // Clean
    tasks.push({
      label: 'CMake: Clean',
      type: 'shell',
      command: 'cmake',
      args: ['--build', 'build', '--target', 'clean'],
      presentation: { reveal: 'always', panel: 'shared' },
      problemMatcher: [],
    });
  } else if (hasMakefile) {
    // Make build
    tasks.push({
      label: 'Make: Build',
      type: 'shell',
      command: 'make',
      args: [],
      group: { kind: 'build', isDefault: true },
      presentation: { reveal: 'always', panel: 'shared' },
      problemMatcher: '$gcc',
    });
    // Clean
    tasks.push({
      label: 'Make: Clean',
      type: 'shell',
      command: 'make',
      args: ['clean'],
      presentation: { reveal: 'always', panel: 'shared' },
      problemMatcher: [],
    });
  } else {
    // Generic build: bison + flex + gcc
    tasks.push({
      label: 'Build All (Bison + Flex + GCC)',
      type: 'shell',
      command: 'bash',
      args: [
        '-c',
        `${bisonPath} -d *.y && ${flexPath} *.l && gcc -o parser *.tab.c lex.yy.c -lfl`,
      ],
      group: { kind: 'build', isDefault: true },
      presentation: { reveal: 'always', panel: 'shared' },
      problemMatcher: '$gcc',
    });
    // Clean generated files
    tasks.push({
      label: 'Clean Generated Files',
      type: 'shell',
      command: 'bash',
      args: ['-c', 'rm -f *.tab.c *.tab.h lex.yy.c parser *.output'],
      presentation: { reveal: 'always', panel: 'shared' },
      problemMatcher: [],
    });
  }

  return {
    version: '2.0.0',
    tasks,
  };
}

/** Render the .output file content in a syntax-highlighted WebView. */
function renderParseTableHtml(content: string, baseName: string): string {
  // Escape HTML
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  // Colorize known patterns
  const colorized = esc(content)
    .split('\n')
    .map(line => {
      // State headers: "State N"
      if (/^State\s+\d+/.test(line)) {
        return `<span class="state-header">${line}</span>`;
      }
      // Conflict lines
      if (/conflict/.test(line)) {
        return `<span class="conflict">${line}</span>`;
      }
      // Rule lines (numbered): "  N rule: ..."
      if (/^\s+\d+\s+\S+:/.test(line)) {
        return `<span class="rule">${line}</span>`;
      }
      // Shift/reduce/goto actions
      if (/\b(shift|reduce|go to|accept)\b/.test(line)) {
        return line
          .replace(/\b(shift)\b/g, '<span class="shift">$1</span>')
          .replace(/\b(reduce)\b/g, '<span class="reduce">$1</span>')
          .replace(/\b(go to)\b/g, '<span class="goto">$1</span>')
          .replace(/\b(accept)\b/g, '<span class="accept">$1</span>');
      }
      // Section headers
      if (/^(Grammar|Terminals|Nonterminals|rules? useless|Automaton)/.test(line)) {
        return `<span class="section-header">${line}</span>`;
      }
      return line;
    })
    .join('\n');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Parse Table — ${esc(baseName)}</title>
  <style>
    body {
      font-family: var(--vscode-editor-font-family, 'Consolas', 'Courier New', monospace);
      font-size: var(--vscode-editor-font-size, 13px);
      color: var(--vscode-editor-foreground);
      background: var(--vscode-editor-background);
      padding: 16px;
      white-space: pre;
      line-height: 1.5;
    }
    .state-header {
      color: var(--vscode-symbolIcon-classForeground, #4ec9b0);
      font-weight: bold;
    }
    .section-header {
      color: var(--vscode-symbolIcon-namespaceForeground, #dcdcaa);
      font-weight: bold;
      font-size: 1.1em;
    }
    .rule {
      color: var(--vscode-symbolIcon-functionForeground, #569cd6);
    }
    .conflict {
      color: var(--vscode-editorWarning-foreground, #ff9900);
      font-weight: bold;
    }
    .shift { color: var(--vscode-charts-green, #4ec9b0); }
    .reduce { color: var(--vscode-charts-blue, #569cd6); }
    .goto { color: var(--vscode-charts-purple, #c586c0); }
    .accept { color: var(--vscode-charts-green, #6a9955); font-weight: bold; }
  </style>
</head>
<body>${colorized}</body>
</html>`;
}
