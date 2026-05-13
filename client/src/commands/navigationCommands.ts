import * as path from 'path';
import * as fs from 'fs';
import {
  ExtensionContext,
  workspace,
  window,
  commands,
  Uri,
  Position as VPosition,
  Range as VRange,
  Selection,
  TextEditorRevealType,
} from 'vscode';
import { isGeneratedFile, showInSource, showInGenerated } from '../lineDirectiveNavigation';

export function registerNavigationCommands(context: ExtensionContext): void {

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
            editor.selection = new Selection(pos, pos);
            commands.executeCommand('references-view.findReferences');
          });
        });
      });
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

      const hasCMake = fs.existsSync(path.join(wsRoot, 'CMakeLists.txt'));
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

      const base = path.basename(fileName, path.extname(fileName));
      const defaultTarget = base.charAt(0).toUpperCase() + base.slice(1);
      const targetName = await window.showInputBox({
        prompt: 'CMake target name',
        value: defaultTarget,
        validateInput: v => /^\w+$/.test(v) ? undefined : 'Target name must be alphanumeric/underscore',
      });
      if (!targetName) return;

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

      const cmakePath = path.join(cmakeDir, 'CMakeLists.txt');
      fs.appendFileSync(cmakePath, snippet, 'utf-8');

      const cmakeDoc = await workspace.openTextDocument(Uri.file(cmakePath));
      const cmakeEditor = await window.showTextDocument(cmakeDoc, { preview: false });
      const lastLine = cmakeDoc.lineCount - 1;
      cmakeEditor.revealRange(
        new VRange(lastLine, 0, lastLine, 0),
        TextEditorRevealType.InCenter
      );

      window.showInformationMessage(
        `${macro}(${targetName} ...) added to CMakeLists.txt.`
      );
      void outExt; // suppress unused variable lint
    })
  );
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
    tasks.push({
      label: 'CMake: Build',
      type: 'shell',
      command: 'cmake',
      args: ['--build', 'build', '--parallel'],
      group: { kind: 'build', isDefault: true },
      presentation: { reveal: 'always', panel: 'shared' },
      problemMatcher: '$gcc',
    });
    tasks.push({
      label: 'CMake: Configure',
      type: 'shell',
      command: 'cmake',
      args: ['-S', '.', '-B', 'build'],
      presentation: { reveal: 'always', panel: 'shared' },
      problemMatcher: [],
    });
    tasks.push({
      label: 'CMake: Clean',
      type: 'shell',
      command: 'cmake',
      args: ['--build', 'build', '--target', 'clean'],
      presentation: { reveal: 'always', panel: 'shared' },
      problemMatcher: [],
    });
  } else if (hasMakefile) {
    tasks.push({
      label: 'Make: Build',
      type: 'shell',
      command: 'make',
      args: [],
      group: { kind: 'build', isDefault: true },
      presentation: { reveal: 'always', panel: 'shared' },
      problemMatcher: '$gcc',
    });
    tasks.push({
      label: 'Make: Clean',
      type: 'shell',
      command: 'make',
      args: ['clean'],
      presentation: { reveal: 'always', panel: 'shared' },
      problemMatcher: [],
    });
  } else {
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
