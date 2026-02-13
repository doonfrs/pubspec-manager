import * as esbuild from 'esbuild';
import * as fs from 'fs';
import * as path from 'path';

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

// Copy CSS to dist/webview
function copyCSS() {
  const src = 'webview/styles/main.css';
  const dest = 'dist/webview/main.css';
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}

/** @type {esbuild.BuildOptions} */
const extensionConfig = {
  entryPoints: ['src/extension.ts'],
  bundle: true,
  format: 'cjs',
  platform: 'node',
  outfile: 'dist/extension.js',
  external: ['vscode'],
  sourcemap: !production,
  minify: production,
  tsconfig: 'tsconfig.json',
};

/** @type {esbuild.BuildOptions} */
const webviewConfig = {
  entryPoints: ['webview/main.ts'],
  bundle: true,
  format: 'iife',
  platform: 'browser',
  outfile: 'dist/webview/main.js',
  sourcemap: !production,
  minify: production,
  tsconfig: 'tsconfig.webview.json',
};

async function main() {
  if (watch) {
    const ctx1 = await esbuild.context(extensionConfig);
    const ctx2 = await esbuild.context(webviewConfig);
    await Promise.all([ctx1.watch(), ctx2.watch()]);
    copyCSS();
    console.log('Watching for changes...');
  } else {
    await Promise.all([
      esbuild.build(extensionConfig),
      esbuild.build(webviewConfig),
    ]);
    copyCSS();
    console.log(production ? 'Production build complete.' : 'Build complete.');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
