import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..');
const SHELL_DIR = path.join(REPO_ROOT, 'templates', 'native-macos');
const SHELL_BIN = path.join(SHELL_DIR, 'WebShell.bin');
const BUILD_SCRIPT = path.join(SHELL_DIR, 'build_shell.sh');

function xmlEscape(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function copyFilteredDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  const skipNames = new Set(['.git', '.DS_Store', '.venv', 'venv', '__pycache__', '.pytest_cache']);
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (skipNames.has(entry.name)) continue;
    const s = path.join(src, entry.name);
    const d = path.join(dst, entry.name);
    if (entry.isDirectory()) {
      copyFilteredDir(s, d);
    } else if (entry.isFile()) {
      fs.copyFileSync(s, d);
    }
  }
}

function dirSizeBytes(dirPath) {
  let total = 0;
  const walk = (p) => {
    const st = fs.lstatSync(p);
    if (st.isDirectory()) {
      for (const name of fs.readdirSync(p)) {
        walk(path.join(p, name));
      }
    } else {
      total += st.size;
    }
  };
  walk(dirPath);
  return total;
}

export function ensureNativeShellBinary(log = () => {}) {
  if (process.platform !== 'darwin') {
    throw new Error('原生 WKWebView 极速引擎仅支持 macOS；Windows / Linux 请切换 Electron 跨平台引擎 (--engine electron)');
  }
  if (!fs.existsSync(SHELL_BIN)) {
    log('首次使用原生引擎，正在编译 240KB 轻量 WKWebView 核心壳...');
    execFileSync('bash', [BUILD_SCRIPT], { stdio: 'pipe' });
  }
  return SHELL_BIN;
}

export function buildNativeMacApp(spec, iconResult, log = () => {}) {
  const shellBin = ensureNativeShellBinary(log);

  const appBundleName = `${spec.name}.app`;
  const appPath = path.join(spec.outputDir, appBundleName);
  const contentsDir = path.join(appPath, 'Contents');
  const macosDir = path.join(contentsDir, 'MacOS');
  const resDir = path.join(contentsDir, 'Resources');

  fs.mkdirSync(spec.outputDir, { recursive: true });
  if (fs.existsSync(appPath)) {
    fs.rmSync(appPath, { recursive: true, force: true });
  }
  fs.mkdirSync(macosDir, { recursive: true });
  fs.mkdirSync(resDir, { recursive: true });

  // 1. Copy compiled native shell binary
  const execName = 'HuixinWebShell';
  const execPath = path.join(macosDir, execName);
  fs.copyFileSync(shellBin, execPath);
  fs.chmodSync(execPath, 0o755);

  // 2. Copy icon
  if (iconResult.icnsPath && fs.existsSync(iconResult.icnsPath)) {
    fs.copyFileSync(iconResult.icnsPath, path.join(resDir, 'AppIcon.icns'));
  }

  // 3. Handle local project payload if mode === 'local'
  let localPayload = null;
  if (spec.mode === 'local') {
    const localKind = spec.localKind || 'static';
    if (localKind === 'static' && spec.copyMode !== 'reference') {
      const targetSiteDir = path.join(resDir, 'site');
      log(`正在封装本地静态资源到应用内部: ${spec.localEntryDir}`);
      copyFilteredDir(spec.localEntryDir, targetSiteDir);
      localPayload = {
        kind: 'static',
        entryDir: 'site',
        workDir: '',
        startCommand: '',
        healthPath: spec.healthPath || '/',
        startupTimeoutSec: spec.startupTimeoutSec || 25,
      };
    } else if (localKind === 'static') {
      localPayload = {
        kind: 'static',
        entryDir: spec.localEntryDir,
        workDir: '',
        startCommand: '',
        healthPath: spec.healthPath || '/',
        startupTimeoutSec: spec.startupTimeoutSec || 25,
      };
    } else {
      // command mode
      let workDir = spec.localWorkDir || spec.localEntryDir;
      if (spec.copyMode === 'bundle') {
        const bundledAppDir = path.join(resDir, 'app');
        log(`正在封装本地全栈项目到应用内部: ${workDir}`);
        copyFilteredDir(workDir, bundledAppDir);
        workDir = 'app';
      }
      localPayload = {
        kind: 'command',
        entryDir: workDir,
        workDir,
        startCommand: spec.startCommand,
        healthPath: spec.healthPath || '/',
        startupTimeoutSec: spec.startupTimeoutSec || 25,
      };
    }
  }

  // 4. Write app-config.json
  const appConfig = {
    name: spec.name,
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
    local: localPayload,
  };
  fs.writeFileSync(path.join(resDir, 'app-config.json'), JSON.stringify(appConfig, null, 2), 'utf8');

  // 5. Write Info.plist
  const infoPlist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key>
  <string>zh_CN</string>
  <key>CFBundleDisplayName</key>
  <string>${xmlEscape(spec.name)}</string>
  <key>CFBundleExecutable</key>
  <string>${execName}</string>
  <key>CFBundleIconFile</key>
  <string>AppIcon</string>
  <key>CFBundleIdentifier</key>
  <string>${xmlEscape(spec.bundleId)}</string>
  <key>CFBundleInfoDictionaryVersion</key>
  <string>6.0</string>
  <key>CFBundleName</key>
  <string>${xmlEscape(spec.name)}</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>${xmlEscape(spec.version || '1.0.0')}</string>
  <key>CFBundleVersion</key>
  <string>1</string>
  <key>LSMinimumSystemVersion</key>
  <string>12.0</string>
  <key>NSHighResolutionCapable</key>
  <true/>
  <key>NSAppTransportSecurity</key>
  <dict>
    <key>NSAllowsArbitraryLoads</key>
    <true/>
  </dict>
</dict>
</plist>
`;
  fs.writeFileSync(path.join(contentsDir, 'Info.plist'), infoPlist, 'utf8');

  // 6. Ad-hoc codesign so macOS launches smoothly
  log('正在执行本地签名 (codesign)...');
  try {
    execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], { stdio: 'pipe' });
  } catch (err) {
    log(`⚠️ 本地签名警告（不影响本机运行）: ${err.message}`);
  }

  // 7. Optional DMG creation
  let dmgPath = null;
  if (spec.dmg) {
    dmgPath = path.join(spec.outputDir, `${spec.name}.dmg`);
    if (fs.existsSync(dmgPath)) fs.unlinkSync(dmgPath);
    const stageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hx-dmg-'));
    try {
      log('正在打包 .dmg 磁盘镜像（含 Applications 快捷方式）...');
      execFileSync('cp', ['-R', appPath, path.join(stageDir, appBundleName)], { stdio: 'pipe' });
      fs.symlinkSync('/Applications', path.join(stageDir, 'Applications'));
      execFileSync(
        'hdiutil',
        ['create', '-volname', spec.name, '-srcfolder', stageDir, '-ov', '-format', 'UDZO', dmgPath],
        { stdio: 'pipe' }
      );
    } finally {
      fs.rmSync(stageDir, { recursive: true, force: true });
    }
  }

  // 8. Optional install to /Applications
  let installedPath = null;
  if (spec.install) {
    installedPath = path.join('/Applications', appBundleName);
    log(`正在安装至 ${installedPath}...`);
    if (fs.existsSync(installedPath)) {
      fs.rmSync(installedPath, { recursive: true, force: true });
    }
    execFileSync('cp', ['-R', appPath, installedPath], { stdio: 'pipe' });
  }

  const sizeBytes = dirSizeBytes(appPath);
  return {
    engine: 'native',
    outputPath: appPath,
    dmgPath,
    installedPath,
    sizeBytes,
    sizeLabel: `${(sizeBytes / (1024 * 1024)).toFixed(2)} MB`,
  };
}
