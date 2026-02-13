import * as vscode from 'vscode';
import { PubspecEditorProvider } from './providers/pubspecEditorProvider';

export function activate(context: vscode.ExtensionContext) {
  const provider = new PubspecEditorProvider(context);

  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(
      PubspecEditorProvider.viewType,
      provider,
      {
        webviewOptions: { retainContextWhenHidden: true },
        supportsMultipleEditorsPerDocument: false,
      }
    )
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('pubspecManager.openEditor', (uri?: vscode.Uri) => {
      // uri is passed when invoked from explorer context menu
      const targetUri = uri ?? vscode.window.activeTextEditor?.document.uri;
      if (targetUri && targetUri.path.endsWith('pubspec.yaml')) {
        vscode.commands.executeCommand('vscode.openWith', targetUri, PubspecEditorProvider.viewType);
      } else {
        vscode.window.showInformationMessage('Open a pubspec.yaml file first.');
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('pubspecManager.refreshDependencies', () => {
      provider.sendRefreshToActivePanel();
    })
  );
}

export function deactivate() {}
