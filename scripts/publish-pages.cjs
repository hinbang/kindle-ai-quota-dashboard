'use strict';

/**
 * Publish dist/ to the gh-pages branch via the GitHub Contents API.
 *
 * Git pushes to github.com from this Mac are unreliable (HTTP/2 "empty reply"),
 * so publishing goes over the REST API instead: every file in dist/ is uploaded
 * one by one, reusing the current blob sha when the file already exists.
 *
 * Usage: node scripts/publish-pages.cjs [--dry-run]
 */

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { ROOT } = require('../src/lib/config.cjs');

const REPO = process.env.DASHBOARD_REPO || 'hinbang/kindle-ai-quota-dashboard';
const BRANCH = process.env.DASHBOARD_BRANCH || 'gh-pages';
const DIST = path.join(ROOT, 'dist');
const dryRun = process.argv.includes('--dry-run');

const FILES = [
  'index.html',
  'dashboard-runtime.js',
  'data.js',
  'data.json',
  'live-endpoint.js',
  '.nojekyll',
  'manifest.v2.json',
];

function gh(args, input) {
  const result = spawnSync('gh', args, {
    encoding: 'utf8',
    input,
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.error) throw new Error(`gh failed: ${result.error.message}`);
  return result;
}

function existingSha(name) {
  const result = gh(['api', `repos/${REPO}/contents/${name}?ref=${BRANCH}`]);
  if (result.status !== 0) return null;
  try {
    return JSON.parse(result.stdout).sha;
  } catch {
    return null;
  }
}

function publish(name) {
  const filePath = path.join(DIST, name);
  if (!fs.existsSync(filePath)) {
    process.stdout.write(`- ${name}: missing locally, skipped\n`);
    return false;
  }
  const content = fs.readFileSync(filePath);
  const local = content.toString('base64');
  const sha = existingSha(name);
  if (sha) {
    const current = gh(['api', `repos/${REPO}/contents/${name}?ref=${BRANCH}`, '--jq', '.content']);
    if (current.status === 0) {
      const remote = String(current.stdout).replace(/\s+/g, '');
      if (remote === local.replace(/\s+/g, '')) {
        process.stdout.write(`= ${name}: unchanged\n`);
        return true;
      }
    }
  }
  if (dryRun) {
    process.stdout.write(`~ ${name}: would upload (${content.length} bytes)\n`);
    return true;
  }
  const body = {
    message: `deploy: refresh ${name} (${new Date().toISOString().slice(0, 16)}Z)`,
    branch: BRANCH,
    content: local,
  };
  if (sha) body.sha = sha;
  const result = gh(['api', '--method', 'PUT', `repos/${REPO}/contents/${name}`, '--input', '-'], JSON.stringify(body));
  if (result.status !== 0) {
    process.stderr.write(`! ${name}: ${(result.stderr || result.stdout).trim()}\n`);
    return false;
  }
  process.stdout.write(`+ ${name}: uploaded (${content.length} bytes)\n`);
  return true;
}

function main() {
  if (!fs.existsSync(DIST)) throw new Error(`缺少 ${DIST}，先运行 npm run build`);
  process.stdout.write(`publish -> ${REPO}@${BRANCH}${dryRun ? ' (dry run)' : ''}\n`);
  let ok = true;
  for (const name of FILES) {
    if (!publish(name)) ok = false;
  }
  const packageFile = fs.readdirSync(DIST).find((name) => name.endsWith('.kpkg'));
  if (packageFile) {
    if (!publish(packageFile)) ok = false;
  }
  const host = REPO.split('/')[0];
  const repoName = REPO.split('/')[1];
  process.stdout.write(`\n${ok ? 'done' : 'finished with errors'} -> https://${host}.github.io/${repoName}/\n`);
  if (!ok) process.exitCode = 1;
}

if (require.main === module) main();

module.exports = { FILES, publish };
