#!/usr/bin/env node
/**
 * 自举脚本：使用「汇芯网页转桌面」自己的原生 WKWebView 引擎，
 * 把可视化工作台 + 核心打包引擎自包含封装成完全独立可分发的《汇芯网页转桌面.app》与 .dmg！
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { packDesktopApp } from '../core/packer.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');

function copyRecursive(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  const skip = new Set(['.git', '.DS_Store', 'node_modules', 'dist', 'out', '.tmp']);
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (skip.has(entry.name)) continue;
    const s = path.join(src, entry.name);
    const d = path.join(dst, entry.name);
    if (entry.isDirectory()) copyRecursive(s, d);
    else if (entry.isFile()) fs.copyFileSync(s, d);
  }
}

async function main() {
  const shouldInstall = process.argv.includes('--install');
  const outDir = path.join(REPO_ROOT, 'dist');
  const stageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hx-studio-stage-'));

  try {
    // 只打入运行时所需核心代码，保持整包极致轻量（~1.5MB）且 100% 自包含可分发
    for (const rel of ['package.json', 'LICENSE', 'bin', 'core', 'gui', 'templates']) {
      const src = path.join(REPO_ROOT, rel);
      const dst = path.join(stageDir, rel);
      if (fs.statSync(src).isDirectory()) copyRecursive(src, dst);
      else fs.copyFileSync(src, dst);
    }

    const result = await packDesktopApp(
      {
        name: '汇芯网页转桌面',
        slug: 'huixin-web-to-desktop-studio',
        bundleId: 'cn.huixin.web2desktop.studio',
        mode: 'local',
        engine: 'native',
        localDir: stageDir,
        localWorkDir: stageDir,
        localKind: 'command',
        copyMode: 'bundle',
        startCommand: 'node gui/server.mjs',
        healthPath: '/',
        width: 1240,
        height: 820,
        minWidth: 960,
        minHeight: 640,
        dmg: true,
        install: shouldInstall,
        outputDir: outDir,
        skipHistory: true,
      },
      (msg) => console.log(`[self-bootstrap] ${msg}`)
    );

    console.log('\n🎉 自包含桌面端 APP 自举打包完成：', result.outputPath);
    console.log('📦 应用体积：', result.sizeLabel);
    if (result.dmgPath) console.log('💿 安装镜像：', result.dmgPath);
    if (result.installedPath) console.log('🚀 已安装至：', result.installedPath);
  } finally {
    fs.rmSync(stageDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error('❌ 自举打包失败:', err);
  process.exit(1);
});
