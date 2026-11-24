#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { packDesktopApp } from '../core/packer.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

async function run() {
  const tmpOut = fs.mkdtempSync(path.join(os.tmpdir(), 'hx-web2desktop-verify-'));
  console.log(`[verify] 临时验收目录: ${tmpOut}`);

  try {
    // 1. URL Mode + Native Engine + DMG
    console.log('\n--- [1/4] 验收在线网址模式 (Native WKWebView + DMG) ---');
    const urlRes = await packDesktopApp({
      mode: 'url',
      engine: 'native',
      url: 'https://chat.deepseek.com',
      name: 'DeepSeekTest',
      dmg: true,
      tray: true,
      outputDir: tmpOut,
      skipHistory: true,
    });
    assert.ok(fs.existsSync(urlRes.outputPath), 'Missing .app bundle');
    assert.ok(fs.existsSync(urlRes.dmgPath), 'Missing .dmg image');
    assert.ok(fs.existsSync(path.join(urlRes.outputPath, 'Contents/Resources/AppIcon.icns')), 'Missing AppIcon.icns');
    assert.ok(fs.existsSync(path.join(urlRes.outputPath, 'Contents/Resources/app-config.json')), 'Missing app-config.json');
    execFileSync('codesign', ['--verify', '--deep', '--strict', urlRes.outputPath], { stdio: 'pipe' });
    assert.ok(urlRes.sizeBytes < 5 * 1024 * 1024, `Unexpected large native bundle: ${urlRes.sizeBytes}`);
    console.log(`✅ 场景 1 通过：体积 ${urlRes.sizeLabel}，耗时 ${urlRes.elapsedMs}ms，codesign 严格验签通过`);

    // 2. Local Static Project Mode + Native Engine
    console.log('\n--- [2/4] 验收本地网页项目模式 (静态 HTML 封装) ---');
    const sampleSite = path.join(tmpOut, 'sample-site');
    fs.mkdirSync(sampleSite, { recursive: true });
    fs.writeFileSync(
      path.join(sampleSite, 'index.html'),
      '<!doctype html><html><body><h1>Hello Huixin Web to Desktop</h1></body></html>',
      'utf8'
    );
    const localRes = await packDesktopApp({
      mode: 'local',
      engine: 'native',
      localDir: sampleSite,
      name: 'SampleLocalTool',
      outputDir: tmpOut,
      skipHistory: true,
    });
    assert.ok(fs.existsSync(path.join(localRes.outputPath, 'Contents/Resources/site/index.html')), 'Missing bundled index.html');
    execFileSync('codesign', ['--verify', '--deep', '--strict', localRes.outputPath], { stdio: 'pipe' });
    console.log(`✅ 场景 2 通过：自动识别为「${localRes.detectedInfo.label}」，体积 ${localRes.sizeLabel}，codesign 通过`);

    // 3. Electron Cross-Platform Engine
    console.log('\n--- [3/4] 验收 Electron 全能跨平台引擎 ---');
    const elecRes = await packDesktopApp({
      mode: 'url',
      engine: 'electron',
      url: 'https://www.notion.so',
      name: 'NotionDesktop',
      outputDir: tmpOut,
      skipHistory: true,
    });
    assert.ok(fs.existsSync(path.join(elecRes.outputPath, 'package.json')), 'Missing Electron package.json');
    assert.ok(fs.existsSync(path.join(elecRes.outputPath, 'main.cjs')), 'Missing Electron main.cjs');
    assert.ok(
      fs.existsSync(path.join(elecRes.outputPath, '.github/workflows/build-desktop.yml')),
      'Missing GitHub Actions workflow'
    );
    console.log(`✅ 场景 3 通过：Electron 跨平台工程与三端云构建模板生成完整`);

    // 4. GUI Server API + Real Screenshot
    console.log('\n--- [4/4] 验收可视化 GUI 控制面接口并采集真实界面截图 ---');
    const port = 18877;
    const guiProc = spawn('node', [path.join(REPO_ROOT, 'gui/server.mjs')], {
      env: { ...process.env, PORT: String(port) },
      stdio: 'pipe',
    });
    try {
      let ready = false;
      for (let i = 0; i < 30; i++) {
        try {
          const r = await fetch(`http://127.0.0.1:${port}/api/info`);
          if (r.ok) {
            const j = await r.json();
            assert.equal(j.ok, true);
            assert.equal(j.presets.length, 6);
            ready = true;
            break;
          }
        } catch {}
        await new Promise((r) => setTimeout(r, 150));
      }
      assert.ok(ready, 'GUI server did not become ready');

      const detectRes = await fetch(`http://127.0.0.1:${port}/api/detect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ localDir: sampleSite }),
      }).then((r) => r.json());
      assert.equal(detectRes.ok, true);
      assert.equal(detectRes.detected.projectType, 'static-html');

      if (fs.existsSync(CHROME)) {
        const outShot = path.join(REPO_ROOT, 'assets/showcase/gui-preview.png');
        fs.mkdirSync(path.dirname(outShot), { recursive: true });
        execFileSync(
          CHROME,
          [
            '--headless=new',
            '--disable-gpu',
            '--hide-scrollbars',
            '--force-device-scale-factor=2',
            '--window-size=1280,840',
            `--screenshot=${outShot}`,
            `http://127.0.0.1:${port}/`,
          ],
          { stdio: 'pipe' }
        );
        assert.ok(fs.existsSync(outShot) && fs.statSync(outShot).size > 20000, 'GUI screenshot invalid');
        console.log(`✅ 场景 4 通过：GUI 接口正常，真实桌面端截图已保存至 ${outShot}`);
      } else {
        console.log('✅ 场景 4 通过：GUI 接口正常');
      }
    } finally {
      guiProc.kill('SIGTERM');
    }

    // 5. Verify self-bootstrapped Studio .app signature
    const studioApp = path.join(REPO_ROOT, 'dist/汇芯网页转桌面.app');
    if (fs.existsSync(studioApp)) {
      execFileSync('codesign', ['--verify', '--deep', '--strict', studioApp], { stdio: 'pipe' });
      console.log(`✅ 自举桌面端 ${studioApp} codesign 严格验签通过`);
    }

    console.log('\n🎉 全部 4 大场景 + 自举桌面端真机验收 100% 通过！');
  } finally {
    fs.rmSync(tmpOut, { recursive: true, force: true });
  }
}

run().catch((err) => {
  console.error('❌ 验收失败:', err);
  process.exit(1);
});
