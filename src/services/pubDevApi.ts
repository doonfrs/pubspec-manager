import * as https from 'https';

interface PubPackageResponse {
  name: string;
  latest: {
    version: string;
    pubspec: {
      name: string;
      description: string;
      homepage?: string;
      repository?: string;
    };
  };
}

interface PubScoreResponse {
  grantedPoints: number;
  maxPoints: number;
  likeCount: number;
  tags: string[];
}

interface PubSearchResponse {
  packages: Array<{ package: string }>;
  next?: string;
}

interface PubPackageMetricsResponse {
  score: PubScoreResponse;
  scorecard: {
    packageName: string;
    packageVersion: string;
  };
}

export interface PackageInfo {
  name: string;
  latestVersion: string;
  description: string;
}

export interface PackageSearchResult {
  name: string;
  version: string;
  description: string;
  likes: number;
  points: number;
}

interface CacheEntry<T> {
  data: T;
  expires: number;
}

export class PubDevApi {
  private cache = new Map<string, CacheEntry<unknown>>();
  private readonly CACHE_DURATION = 2 * 60 * 1000; // 2 minutes

  async search(query: string): Promise<PackageSearchResult[]> {
    const searchData = await this.get<PubSearchResponse>(
      `/api/search?q=${encodeURIComponent(query)}`
    );

    const results: PackageSearchResult[] = [];
    const fetchPromises = searchData.packages.slice(0, 15).map(async (pkg) => {
      try {
        const [info, metrics] = await Promise.all([
          this.getPackageInfo(pkg.package),
          this.getPackageMetrics(pkg.package),
        ]);
        return {
          name: pkg.package,
          version: info.latestVersion,
          description: info.description,
          likes: metrics?.likeCount ?? 0,
          points: metrics?.grantedPoints ?? 0,
        };
      } catch {
        return {
          name: pkg.package,
          version: '',
          description: '',
          likes: 0,
          points: 0,
        };
      }
    });

    const settled = await Promise.all(fetchPromises);
    results.push(...settled);
    return results;
  }

  async getPackageInfo(name: string): Promise<PackageInfo> {
    const data = await this.get<PubPackageResponse>(`/api/packages/${encodeURIComponent(name)}`);
    return {
      name: data.name,
      latestVersion: data.latest.version,
      description: data.latest.pubspec.description ?? '',
    };
  }

  async getLatestVersion(name: string): Promise<string> {
    const info = await this.getPackageInfo(name);
    return info.latestVersion;
  }

  async batchGetPackageInfo(names: string[]): Promise<Map<string, PackageInfo>> {
    const results = new Map<string, PackageInfo>();
    const batchSize = 5;

    for (let i = 0; i < names.length; i += batchSize) {
      const batch = names.slice(i, i + batchSize);
      const promises = batch.map(async (name) => {
        try {
          const info = await this.getPackageInfo(name);
          results.set(name, info);
        } catch {
          results.set(name, { name, latestVersion: 'unknown', description: '' });
        }
      });
      await Promise.all(promises);
    }

    return results;
  }

  private async getPackageMetrics(name: string): Promise<PubScoreResponse | null> {
    try {
      const data = await this.get<PubPackageMetricsResponse>(
        `/api/packages/${encodeURIComponent(name)}/metrics`
      );
      return data.score;
    } catch {
      return null;
    }
  }

  private get<T>(path: string): Promise<T> {
    const cached = this.cache.get(path);
    if (cached && Date.now() < cached.expires) {
      return Promise.resolve(cached.data as T);
    }

    return new Promise<T>((resolve, reject) => {
      const req = https.get(
        {
          hostname: 'pub.dev',
          path,
          headers: { 'Accept': 'application/json', 'User-Agent': 'pubspec-manager-vscode' },
        },
        (res) => {
          if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            this.get<T>(res.headers.location).then(resolve, reject);
            return;
          }

          let body = '';
          res.on('data', (chunk: Buffer) => { body += chunk.toString(); });
          res.on('end', () => {
            try {
              if (res.statusCode && res.statusCode >= 400) {
                reject(new Error(`HTTP ${res.statusCode}: ${body.substring(0, 200)}`));
                return;
              }
              const data = JSON.parse(body) as T;
              this.cache.set(path, { data, expires: Date.now() + this.CACHE_DURATION });
              resolve(data);
            } catch (e) {
              reject(e);
            }
          });
        }
      );
      req.on('error', reject);
      req.setTimeout(10000, () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });
    });
  }

  clearCache(): void {
    this.cache.clear();
  }
}
