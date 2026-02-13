import * as fs from 'fs';
import * as path from 'path';

export function isFlutterProject(projectRoot: string): boolean {
  const pubspecPath = path.join(projectRoot, 'pubspec.yaml');
  try {
    const content = fs.readFileSync(pubspecPath, 'utf-8');
    return /^\s+flutter:\s*$/m.test(content) || /sdk:\s*flutter/m.test(content);
  } catch {
    return false;
  }
}
