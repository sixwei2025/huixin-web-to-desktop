import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { detectLocalProject } from './detect.mjs';
import { prepareAppIcon } from './icon.mjs';
import { buildNativeMacApp } from './native-engine.mjs';
import { buildElectronProject } from './electron-engine.mjs';
import { addHistoryRecord } from './history.mjs';

export function makeSlug(input) {
  const ascii = String(input || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (ascii.length >= 2) return ascii.slice(0, 32);
  const hash = crypto.createHash('md5').update(String(input || Date.now())).digest('hex').slice(0, 8);
  return `app-${hash}`;
}

export function inferNameFromUrl(urlStr) {
  try {
    const u = new URL(urlStr);
    const host = u.hostname.replace(/^www\./, '');
    const first = host.split('.')[0] || 'WebApp';
    return first.charAt(0).toUpperCase() + first.slice(1);
  } catch {
    return 'WebApp';
  }
}

/**
 * 统一双引擎打包入口（同时服务 CLI、GUI 与 AI Skill）
 */
export async function packDesktopApp(options, onLog = () => {}) {
  const startedAt = Date.now();
  const mode = options.mode === 'local' ? 'local' : 'url';
  const engine = options.engine === 'electron' ? 'electron' : 'native';

  let name = (options.name || '').trim();
  let url = (options.url || '').trim();
  let localEntryDir = options.localDir ? path.resolve(options.localDir) : '';
  let localKind = options.localKind || '';
  let startCommand = (options.startCommand || '').trim();
  let healthPath = (options.healthPath || '/').trim() || '/';
  let copyMode = options.copyMode || 'bundle';
  let detectedInfo = null;

  if (mode === 'url') {
    if (!url) throw new Error('在线网址模式必须提供 url');
    if (!/^https?:\/\//i.test(url)) {
      url = `https://${url}`;
    }
    if (!name) name = inferNameFromUrl(url);
  } else {
    if (!localEntryDir) throw new Error('本地项目模式必须提供 localDir');
    detectedInfo = detectLocalProject(localEntryDir);
    onLog(`智能探测本地项目：${detectedInfo.label}`);
    if (!name) name = detectedInfo.suggestedName || path.basename(localEntryDir);
    if (!localKind) localKind = detectedInfo.kind;
    if (localKind === 'command' && !startCommand) {
      startCommand = detectedInfo.startCommand;
    }
    if (!options.localKind && detectedInfo.entryDir) {
      localEntryDir = detectedInfo.entryDir;
    }
    if (!options.copyMode) {
      copyMode = detectedInfo.copyMode;
    }
  }

  // Clean filename-unsafe characters in app name
  name = name.replace(/[\/\\:*?"<>|]/g, '-').trim() || 'HuixinWebApp';
  const slug = makeSlug(options.slug || name);
  const bundleId = options.bundleId || `cn.huixin.web2desktop.${slug}`;
  const outputDir = path.resolve(
    options.outputDir || path.join(os.homedir(), 'Desktop', '汇芯打包输出')
  );

  const spec = {
    name,
    slug,
    bundleId,
    version: options.version || '1.0.0',
    mode,
    engine,
    url,
    localEntryDir,
    localWorkDir: options.localWorkDir ? path.resolve(options.localWorkDir) : localEntryDir,
    localKind,
    startCommand,
    healthPath,
    copyMode,
    width: Number(options.width) || 1280,
    height: Number(options.height) || 840,
    minWidth: Number(options.minWidth) || 640,
    minHeight: Number(options.minHeight) || 480,
    hideTitlebar: Boolean(options.hideTitlebar),
    alwaysOnTop: Boolean(options.alwaysOnTop),
    tray: Boolean(options.tray),
    userAgent: options.userAgent || '',
    customCSS: options.customCSS || '',
    customJS: options.customJS || '',
    openExternalLinks: options.openExternalLinks !== false,
    dmg: Boolean(options.dmg),
    install: Boolean(options.install),
    buildElectron: Boolean(options.buildElectron),
    outputDir,
  };

  const tmpWork = fs.mkdtempSync(path.join(os.tmpdir(), 'hx-web2desktop-'));
  try {
    onLog(`准备应用图标（${options.icon ? '自定义图标' : mode === 'url' ? '自动抓取网站图标 / 生成质感图标' : '生成质感图标'}）...`);
    const iconResult = await prepareAppIcon({
      iconPath: options.icon ? path.resolve(options.icon) : '',
      siteUrl: mode === 'url' ? url : '',
      appName: name,
      workDir: tmpWork,
    });
    onLog(`图标就绪（来源: ${iconResult.source}）`);

    let result;
    if (engine === 'native') {
      result = buildNativeMacApp(spec, iconResult, onLog);
    } else {
      result = buildElectronProject(spec, iconResult, onLog);
    }

    const elapsedMs = Date.now() - startedAt;
    const finalResult = {
      ...result,
      id: `${slug}-${engine}`,
      name: spec.name,
      slug: spec.slug,
      bundleId: spec.bundleId,
      mode: spec.mode,
      target: spec.mode === 'url' ? spec.url : spec.localEntryDir,
      iconSource: iconResult.source,
      elapsedMs,
      detectedInfo,
    };

    if (!options.skipHistory) {
      addHistoryRecord({
        id: finalResult.id,
        name: finalResult.name,
        mode: finalResult.mode,
        engine: finalResult.engine,
        target: finalResult.target,
        outputPath: finalResult.outputPath,
        dmgPath: finalResult.dmgPath,
        installedPath: finalResult.installedPath,
        sizeLabel: finalResult.sizeLabel,
        options: {
          width: spec.width,
          height: spec.height,
          hideTitlebar: spec.hideTitlebar,
          tray: spec.tray,
          alwaysOnTop: spec.alwaysOnTop,
        },
      });
    }

    onLog(`✅ 打包完成！耗时 ${(elapsedMs / 1000).toFixed(2)}s → ${finalResult.outputPath}`);
    return finalResult;
  } finally {
    fs.rmSync(tmpWork, { recursive: true, force: true });
  }
}
