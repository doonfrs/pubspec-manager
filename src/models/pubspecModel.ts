export interface PubspecDependency {
  name: string;
  version: string;
  /** Raw value from YAML - could be a string version or complex (git, path, sdk) */
  isComplex: boolean;
  source?: 'hosted' | 'git' | 'path' | 'sdk';
}

export interface PubspecModel {
  name?: string;
  description?: string;
  version?: string;
  homepage?: string;
  repository?: string;
  issueTracker?: string;
  publishTo?: string;
  environment: Record<string, string>;
  dependencies: PubspecDependency[];
  devDependencies: PubspecDependency[];
}

export interface VersionInfo {
  current: string;
  latest: string;
  description: string;
  status: 'up-to-date' | 'outdated-minor' | 'outdated-major' | 'unknown';
}

export interface PackageSearchResult {
  name: string;
  version: string;
  description: string;
  score: number;
  likes: number;
  points: number;
  downloads: number;
}

export type PubspecEdit =
  | { type: 'setField'; path: string; value: string }
  | { type: 'setDependencyVersion'; section: 'dependencies' | 'dev_dependencies'; name: string; version: string }
  | { type: 'addDependency'; section: 'dependencies' | 'dev_dependencies'; name: string; version: string }
  | { type: 'removeDependency'; section: 'dependencies' | 'dev_dependencies'; name: string };
