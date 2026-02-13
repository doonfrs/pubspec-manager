import * as vscode from 'vscode';
import { getNonce } from '../utils/getNonce';
import { PubspecParser } from '../services/pubspecParser';
import { PubDevApi } from '../services/pubDevApi';
import { DartPubRunner } from '../services/dartPubRunner';
import type { PubspecEdit, VersionInfo } from '../models/pubspecModel';

export class PubspecEditorProvider implements vscode.CustomTextEditorProvider {
  public static readonly viewType = 'pubspecManager.editor';

  private readonly parser = new PubspecParser();
  private readonly pubDevApi = new PubDevApi();
  private activePanel: vscode.WebviewPanel | undefined;
  private activeDocument: vscode.TextDocument | undefined;

  constructor(private readonly context: vscode.ExtensionContext) {}

  public sendRefreshToActivePanel(): void {
    if (this.activePanel && this.activeDocument) {
      this.pubDevApi.clearCache();
      this.sendDocumentUpdate(this.activePanel, this.activeDocument);
      this.fetchOutdatedInfo(this.activePanel, this.activeDocument);
    }
  }

  public async resolveCustomTextEditor(
    document: vscode.TextDocument,
    webviewPanel: vscode.WebviewPanel,
    _token: vscode.CancellationToken
  ): Promise<void> {
    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview'),
        vscode.Uri.joinPath(this.context.extensionUri, 'node_modules', '@vscode', 'codicons', 'dist'),
      ],
    };

    const scriptUri = webviewPanel.webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview', 'main.js')
    );
    const styleUri = webviewPanel.webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview', 'main.css')
    );

    webviewPanel.webview.html = this.getHtml(webviewPanel.webview, scriptUri, styleUri);

    this.activePanel = webviewPanel;
    this.activeDocument = document;

    // Send initial data when webview is ready
    const messageHandler = webviewPanel.webview.onDidReceiveMessage(async (message) => {
      switch (message.type) {
        case 'ready':
          this.sendDocumentUpdate(webviewPanel, document);
          this.fetchOutdatedInfo(webviewPanel, document);
          break;

        case 'edit':
          await this.applyEdits(document, message.edits as PubspecEdit[]);
          break;

        case 'updatePackage':
          await this.updatePackage(
            webviewPanel,
            document,
            message.name,
            message.section
          );
          break;

        case 'updateAll':
          await this.updateAllPackages(webviewPanel, document);
          break;

        case 'removePackage':
          await this.removePackage(document, message.name, message.section);
          break;

        case 'addPackage':
          await this.addPackage(document, message.name, message.version, message.section);
          break;

        case 'search':
          await this.searchPackages(webviewPanel, message.query);
          break;

        case 'pubGet':
          await this.runPubGet(webviewPanel, document);
          break;

        case 'refresh':
          this.pubDevApi.clearCache();
          this.sendDocumentUpdate(webviewPanel, document);
          this.fetchOutdatedInfo(webviewPanel, document);
          break;
      }
    });

    // Sync when the text document changes (e.g. from another editor)
    const changeSubscription = vscode.workspace.onDidChangeTextDocument((e) => {
      if (e.document.uri.toString() === document.uri.toString() && e.contentChanges.length > 0) {
        this.sendDocumentUpdate(webviewPanel, document);
      }
    });

    webviewPanel.onDidDispose(() => {
      messageHandler.dispose();
      changeSubscription.dispose();
      if (this.activePanel === webviewPanel) {
        this.activePanel = undefined;
        this.activeDocument = undefined;
      }
    });
  }

  private sendDocumentUpdate(panel: vscode.WebviewPanel, document: vscode.TextDocument): void {
    try {
      const model = this.parser.parse(document.getText());
      panel.webview.postMessage({ type: 'documentUpdated', data: model });
    } catch (e) {
      panel.webview.postMessage({
        type: 'error',
        message: `Failed to parse pubspec.yaml: ${e instanceof Error ? e.message : String(e)}`,
      });
    }
  }

  private async fetchOutdatedInfo(panel: vscode.WebviewPanel, document: vscode.TextDocument): Promise<void> {
    try {
      const model = this.parser.parse(document.getText());
      const allDeps = [
        ...model.dependencies.filter((d) => !d.isComplex),
        ...model.devDependencies.filter((d) => !d.isComplex),
      ];

      if (allDeps.length === 0) {return;}

      panel.webview.postMessage({ type: 'loadingVersions', loading: true });

      const packageInfoMap = await this.pubDevApi.batchGetPackageInfo(
        allDeps.map((d) => d.name)
      );

      const versionInfo: Record<string, VersionInfo> = {};
      for (const dep of allDeps) {
        const info = packageInfoMap.get(dep.name);
        if (!info || info.latestVersion === 'unknown') {
          versionInfo[dep.name] = { current: dep.version, latest: 'unknown', description: '', status: 'unknown' };
        } else {
          const currentClean = dep.version.replace(/[\^~>=<\s]/g, '').split(' ')[0];
          versionInfo[dep.name] = {
            current: dep.version,
            latest: info.latestVersion,
            description: info.description,
            status: this.compareVersions(currentClean, info.latestVersion),
          };
        }
      }

      panel.webview.postMessage({ type: 'outdatedInfo', data: versionInfo });
      panel.webview.postMessage({ type: 'loadingVersions', loading: false });
    } catch (e) {
      panel.webview.postMessage({ type: 'loadingVersions', loading: false });
      panel.webview.postMessage({
        type: 'error',
        message: `Failed to check versions: ${e instanceof Error ? e.message : String(e)}`,
      });
    }
  }

  private compareVersions(current: string, latest: string): VersionInfo['status'] {
    if (!current || !latest) {return 'unknown';}
    const cParts = current.split('.').map(Number);
    const lParts = latest.split('.').map(Number);

    if (cParts.length < 3 || lParts.length < 3) {return 'unknown';}
    if (isNaN(cParts[0]) || isNaN(lParts[0])) {return 'unknown';}

    if (cParts[0] === lParts[0] && cParts[1] === lParts[1] && cParts[2] === lParts[2]) {
      return 'up-to-date';
    }
    if (cParts[0] < lParts[0]) {return 'outdated-major';}
    return 'outdated-minor';
  }

  private async applyEdits(document: vscode.TextDocument, edits: PubspecEdit[]): Promise<void> {
    const newText = this.parser.applyEdits(document.getText(), edits);
    const edit = new vscode.WorkspaceEdit();
    edit.replace(
      document.uri,
      new vscode.Range(0, 0, document.lineCount, 0),
      newText
    );
    await vscode.workspace.applyEdit(edit);
  }

  private async updatePackage(
    panel: vscode.WebviewPanel,
    document: vscode.TextDocument,
    name: string,
    section: 'dependencies' | 'dev_dependencies'
  ): Promise<void> {
    try {
      panel.webview.postMessage({ type: 'operationStarted', operation: `Updating ${name}...` });
      const latest = await this.pubDevApi.getLatestVersion(name);
      await this.applyEdits(document, [
        { type: 'setDependencyVersion', section, name, version: `^${latest}` },
      ]);
      this.sendDocumentUpdate(panel, document);
      await this.fetchOutdatedInfo(panel, document);
      panel.webview.postMessage({ type: 'operationCompleted', operation: `Updated ${name} to ^${latest}` });
    } catch (e) {
      panel.webview.postMessage({
        type: 'error',
        message: `Failed to update ${name}: ${e instanceof Error ? e.message : String(e)}`,
      });
    }
  }

  private async updateAllPackages(panel: vscode.WebviewPanel, document: vscode.TextDocument): Promise<void> {
    try {
      panel.webview.postMessage({ type: 'operationStarted', operation: 'Updating all packages...' });
      const model = this.parser.parse(document.getText());
      const allHosted = [
        ...model.dependencies.filter((d) => !d.isComplex).map((d) => ({ ...d, section: 'dependencies' as const })),
        ...model.devDependencies.filter((d) => !d.isComplex).map((d) => ({ ...d, section: 'dev_dependencies' as const })),
      ];

      const packageInfoMap = await this.pubDevApi.batchGetPackageInfo(allHosted.map((d) => d.name));
      const edits: PubspecEdit[] = [];

      for (const dep of allHosted) {
        const info = packageInfoMap.get(dep.name);
        if (info && info.latestVersion !== 'unknown') {
          const currentClean = dep.version.replace(/[\^~>=<\s]/g, '').split(' ')[0];
          if (this.compareVersions(currentClean, info.latestVersion) !== 'up-to-date') {
            edits.push({ type: 'setDependencyVersion', section: dep.section, name: dep.name, version: `^${info.latestVersion}` });
          }
        }
      }

      if (edits.length > 0) {
        await this.applyEdits(document, edits);
        this.sendDocumentUpdate(panel, document);
        await this.fetchOutdatedInfo(panel, document);
      }
      panel.webview.postMessage({ type: 'operationCompleted', operation: `Updated ${edits.length} package(s)` });
    } catch (e) {
      panel.webview.postMessage({
        type: 'error',
        message: `Failed to update packages: ${e instanceof Error ? e.message : String(e)}`,
      });
    }
  }

  private async removePackage(
    document: vscode.TextDocument,
    name: string,
    section: 'dependencies' | 'dev_dependencies'
  ): Promise<void> {
    await this.applyEdits(document, [{ type: 'removeDependency', section, name }]);
  }

  private async addPackage(
    document: vscode.TextDocument,
    name: string,
    version: string,
    section: 'dependencies' | 'dev_dependencies'
  ): Promise<void> {
    await this.applyEdits(document, [
      { type: 'addDependency', section, name, version: `^${version}` },
    ]);
  }

  private async searchPackages(panel: vscode.WebviewPanel, query: string): Promise<void> {
    try {
      panel.webview.postMessage({ type: 'searchLoading', loading: true });
      const results = await this.pubDevApi.search(query);
      panel.webview.postMessage({ type: 'searchResults', data: results });
      panel.webview.postMessage({ type: 'searchLoading', loading: false });
    } catch (e) {
      panel.webview.postMessage({ type: 'searchLoading', loading: false });
      panel.webview.postMessage({
        type: 'error',
        message: `Search failed: ${e instanceof Error ? e.message : String(e)}`,
      });
    }
  }

  private async runPubGet(panel: vscode.WebviewPanel, document: vscode.TextDocument): Promise<void> {
    try {
      panel.webview.postMessage({ type: 'operationStarted', operation: 'Running pub get...' });
      const runner = new DartPubRunner(document.uri);
      await runner.pubGet();
      panel.webview.postMessage({ type: 'operationCompleted', operation: 'pub get completed' });
    } catch (e) {
      panel.webview.postMessage({
        type: 'error',
        message: `pub get failed: ${e instanceof Error ? e.message : String(e)}`,
      });
    }
  }

  private getHtml(webview: vscode.Webview, scriptUri: vscode.Uri, styleUri: vscode.Uri): string {
    const nonce = getNonce();
    const codiconsUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'node_modules', '@vscode/codicons', 'dist', 'codicon.css')
    );

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; font-src ${webview.cspSource};">
  <link rel="stylesheet" href="${styleUri}">
  <link rel="stylesheet" href="${codiconsUri}">
  <title>Pubspec Manager</title>
</head>
<body>
  <div id="app">
    <div class="loading-container">
      <div class="loading-spinner"></div>
      <p>Loading Pubspec Manager...</p>
    </div>
  </div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}
