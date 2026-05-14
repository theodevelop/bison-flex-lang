/** Render the .output file content in a syntax-highlighted WebView. */
export function renderParseTableHtml(content: string, baseName: string): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const colorized = esc(content)
    .split('\n')
    .map(line => {
      if (/^State\s+\d+/.test(line)) {
        return `<span class="state-header">${line}</span>`;
      }
      if (/conflict/.test(line)) {
        return `<span class="conflict">${line}</span>`;
      }
      if (/^\s+\d+\s+\S+:/.test(line)) {
        return `<span class="rule">${line}</span>`;
      }
      if (/\b(shift|reduce|go to|accept)\b/.test(line)) {
        return line
          .replace(/\b(shift)\b/g, '<span class="shift">$1</span>')
          .replace(/\b(reduce)\b/g, '<span class="reduce">$1</span>')
          .replace(/\b(go to)\b/g, '<span class="goto">$1</span>')
          .replace(/\b(accept)\b/g, '<span class="accept">$1</span>');
      }
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
