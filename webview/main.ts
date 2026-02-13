import type { PubspecModel, VersionInfo } from '../src/models/pubspecModel';

interface PackageSearchResult {
  name: string;
  version: string;
  description: string;
  likes: number;
  points: number;
}

type InMessage =
  | { type: 'documentUpdated'; data: PubspecModel }
  | { type: 'outdatedInfo'; data: Record<string, VersionInfo> }
  | { type: 'searchResults'; data: PackageSearchResult[] }
  | { type: 'searchLoading'; loading: boolean }
  | { type: 'loadingVersions'; loading: boolean }
  | { type: 'operationStarted'; operation: string }
  | { type: 'operationCompleted'; operation: string }
  | { type: 'error'; message: string };

// Acquire VS Code API
const vscode = acquireVsCodeApi();

let currentModel: PubspecModel | null = null;
let versionInfo: Record<string, VersionInfo> = {};
let activeTab = 'dependencies';
let activeFilter: 'all' | 'deps' | 'dev' | 'outdated' = 'all';
let depsSearchText = '';
let searchResults: PackageSearchResult[] = [];
let isSearchLoading = false;
let isLoadingVersions = false;

function post(message: Record<string, unknown>): void {
  vscode.postMessage(message);
}

function render(): void {
  const app = document.getElementById('app');
  if (!app) {return;}

  if (!currentModel) {
    app.innerHTML = `
      <div class="loading-container">
        <div class="loading-spinner"></div>
        <p>Loading Pubspec Manager...</p>
      </div>`;
    return;
  }

  app.innerHTML = `
    ${renderToolbar()}
    ${renderTabs()}
    <div class="tab-content">
      ${activeTab === 'dependencies' ? renderDependencies() : ''}
      ${activeTab === 'metadata' ? renderMetadata() : ''}
      ${activeTab === 'search' ? renderSearch() : ''}
    </div>
    <div id="toast" class="toast hidden"></div>
  `;

  attachEventListeners();
}

function renderToolbar(): string {
  return `
    <div class="toolbar">
      <div class="toolbar-title">
        <span class="codicon codicon-package"></span>
        <span>Pubspec Manager</span>
        ${currentModel?.name ? `<span class="toolbar-project-name">— ${escapeHtml(currentModel.name)}</span>` : ''}
      </div>
      <div class="toolbar-actions">
        <button class="icon-button" id="btn-refresh" title="Refresh">
          <span class="codicon codicon-refresh"></span>
        </button>
        <button class="icon-button" id="btn-pub-get" title="Run pub get">
          <span class="codicon codicon-cloud-download"></span>
          <span>Pub Get</span>
        </button>
      </div>
    </div>`;
}

function renderTabs(): string {
  const totalDeps = currentModel ? currentModel.dependencies.length + currentModel.devDependencies.length : 0;
  const tabs = [
    { id: 'dependencies', label: 'Dependencies', icon: 'codicon-library', badge: totalDeps },
    { id: 'metadata', label: 'Metadata', icon: 'codicon-info', badge: 0 },
    { id: 'search', label: 'Search pub.dev', icon: 'codicon-search', badge: 0 },
  ];

  return `
    <div class="tabs">
      ${tabs.map((tab) => `
        <button class="tab ${activeTab === tab.id ? 'tab-active' : ''}" data-tab="${tab.id}">
          <span class="codicon ${tab.icon}"></span>
          <span>${tab.label}</span>
          ${tab.badge > 0 ? `<span class="tab-badge">${tab.badge}</span>` : ''}
        </button>
      `).join('')}
    </div>`;
}

function renderMetadata(): string {
  if (!currentModel) {return '';}
  const m = currentModel;

  const fields = [
    { key: 'name', label: 'Name', value: m.name ?? '', placeholder: 'my_app' },
    { key: 'description', label: 'Description', value: m.description ?? '', placeholder: 'A Dart/Flutter project' },
    { key: 'version', label: 'Version', value: m.version ?? '', placeholder: '1.0.0' },
    { key: 'homepage', label: 'Homepage', value: m.homepage ?? '', placeholder: 'https://example.com' },
    { key: 'repository', label: 'Repository', value: m.repository ?? '', placeholder: 'https://github.com/...' },
    { key: 'issue_tracker', label: 'Issue Tracker', value: m.issueTracker ?? '', placeholder: 'https://github.com/.../issues' },
    { key: 'publish_to', label: 'Publish To', value: m.publishTo ?? '', placeholder: 'https://pub.dev (leave empty for default)' },
  ];

  const envFields = Object.entries(m.environment).map(([key, value]) => ({
    key,
    label: key === 'sdk' ? 'Dart SDK' : key === 'flutter' ? 'Flutter SDK' : key,
    value,
    placeholder: key === 'sdk' ? '>=3.0.0 <4.0.0' : '>=3.10.0',
  }));

  return `
    <div class="section">
      <h2 class="section-title">Package Information</h2>
      <div class="form-grid">
        ${fields.map((f) => `
          <div class="form-field">
            <label for="field-${f.key}">${f.label}</label>
            <input type="text" id="field-${f.key}" class="input metadata-input"
              data-field="${f.key}" value="${escapeAttr(f.value)}" placeholder="${f.placeholder}">
          </div>
        `).join('')}
      </div>
    </div>
    <div class="section">
      <h2 class="section-title">Environment / SDK Constraints</h2>
      <div class="form-grid">
        ${envFields.map((f) => `
          <div class="form-field">
            <label for="env-${f.key}">${f.label}</label>
            <input type="text" id="env-${f.key}" class="input env-input"
              data-env-key="${f.key}" value="${escapeAttr(f.value)}" placeholder="${f.placeholder}">
          </div>
        `).join('')}
      </div>
    </div>`;
}

interface TaggedDep {
  dep: PubspecModel['dependencies'][0];
  section: 'dependencies' | 'dev_dependencies';
}

function getFilteredDeps(): TaggedDep[] {
  if (!currentModel) {return [];}

  let items: TaggedDep[] = [];

  const deps = currentModel.dependencies.map((dep) => ({ dep, section: 'dependencies' as const }));
  const devDeps = currentModel.devDependencies.map((dep) => ({ dep, section: 'dev_dependencies' as const }));

  switch (activeFilter) {
    case 'all':
      items = [...deps, ...devDeps];
      break;
    case 'deps':
      items = deps;
      break;
    case 'dev':
      items = devDeps;
      break;
    case 'outdated':
      items = [...deps, ...devDeps].filter(({ dep }) => {
        const info = versionInfo[dep.name];
        return info && (info.status === 'outdated-minor' || info.status === 'outdated-major');
      });
      break;
  }

  if (depsSearchText) {
    const q = depsSearchText.toLowerCase();
    items = items.filter(({ dep }) => dep.name.toLowerCase().includes(q));
  }

  return items;
}

function renderPackageCard(dep: PubspecModel['dependencies'][0], section: 'dependencies' | 'dev_dependencies'): string {
  const info = versionInfo[dep.name];
  const statusClass = info ? `status-${info.status}` : '';
  const isOutdated = info && (info.status === 'outdated-minor' || info.status === 'outdated-major');

  return `
    <div class="package-card ${statusClass}">
      <div class="package-main">
        <div class="package-name-row">
          <span class="package-name">${escapeHtml(dep.name)}</span>
          ${section === 'dev_dependencies' ? '<span class="badge badge-dev">dev</span>' : ''}
          ${dep.isComplex ? `<span class="badge badge-source">${dep.source}</span>` : ''}
          ${info ? renderVersionBadge(info) : ''}
        </div>
        <div class="package-version">
          <span class="version-current">${escapeHtml(dep.version)}</span>
          ${isOutdated && info ? `<span class="version-arrow">→</span><span class="version-latest">${escapeHtml(info.latest)}</span>` : ''}
        </div>
      </div>
      <div class="package-actions">
        ${info?.description ? `<span class="icon-button" title="${escapeAttr(info.description)}">
          <span class="codicon codicon-info"></span>
        </span>` : ''}
        ${isOutdated && !dep.isComplex ? `<button class="icon-button action-update" data-name="${escapeAttr(dep.name)}" data-section="${section}" title="Update to latest">
          <span class="codicon codicon-cloud-download"></span>
        </button>` : ''}
        <a class="icon-button" href="https://pub.dev/packages/${encodeURIComponent(dep.name)}" title="View on pub.dev" data-action="open-link" data-url="https://pub.dev/packages/${encodeURIComponent(dep.name)}">
          <span class="codicon codicon-link-external"></span>
        </a>
        <button class="icon-button action-remove" data-name="${escapeAttr(dep.name)}" data-section="${section}" title="Remove package">
          <span class="codicon codicon-trash"></span>
        </button>
      </div>
    </div>`;
}

function renderVersionBadge(info: VersionInfo): string {
  switch (info.status) {
    case 'up-to-date':
      return '<span class="badge badge-uptodate">up to date</span>';
    case 'outdated-minor':
      return '<span class="badge badge-minor">minor update</span>';
    case 'outdated-major':
      return '<span class="badge badge-major">major update</span>';
    default:
      return '';
  }
}

function renderDependencies(): string {
  if (!currentModel) {return '';}

  const allDeps = currentModel.dependencies.length + currentModel.devDependencies.length;
  const outdatedCount = [...currentModel.dependencies, ...currentModel.devDependencies].filter((d) => {
    const info = versionInfo[d.name];
    return info && (info.status === 'outdated-minor' || info.status === 'outdated-major');
  }).length;

  const filters: Array<{ id: typeof activeFilter; label: string; count: number }> = [
    { id: 'all', label: 'All', count: allDeps },
    { id: 'deps', label: 'Dependencies', count: currentModel.dependencies.length },
    { id: 'dev', label: 'Dev', count: currentModel.devDependencies.length },
    { id: 'outdated', label: 'Update Available', count: outdatedCount },
  ];

  const filtered = getFilteredDeps();

  return `
    <div class="section">
      <div class="filter-bar">
        <div class="filter-tags">
          ${filters.map((f) => `
            <button class="filter-tag ${activeFilter === f.id ? 'filter-tag-active' : ''}" data-filter="${f.id}">
              ${f.label}
              <span class="filter-tag-count">${f.count}</span>
            </button>
          `).join('')}
        </div>
        <div class="filter-right">
          <div class="filter-search">
            <span class="codicon codicon-search filter-search-icon"></span>
            <input type="text" id="deps-search" class="input filter-search-input" placeholder="Filter..." value="${escapeAttr(depsSearchText)}">
          </div>
          ${outdatedCount > 0 ? `<button class="button button-secondary button-small" id="btn-update-all">
            <span class="codicon codicon-cloud-download"></span> Update All
          </button>` : ''}
        </div>
      </div>
      ${isLoadingVersions ? '<div class="version-loading"><div class="loading-spinner small"></div> Checking versions...</div>' : ''}
      ${filtered.length === 0 ? `
        <div class="empty-state">
          <span class="codicon codicon-package"></span>
          <p>${activeFilter === 'outdated' ? 'All packages are up to date' : 'No packages found'}</p>
          ${allDeps === 0 ? '<button class="button button-primary" data-action="go-search">Search pub.dev to add packages</button>' : ''}
        </div>` : `
        <div class="deps-list">
          ${filtered.map(({ dep, section }) => renderPackageCard(dep, section)).join('')}
        </div>`}
    </div>`;
}

function renderSearch(): string {
  return `
    <div class="section">
      <div class="search-bar">
        <input type="text" id="search-input" class="input search-input" placeholder="Search packages on pub.dev..." value="">
        <button class="button button-primary" id="btn-search">
          <span class="codicon codicon-search"></span> Search
        </button>
      </div>
      ${isSearchLoading ? `
        <div class="loading-container small">
          <div class="loading-spinner"></div>
          <p>Searching pub.dev...</p>
        </div>` : ''}
      ${!isSearchLoading && searchResults.length > 0 ? `
        <div class="search-results">
          ${searchResults.map((pkg) => renderSearchResult(pkg)).join('')}
        </div>` : ''}
      ${!isSearchLoading && searchResults.length === 0 ? `
        <div class="empty-state">
          <span class="codicon codicon-search"></span>
          <p>Search for packages on pub.dev</p>
        </div>` : ''}
    </div>`;
}

function renderSearchResult(pkg: PackageSearchResult): string {
  const alreadyAdded = currentModel?.dependencies.some((d) => d.name === pkg.name) ||
    currentModel?.devDependencies.some((d) => d.name === pkg.name);

  return `
    <div class="search-result-card">
      <div class="search-result-main">
        <div class="search-result-header">
          <span class="package-name">${escapeHtml(pkg.name)}</span>
          <span class="version-latest">${escapeHtml(pkg.version)}</span>
          ${alreadyAdded ? '<span class="badge badge-uptodate">added</span>' : ''}
        </div>
        <p class="search-result-description">${escapeHtml(pkg.description)}</p>
        <div class="search-result-stats">
          <span class="stat"><span class="codicon codicon-heart"></span> ${pkg.likes}</span>
          <span class="stat"><span class="codicon codicon-star"></span> ${pkg.points} pts</span>
        </div>
      </div>
      ${!alreadyAdded ? `
        <div class="search-result-actions">
          <button class="button button-primary button-small" data-action="add-dep" data-name="${escapeAttr(pkg.name)}" data-version="${escapeAttr(pkg.version)}">
            Add
          </button>
          <button class="button button-secondary button-small" data-action="add-dev-dep" data-name="${escapeAttr(pkg.name)}" data-version="${escapeAttr(pkg.version)}">
            Add Dev
          </button>
        </div>` : ''}
    </div>`;
}

function attachEventListeners(): void {
  // Tab switching
  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      activeTab = (tab as HTMLElement).dataset.tab || 'metadata';
      render();
    });
  });

  // Toolbar buttons
  document.getElementById('btn-refresh')?.addEventListener('click', () => {
    post({ type: 'refresh' });
  });

  document.getElementById('btn-pub-get')?.addEventListener('click', () => {
    post({ type: 'pubGet' });
  });

  // Metadata inputs (debounced)
  document.querySelectorAll('.metadata-input').forEach((input) => {
    let timeout: ReturnType<typeof setTimeout>;
    input.addEventListener('input', () => {
      clearTimeout(timeout);
      timeout = setTimeout(() => {
        const field = (input as HTMLInputElement).dataset.field!;
        const value = (input as HTMLInputElement).value;
        post({
          type: 'edit',
          edits: [{ type: 'setField', path: field, value }],
        });
      }, 500);
    });
  });

  // Environment inputs (debounced)
  document.querySelectorAll('.env-input').forEach((input) => {
    let timeout: ReturnType<typeof setTimeout>;
    input.addEventListener('input', () => {
      clearTimeout(timeout);
      timeout = setTimeout(() => {
        const key = (input as HTMLInputElement).dataset.envKey!;
        const value = (input as HTMLInputElement).value;
        // Environment edits need special handling - edit the nested field
        post({
          type: 'edit',
          edits: [{ type: 'setField', path: `environment.${key}`, value }],
        });
      }, 500);
    });
  });

  // Update buttons
  document.querySelectorAll('.action-update').forEach((btn) => {
    btn.addEventListener('click', () => {
      const el = btn as HTMLElement;
      post({
        type: 'updatePackage',
        name: el.dataset.name,
        section: el.dataset.section,
      });
    });
  });

  // Remove buttons
  document.querySelectorAll('.action-remove').forEach((btn) => {
    btn.addEventListener('click', () => {
      const el = btn as HTMLElement;
      const name = el.dataset.name;
      if (confirm(`Remove ${name}?`)) {
        post({
          type: 'removePackage',
          name,
          section: el.dataset.section,
        });
      }
    });
  });

  // Filter tags
  document.querySelectorAll('.filter-tag').forEach((tag) => {
    tag.addEventListener('click', () => {
      activeFilter = (tag as HTMLElement).dataset.filter as typeof activeFilter || 'all';
      render();
    });
  });

  // Deps text filter
  const depsSearchInput = document.getElementById('deps-search') as HTMLInputElement;
  depsSearchInput?.addEventListener('input', () => {
    depsSearchText = depsSearchInput.value;
    render();
    // Re-focus and restore cursor position after render
    const input = document.getElementById('deps-search') as HTMLInputElement;
    if (input) {
      input.focus();
      input.selectionStart = input.selectionEnd = depsSearchInput.selectionStart ?? input.value.length;
    }
  });

  // Update all button
  document.getElementById('btn-update-all')?.addEventListener('click', () => {
    post({ type: 'updateAll' });
  });

  // Search
  const searchInput = document.getElementById('search-input') as HTMLInputElement;
  document.getElementById('btn-search')?.addEventListener('click', () => {
    if (searchInput?.value.trim()) {
      post({ type: 'search', query: searchInput.value.trim() });
    }
  });

  searchInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && searchInput.value.trim()) {
      post({ type: 'search', query: searchInput.value.trim() });
    }
  });

  // Add package buttons
  document.querySelectorAll('[data-action="add-dep"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const el = btn as HTMLElement;
      post({
        type: 'addPackage',
        name: el.dataset.name,
        version: el.dataset.version,
        section: 'dependencies',
      });
    });
  });

  document.querySelectorAll('[data-action="add-dev-dep"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const el = btn as HTMLElement;
      post({
        type: 'addPackage',
        name: el.dataset.name,
        version: el.dataset.version,
        section: 'dev_dependencies',
      });
    });
  });

  // Go to search tab
  document.querySelectorAll('[data-action="go-search"]').forEach((btn) => {
    btn.addEventListener('click', () => {
      activeTab = 'search';
      render();
    });
  });

  // Open external links
  document.querySelectorAll('[data-action="open-link"]').forEach((el) => {
    el.addEventListener('click', (e) => {
      e.preventDefault();
      // Links in webviews can't be clicked directly, but VS Code handles them
    });
  });
}

function showToast(message: string, isError = false): void {
  const toast = document.getElementById('toast');
  if (!toast) {return;}
  toast.textContent = message;
  toast.className = `toast ${isError ? 'toast-error' : 'toast-success'}`;
  setTimeout(() => { toast.className = 'toast hidden'; }, 3000);
}

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function escapeAttr(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Message handler
window.addEventListener('message', (event) => {
  const message = event.data as InMessage;

  switch (message.type) {
    case 'documentUpdated':
      currentModel = message.data;
      render();
      break;
    case 'outdatedInfo':
      versionInfo = message.data;
      render();
      break;
    case 'searchResults':
      searchResults = message.data;
      render();
      break;
    case 'searchLoading':
      isSearchLoading = message.loading;
      render();
      break;
    case 'loadingVersions':
      isLoadingVersions = message.loading;
      render();
      break;
    case 'operationStarted':
      showToast(message.operation);
      break;
    case 'operationCompleted':
      showToast(message.operation);
      break;
    case 'error':
      showToast(message.message, true);
      break;
  }
});

// Signal ready
post({ type: 'ready' });
