/** Render the Flex Test Rule interactive WebView. */
export function renderFlexTestRuleHtml(initialPattern: string): string {
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
