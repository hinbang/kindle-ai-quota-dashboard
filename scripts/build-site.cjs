'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { ROOT } = require('../src/lib/config.cjs');
const { version } = require('../package.json');

const webDir = path.join(ROOT, 'web');
const stateDir = path.join(ROOT, 'state');
const distDir = path.join(ROOT, 'dist');
const releaseDir = path.join(ROOT, 'release');
const required = ['index.html', 'dashboard-runtime.js'];

for (const name of required) {
  const source = path.join(webDir, name);
  if (!fs.existsSync(source)) throw new Error(`缺少网页文件：${source}`);
}
for (const name of ['data.json', 'data.js']) {
  const source = path.join(stateDir, name);
  if (!fs.existsSync(source)) {
    throw new Error(`缺少 ${source}。先运行 npm run demo 或 npm run collect`);
  }
}

fs.rmSync(distDir, { recursive: true, force: true });
fs.mkdirSync(distDir, { recursive: true });
for (const name of required) {
  fs.copyFileSync(path.join(webDir, name), path.join(distDir, name));
}
for (const name of ['data.json', 'data.js']) {
  fs.copyFileSync(path.join(stateDir, name), path.join(distDir, name));
}
const endpoint = process.env.DASHBOARD_URL
  ? process.env.DASHBOARD_URL.replace(/\/+$/, '') + '/data.js'
  : 'data.js';
fs.writeFileSync(path.join(distDir, 'live-endpoint.js'),
  `window.DASH_LIVE_ENDPOINT = '${endpoint}';\n`, 'utf8');
fs.writeFileSync(path.join(distDir, '.nojekyll'), '', 'utf8');
const packageArtifact = path.join(releaseDir, `kindle-ai-quota-dashboard_${version}_kindlehf-kindlepw2.kpkg`);
const publicArtifact = path.join(distDir, `kindle-ai-quota-dashboard_${version}_kindlehf-kindlepw2.kpkg`);
if (!fs.existsSync(packageArtifact)) throw new Error(`缺少 ${packageArtifact}。先运行 npm run package:kindle`);
fs.copyFileSync(packageArtifact, publicArtifact);
const manifest = {
  manifest_version: 2,
  id: 'kindle-ai-quota-dashboard-repo',
  name: 'Kindle AI Quota Dashboard Repo',
  description: 'Kindle AI 额度中控台的 KPM 仓库',
  packages: {
    'kindle-ai-quota-dashboard': {
      name: 'AI 额度中控台',
      author: 'Community contributors',
      description: '在越狱 Kindle 上全屏显示自托管的 AI 额度页面。',
      artifacts: [{
        url: publicArtifact.split(path.sep).pop(),
        version: version.split('.').map(Number),
        dependencies: [],
        supported_platforms: ['kindlehf', 'kindlepw2'],
      }],
    },
  },
};
fs.writeFileSync(path.join(distDir, 'manifest.v2.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
