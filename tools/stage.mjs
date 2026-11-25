// Builds dist/: only what the site needs to run, nothing more. That is the folder to
// upload to any static host, and what the GitHub Pages workflow publishes.
//
// Usage: node tools/stage.mjs
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const INCLUDE = ['index.html', 'robots.txt', 'src', 'vendor', 'assets'];
// Left out on purpose: the image the target was compiled from, the MindAR build that
// only the target compiler uses, and the libraries' readmes.
const SKIP = [
  /^assets[\\/]target-source\./,
  /^vendor[\\/]mind-ar[\\/]mindar-image\.prod\.js$/,
  /\.md$/i,
];

// Follows every local file the page pulls in, directly, through static and dynamic
// imports, and through the asset paths written in src/config.js. Reports what is missing.
export function checkImports(out) {
  const html = readFileSync(join(out, 'index.html'), 'utf8');
  const importMap = JSON.parse(/<script type="importmap">([\s\S]*?)<\/script>/.exec(html)[1]).imports;

  const locate = (specifier, from) => {
    if (specifier.startsWith('.')) return join(dirname(from), specifier);
    if (specifier.startsWith('/')) return join(out, specifier);
    // A bare specifier goes through the import map: an exact name, or a prefix.
    const prefix = Object.keys(importMap).find((key) => key.endsWith('/') && specifier.startsWith(key));
    const path = importMap[specifier] ?? (prefix ? importMap[prefix] + specifier.slice(prefix.length) : null);
    return path ? join(out, path) : null;
  };

  const missing = [];
  const reached = new Set();
  const note = (from, specifier) => missing.push(`${relative(out, from).split('\\').join('/')} asks for ${specifier}`);
  const visit = (file) => {
    if (reached.has(file)) return;
    reached.add(file);
    const code = readFileSync(file, 'utf8');
    let specifiers;
    if (file.endsWith('.html')) {
      specifiers = [...code.matchAll(/\b(?:src|href)="(\.\/[^"]+)"/g)].map((match) => match[1]);
    } else {
      // "from './x'", "import './x'" and "import('./x')", the last one being a dynamic import.
      specifiers = [...code.matchAll(/\b(?:from|import)\s*\(?\s*["']([^"']+)["']/g)].map((match) => match[1]);
      // Asset paths are plain strings in the site's own code, resolved from the page.
      if (relative(out, file).startsWith(`src${sep}`)) {
        for (const [, specifier] of code.matchAll(/["'](assets\/[^"']+)["']/g)) {
          const target = join(out, specifier);
          if (existsSync(target)) reached.add(target);
          else note(file, specifier);
        }
      }
    }
    for (const specifier of specifiers) {
      const target = locate(specifier, file);
      if (!target) continue; // unmapped bare specifier: the browser would refuse it as well
      if (!existsSync(target)) {
        note(file, specifier);
      } else if (/\.m?js$/.test(target)) {
        visit(target); // records the file and follows what it imports in turn
      } else {
        reached.add(target);
      }
    }
  };
  visit(join(out, 'index.html'));
  return { missing, reached };
}

export function stage({ root = projectRoot, out = join(root, 'dist') } = {}) {
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  for (const name of INCLUDE) {
    cpSync(join(root, name), join(out, name), {
      recursive: true,
      filter: (source) => !SKIP.some((pattern) => pattern.test(relative(root, source))),
    });
  }
  return out;
}

const walk = (dir) => readdirSync(dir).flatMap((name) => {
  const path = join(dir, name);
  return statSync(path).isDirectory() ? walk(path) : [path];
});

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const out = stage();
  const { missing, reached } = checkImports(out);
  if (missing.length) {
    console.error(`The built site is incomplete:\n  ${missing.join('\n  ')}`);
    process.exit(1);
  }
  const files = walk(out);
  const bytes = files.reduce((sum, file) => sum + statSync(file).size, 0);
  console.log(`Built ${relative(projectRoot, out)}: ${files.length} files, ${(bytes / 1048576).toFixed(1)} MB, `
    + `${reached.size} of them reached from index.html.`);
  for (const file of files.sort((a, b) => statSync(b).size - statSync(a).size).slice(0, 3)) {
    console.log(`  ${(statSync(file).size / 1048576).toFixed(2)} MB  ${relative(out, file).split('\\').join('/')}`);
  }
}
