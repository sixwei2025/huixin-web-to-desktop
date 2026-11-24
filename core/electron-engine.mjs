import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

function generateElectronMainCjs(spec) {
  const configJson = JSON.stringify(
    {
      name: spec.name,
      slug: spec.slug,
      bundleId: spec.bundleId,
      mode: spec.mode,
      url: spec.mode === 'url' ? spec.url : '',
      width: spec.width,
      height: spec.height,
      minWidth: spec.minWidth,
      minHeight: spec.minHeight,
      hideTitlebar: Boolean(spec.hideTitlebar),
      alwaysOnTop: Boolean(spec.alwaysOnTop),
      tray: Boolean(spec.tray),
      userAgent: spec.userAgent || '',
      customCSS: spec.customCSS || '',
      customJS: spec.customJS || '',
      openExternalLinks: spec.openExternalLinks !== false,
      local:
        spec.mode === 'local'
          ? {
              kind: spec.localKind || 'static',
              startCommand: spec.startCommand || '',
              healthPath: spec.healthPath || '/',
              workDir: spec.copyMode === 'reference' ? spec.localWorkDir || spec.localEntryDir : '',
            }
          : null,
    },
    null,
    2
  );

  return `const { app, BrowserWindow, Menu, Tray, shell, nativeImage } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const { spawn } = require('node:child_process');

const CONFIG = ${configJson};

let mainWindow = null;
let tray = null;
let staticServer = null;
let childProc = null;
let activeOrigin = '';

function findFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      srv.close(() => resolve(addr.port));
    });
    srv.on('error', reject);
  });
}

function getMime(ext) {
  const map = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.mjs': 'application/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.woff2': 'font/woff2',
    '.wasm': 'application/wasm',
  };
  return map[ext.toLowerCase()] || 'application/octet-stream';
}

async function startStaticServer(rootDir) {
  const port = await findFreePort();
  staticServer = http.createServer((req, res) => {
    const rawPath = (req.url || '/').split('?')[0];
    const cleanRel = decodeURIComponent(rawPath).replace(/^\\/+/, '');
    let filePath = path.resolve(rootDir, cleanRel || 'index.html');
    if (!filePath.startsWith(path.resolve(rootDir))) {
      res.writeHead(403);
      return res.end('Forbidden');
    }
    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      filePath = path.join(rootDir, 'index.html');
    }
    if (!fs.existsSync(filePath)) {
      res.writeHead(404);
      return res.end('Not Found');
    }
    res.writeHead(200, { 'Content-Type': getMime(path.extname(filePath)) });
    fs.createReadStream(filePath).pipe(res);
  });
  await new Promise((resolve) => staticServer.listen(port, '127.0.0.1', resolve));
  return \`http://127.0.0.1:\${port}/\`;
}

async function startCommandServer(localCfg) {
  const port = await findFreePort();
  const dataDir = path.join(app.getPath('userData'), 'data');
  fs.mkdirSync(dataDir, { recursive: true });
  const workDir = localCfg.workDir || path.join(process.resourcesPath, 'app-payload');
  childProc = spawn(localCfg.startCommand, {
    cwd: fs.existsSync(workDir) ? workDir : __dirname,
    shell: true,
    env: {
      ...process.env,
      PORT: String(port),
      HUIXIN_PORT: String(port),
      HUIXIN_DATA_DIR: dataDir,
      DATA_DIR: dataDir,
    },
    stdio: 'ignore',
  });
  const healthPath = localCfg.healthPath.startsWith('/') ? localCfg.healthPath : '/' + localCfg.healthPath;
  const targetUrl = \`http://127.0.0.1:\${port}\${healthPath}\`;
  const deadline = Date.now() + 25000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(targetUrl);
      if (res.status >= 200 && res.status < 500) return targetUrl;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  return targetUrl;
}

async function createWindow() {
  let targetUrl = CONFIG.url;
  if (CONFIG.mode === 'local' && CONFIG.local) {
    if (CONFIG.local.kind === 'static') {
      const siteDir = fs.existsSync(path.join(process.resourcesPath, 'site'))
        ? path.join(process.resourcesPath, 'site')
        : path.join(__dirname, 'site');
      targetUrl = await startStaticServer(siteDir);
    } else {
      targetUrl = await startCommandServer(CONFIG.local);
    }
  }
  try {
    activeOrigin = new URL(targetUrl).origin;
  } catch {}

  mainWindow = new BrowserWindow({
    title: CONFIG.name,
    width: CONFIG.width || 1280,
    height: CONFIG.height || 840,
    minWidth: CONFIG.minWidth || 640,
    minHeight: CONFIG.minHeight || 480,
    alwaysOnTop: Boolean(CONFIG.alwaysOnTop),
    titleBarStyle: CONFIG.hideTitlebar ? 'hiddenInset' : 'default',
    webPreferences: {
      partition: \`persist:\${CONFIG.slug}\`,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  if (CONFIG.userAgent) {
    mainWindow.webContents.setUserAgent(CONFIG.userAgent);
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (CONFIG.openExternalLinks && activeOrigin && !url.startsWith(activeOrigin)) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    mainWindow.loadURL(url);
    return { action: 'deny' };
  });

  mainWindow.webContents.on('did-finish-load', () => {
    if (CONFIG.customCSS) mainWindow.webContents.insertCSS(CONFIG.customCSS);
    if (CONFIG.customJS) mainWindow.webContents.executeJavaScript(CONFIG.customJS).catch(() => {});
  });

  mainWindow.on('close', (e) => {
    if (CONFIG.tray && !app.isQuiting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });

  await mainWindow.loadURL(targetUrl);

  if (CONFIG.tray) {
    const iconPath = path.join(__dirname, 'build', 'icon.png');
    const img = fs.existsSync(iconPath)
      ? nativeImage.createFromPath(iconPath).resize({ width: 18, height: 18 })
      : nativeImage.createEmpty();
    tray = new Tray(img);
    tray.setToolTip(CONFIG.name);
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: \`显示 \${CONFIG.name}\`, click: () => mainWindow.show() },
        { label: '重新加载', click: () => mainWindow.reload() },
        { type: 'separator' },
        { label: '退出', click: () => { app.isQuiting = true; app.quit(); } },
      ])
    );
    tray.on('click', () => (mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show()));
  }
}

app.whenReady().then(createWindow);
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' && !CONFIG.tray) app.quit();
});
app.on('activate', () => {
  if (mainWindow) mainWindow.show();
  else createWindow();
});
app.on('before-quit', () => {
  app.isQuiting = true;
  if (staticServer) staticServer.close();
  if (childProc && !childProc.killed) childProc.kill();
});
`;
}

function generateGithubWorkflow(spec) {
  return `name: Build Desktop Installers (${spec.name})

on:
  workflow_dispatch:
  push:
    tags:
      - 'v*'

jobs:
  build:
    strategy:
      fail-fast: false
      matrix:
        include:
          - os: macos-latest
            cmd: npm run dist:mac
          - os: windows-latest
            cmd: npm run dist:win
          - os: ubuntu-latest
            cmd: npm run dist:linux

    runs-on: \${{ matrix.os }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
      - run: npm install
      - run: \${{ matrix.cmd }}
      - uses: actions/upload-artifact@v4
        with:
          name: installer-\${{ matrix.os }}
          path: |
            dist/*.dmg
            dist/*.exe
            dist/*.AppImage
            dist/*.deb
`;
}

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  const skip = new Set(['.git', '.DS_Store', '.venv', 'venv', '__pycache__']);
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (skip.has(entry.name)) continue;
    const s = path.join(src, entry.name);
    const d = path.join(dst, entry.name);
    if (entry.isDirectory()) copyDir(s, d);
    else if (entry.isFile()) fs.copyFileSync(s, d);
  }
}

export function buildElectronProject(spec, iconResult, log = () => {}) {
  const projectDir = path.join(spec.outputDir, `${spec.slug}-electron`);
  fs.mkdirSync(projectDir, { recursive: true });
  const buildDir = path.join(projectDir, 'build');
  fs.mkdirSync(buildDir, { recursive: true });

  if (iconResult.pngPath && fs.existsSync(iconResult.pngPath)) {
    fs.copyFileSync(iconResult.pngPath, path.join(buildDir, 'icon.png'));
  }
  if (iconResult.icnsPath && fs.existsSync(iconResult.icnsPath)) {
    fs.copyFileSync(iconResult.icnsPath, path.join(buildDir, 'icon.icns'));
  }

  const extraResources = [];
  if (spec.mode === 'local' && spec.copyMode !== 'reference') {
    const subName = (spec.localKind || 'static') === 'static' ? 'site' : 'app-payload';
    log(`正在复制本地项目文件到 Electron 工程: ${subName}/`);
    copyDir(spec.localEntryDir, path.join(projectDir, subName));
    extraResources.push({ from: subName, to: subName });
  }

  const pkg = {
    name: spec.slug,
    version: spec.version || '1.0.0',
    description: `${spec.name} — Generated by 汇芯网页转桌面 (huixin-web-to-desktop)`,
    main: 'main.cjs',
    scripts: {
      start: 'electron .',
      'dist:mac': 'electron-builder --mac dmg',
      'dist:win': 'electron-builder --win nsis --x64',
      'dist:linux': 'electron-builder --linux AppImage deb --x64',
    },
    build: {
      appId: spec.bundleId,
      productName: spec.name,
      compression: 'maximum',
      directories: { output: 'dist' },
      files: ['main.cjs', 'build/icon.png', 'package.json'],
      extraResources,
      mac: {
        icon: 'build/icon.icns',
        target: ['dmg'],
        identity: null,
      },
      win: {
        icon: 'build/icon.png',
        target: ['nsis'],
      },
      linux: {
        icon: 'build/icon.png',
        target: ['AppImage', 'deb'],
      },
    },
    devDependencies: {
      electron: '^35.0.0',
      'electron-builder': '^26.18.0',
    },
  };

  fs.writeFileSync(path.join(projectDir, 'package.json'), JSON.stringify(pkg, null, 2), 'utf8');
  fs.writeFileSync(path.join(projectDir, 'main.cjs'), generateElectronMainCjs(spec), 'utf8');

  const wfDir = path.join(projectDir, '.github', 'workflows');
  fs.mkdirSync(wfDir, { recursive: true });
  fs.writeFileSync(path.join(wfDir, 'build-desktop.yml'), generateGithubWorkflow(spec), 'utf8');

  log(`已生成完整 Electron 跨平台工程（含 Mac/Win/Linux 三端 GitHub Actions 云打包配置）: ${projectDir}`);

  if (spec.buildElectron) {
    log('检测到 --build 参数，正在安装 Electron 依赖并构建本机安装包...');
    execFileSync('npm', ['install'], { cwd: projectDir, stdio: 'inherit' });
    const distScript =
      process.platform === 'darwin'
        ? 'dist:mac'
        : process.platform === 'win32'
          ? 'dist:win'
          : 'dist:linux';
    execFileSync('npm', ['run', distScript], { cwd: projectDir, stdio: 'inherit' });
  }

  return {
    engine: 'electron',
    outputPath: projectDir,
    dmgPath: null,
    installedPath: null,
    sizeBytes: 0,
    sizeLabel: 'Electron 跨平台工程（含 Win/Mac/Linux 配置）',
  };
}
