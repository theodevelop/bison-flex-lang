import * as path from 'path';
import * as cp from 'child_process';
import {
  ExtensionContext,
  workspace,
  window,
  commands,
  DiagnosticCollection,
  Diagnostic as VDiagnostic,
  DiagnosticSeverity as VDiagnosticSeverity,
  Range as VRange,
  Uri,
  ViewColumn,
  WebviewPanel,
} from 'vscode';
import { renderFlexTestRuleHtml } from '../webviews/flexTestPanel';

let flexTestRulePanel: WebviewPanel | undefined;

export function registerFlexCommands(
  context: ExtensionContext,
  compilerDiagnostics: DiagnosticCollection
): void {

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

  // ── Command: Flex: Test Rule ────────────────────────────────────────────────
  context.subscriptions.push(
    commands.registerCommand('bisonFlex.flexTestRule', () => {
      const editor = window.activeTextEditor;
      if (!editor || editor.document.languageId !== 'flex') {
        window.showWarningMessage('Open a Flex file (.l, .ll) to test rules.');
        return;
      }

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
