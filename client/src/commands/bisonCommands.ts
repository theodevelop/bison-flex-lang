import * as path from 'path';
import * as cp from 'child_process';
import * as fs from 'fs';
import {
  ExtensionContext,
  workspace,
  window,
  commands,
  DiagnosticCollection,
  Diagnostic as VDiagnostic,
  DiagnosticSeverity as VDiagnosticSeverity,
  Range as VRange,
  Position as VPosition,
  Uri,
  ViewColumn,
  WebviewPanel,
  StatusBarItem,
  StatusBarAlignment,
} from 'vscode';
import { LanguageClient } from 'vscode-languageclient/node';
import { renderParseTableHtml } from '../webviews/parseTablePanel';
import { renderGrammarGraphHtml, GrammarGraphData } from '../webviews/grammarGraphPanel';
import { renderExplainConflictHtml, ExplainConflictData } from '../webviews/explainConflictPanel';

let parseTablePanel: WebviewPanel | undefined;
let grammarGraphPanel: WebviewPanel | undefined;
let explainConflictPanel: WebviewPanel | undefined;

export function registerBisonCommands(
  context: ExtensionContext,
  client: LanguageClient,
  compilerDiagnostics: DiagnosticCollection
): void {

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

      const graphData = result as GrammarGraphData;

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

  // ── Command: Bison: Explain Conflict ──────────────────────────────────────
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

      const data = result as ExplainConflictData;

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
}

/**
 * Parse compiler output (bison/flex) into VS Code diagnostics.
 * Supports formats:
 *   file:line.col: error: message
 *   file:line.col-col: warning: message
 *   file:line: error: message
 *   "file", line N: message
 */
export function parseCompilerOutput(output: string, cwd: string): Map<Uri, VDiagnostic[]> {
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
