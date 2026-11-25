// Publishes the site on GitHub Pages. It builds dist/ and pushes its contents as the
// gh-pages branch, the folder GitHub Pages serves. The main branch keeps the sources and
// is not touched: the published commit is made directly, without a checkout or a stash.
//
// Needs a GitHub repository as the "origin" remote, and uses your usual git credentials.
//
// Usage: node tools/deploy.mjs
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkImports, projectRoot, stage } from './stage.mjs';

const out = stage();
const { missing } = checkImports(out);
if (missing.length) {
  console.error(`Nothing was published. The built site is incomplete:\n  ${missing.join('\n  ')}`);
  process.exit(1);
}

// `quiet` keeps git's own complaints out of the way when a failure is expected.
const git = (args, { cwd = projectRoot, env = process.env, quiet = false } = {}) =>
  execFileSync('git', args, { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', quiet ? 'pipe' : 'inherit'] }).trim();

const remote = git(['remote', 'get-url', 'origin'], { quiet: true });
const repository = /github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?\/?$/i.exec(remote ?? '');
if (!repository) {
  console.error('The "origin" remote is not a GitHub repository, so there is nowhere to publish.');
  process.exit(1);
}
const site = `https://${repository[1].toLowerCase()}.github.io/${repository[2]}/`;

// GitHub Pages would otherwise run Jekyll over the files. This tells it to serve them as is.
writeFileSync(join(out, '.nojekyll'), '');

const scratch = mkdtempSync(join(tmpdir(), 'quadro-ar-deploy-'));
try {
  const env = { ...process.env, GIT_INDEX_FILE: join(scratch, 'index') };
  // -f: no ignore rule may hide a file from the published copy.
  // --work-tree: dist/ itself is the root of what gets published. Without it, git would
  // file everything under a "dist/" folder and GitHub Pages would find no page at the root.
  git(['--work-tree', out, '-c', 'core.safecrlf=false', 'add', '-A', '-f', '.'], { cwd: out, env });
  const tree = git(['write-tree'], { env });
  if (!git(['ls-tree', '--name-only', tree]).split('\n').includes('index.html')) {
    throw new Error('index.html is not at the root of the published folder.');
  }

  let parent = '';
  try {
    git(['fetch', '--quiet', 'origin', 'gh-pages'], { quiet: true });
    parent = git(['rev-parse', '--verify', '--quiet', 'origin/gh-pages'], { quiet: true });
  } catch {
    // First publication: there is no gh-pages branch to continue from yet.
  }

  const source = git(['rev-parse', '--short', 'HEAD']);
  const commit = git(['commit-tree', tree, '-m', `Site published from main ${source}`, ...(parent ? ['-p', parent] : [])]);
  git(['push', '--quiet', 'origin', `${commit}:refs/heads/gh-pages`]);
  console.log(`Pushed the site to the gh-pages branch (commit ${commit.slice(0, 7)}).`);
} catch (error) {
  console.error(`Nothing was published: ${error.message.split('\n').filter(Boolean).slice(-3).join('\n')}`);
  process.exitCode = 1;
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

if (!process.exitCode) console.log(`It is at ${site}  (the first publication can take a few minutes)`);
