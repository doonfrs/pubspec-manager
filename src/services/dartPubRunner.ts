import * as cp from 'child_process';
import * as path from 'path';
import * as vscode from 'vscode';
import { isFlutterProject } from '../utils/detectProjectType';

export class DartPubRunner {
  private projectRoot: string;
  private useFlutter: boolean;

  constructor(pubspecUri: vscode.Uri) {
    this.projectRoot = path.dirname(pubspecUri.fsPath);
    this.useFlutter = isFlutterProject(this.projectRoot);
  }

  private get command(): string {
    return this.useFlutter ? 'flutter' : 'dart';
  }

  async pubGet(): Promise<string> {
    return this.run(`${this.command} pub get`);
  }

  async pubAdd(packageName: string, isDev: boolean): Promise<string> {
    const devFlag = isDev ? ' --dev' : '';
    return this.run(`${this.command} pub add${devFlag} ${packageName}`);
  }

  async pubRemove(packageName: string): Promise<string> {
    return this.run(`${this.command} pub remove ${packageName}`);
  }

  async pubOutdated(): Promise<string> {
    return this.run(`${this.command} pub outdated`);
  }

  private run(command: string): Promise<string> {
    return new Promise((resolve, reject) => {
      cp.exec(
        command,
        { cwd: this.projectRoot, timeout: 60000 },
        (err, stdout, stderr) => {
          if (err) {
            reject(new Error(stderr || err.message));
            return;
          }
          resolve(stdout);
        }
      );
    });
  }
}
