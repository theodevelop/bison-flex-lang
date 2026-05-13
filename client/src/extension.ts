import * as path from 'path';
import {
  ExtensionContext,
  workspace,
  languages,
} from 'vscode';
import {
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
  TransportKind,
} from 'vscode-languageclient/node';
import { registerBisonCommands } from './commands/bisonCommands';
import { registerFlexCommands } from './commands/flexCommands';
import { registerNavigationCommands } from './commands/navigationCommands';

let client: LanguageClient;

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

  const compilerDiagnostics = languages.createDiagnosticCollection('bisonFlexCompiler');
  context.subscriptions.push(compilerDiagnostics);

  registerBisonCommands(context, client, compilerDiagnostics);
  registerFlexCommands(context, compilerDiagnostics);
  registerNavigationCommands(context);
}

export function deactivate(): Thenable<void> | undefined {
  if (!client) {
    return undefined;
  }
  return client.stop();
}
