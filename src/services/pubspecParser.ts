import { parseDocument, YAMLMap, isMap, isScalar, isPair } from 'yaml';
import type { PubspecModel, PubspecDependency, PubspecEdit } from '../models/pubspecModel';

export class PubspecParser {
  parse(text: string): PubspecModel {
    const doc = parseDocument(text);
    const map = doc.contents as YAMLMap;

    return {
      name: this.getString(map, 'name'),
      description: this.getString(map, 'description'),
      version: this.getString(map, 'version'),
      homepage: this.getString(map, 'homepage'),
      repository: this.getString(map, 'repository'),
      issueTracker: this.getString(map, 'issue_tracker'),
      publishTo: this.getString(map, 'publish_to'),
      environment: this.getEnvironment(map),
      dependencies: this.getDependencies(map, 'dependencies'),
      devDependencies: this.getDependencies(map, 'dev_dependencies'),
    };
  }

  applyEdits(originalText: string, edits: PubspecEdit[]): string {
    const doc = parseDocument(originalText, { keepSourceTokens: true });

    for (const edit of edits) {
      switch (edit.type) {
        case 'setField': {
          const parts = edit.path.split('.');
          if (parts.length === 2) {
            // Nested field like "environment.sdk"
            let parent = doc.get(parts[0]);
            if (!parent || !isMap(parent)) {
              if (edit.value === '') {break;}
              doc.set(parts[0], doc.createNode({}));
              parent = doc.get(parts[0]) as YAMLMap;
            }
            if (edit.value === '') {
              (parent as YAMLMap).delete(parts[1]);
            } else {
              (parent as YAMLMap).set(parts[1], edit.value);
            }
          } else {
            if (edit.value === '') {
              doc.delete(edit.path);
            } else {
              doc.set(edit.path, edit.value);
            }
          }
          break;
        }

        case 'setDependencyVersion': {
          const deps = doc.get(edit.section) as YAMLMap | undefined;
          if (deps && isMap(deps)) {
            deps.set(edit.name, edit.version);
          }
          break;
        }

        case 'addDependency': {
          let deps = doc.get(edit.section);
          if (!deps || !isMap(deps)) {
            doc.set(edit.section, doc.createNode({}));
            deps = doc.get(edit.section) as YAMLMap;
          }
          (deps as YAMLMap).set(edit.name, edit.version);
          break;
        }

        case 'removeDependency': {
          const deps = doc.get(edit.section) as YAMLMap | undefined;
          if (deps && isMap(deps)) {
            deps.delete(edit.name);
          }
          break;
        }
      }
    }

    return doc.toString();
  }

  private getString(map: YAMLMap, key: string): string | undefined {
    if (!map) {return undefined;}
    const val = map.get(key);
    if (val === undefined || val === null) {return undefined;}
    return String(val);
  }

  private getEnvironment(map: YAMLMap): Record<string, string> {
    const result: Record<string, string> = {};
    if (!map) {return result;}
    const env = map.get('environment');
    if (!env || !isMap(env)) {return result;}
    for (const pair of (env as YAMLMap).items) {
      if (isPair(pair) && isScalar(pair.key)) {
        result[String(pair.key.value)] = String(pair.value ?? '');
      }
    }
    return result;
  }

  private getDependencies(map: YAMLMap, section: string): PubspecDependency[] {
    const result: PubspecDependency[] = [];
    if (!map) {return result;}
    const deps = map.get(section);
    if (!deps || !isMap(deps)) {return result;}

    for (const pair of (deps as YAMLMap).items) {
      if (!isPair(pair) || !isScalar(pair.key)) {continue;}
      const name = String(pair.key.value);

      if (isScalar(pair.value)) {
        result.push({
          name,
          version: String(pair.value.value ?? 'any'),
          isComplex: false,
          source: 'hosted',
        });
      } else if (isMap(pair.value)) {
        const depMap = pair.value as YAMLMap;
        let source: PubspecDependency['source'] = 'hosted';
        let version = '';

        if (depMap.has('git')) {
          source = 'git';
          version = 'git';
        } else if (depMap.has('path')) {
          source = 'path';
          version = String(depMap.get('path') ?? '');
        } else if (depMap.has('sdk')) {
          source = 'sdk';
          version = String(depMap.get('sdk') ?? '');
        } else if (depMap.has('version')) {
          version = String(depMap.get('version') ?? 'any');
        }

        result.push({
          name,
          version,
          isComplex: source !== 'hosted',
          source,
        });
      } else {
        result.push({
          name,
          version: 'any',
          isComplex: false,
          source: 'hosted',
        });
      }
    }

    return result;
  }
}
