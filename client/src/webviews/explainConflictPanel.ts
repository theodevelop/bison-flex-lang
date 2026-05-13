export interface ExplainConflictData {
  ruleName: string;
  conflictTokens: string[];
  alternatives: string[][];
  hasPrec: boolean;
  explanation: string;
  derivations: string[];
  fixes: Array<{ title: string; code: string; description: string }>;
}

/** Render the Bison Explain Conflict WebView. */
export function renderExplainConflictHtml(data: ExplainConflictData): string {
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
