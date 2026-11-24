#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { packDesktopApp } from '../core/packer.mjs';
import { detectLocalProject } from '../core/detect.mjs';

function printHelp() {
  console.log(`
汇芯网页转桌面 (huixin-web-to-desktop) v1.0.0
出品：袁六伟 · 台州汇芯（MIT 免费开源）

用法:
  hxweb2app <网址或本地文件夹> [选项]
  hxweb2app gui                         启动可视化桌面工作台界面
  hxweb2app detect <本地文件夹>          智能探测本地项目类型与推荐启动命令

常用选项:
  --name, -n <名称>          应用名称（默认自动提取）
  --mode <url|local>         打包模式（默认自动判断：http 开头为 url，目录为 local）
  --engine <native|electron> 引擎选择（默认 native 原生 ~1MB 极速；可选 electron 全能跨平台）
  --icon, -i <图片路径>       自定义图标（PNG/JPG/ICNS，不传则自动抓取网站图标或生成品牌图标）
  --out, -o <输出目录>        输出目录（默认 ~/Desktop/汇芯打包输出）
  --width <像素>             窗口宽度（默认 1280）
  --height <像素>            窗口高度（默认 840）
  --hide-titlebar            隐藏顶部标题栏（沉浸式）
  --tray                     启用菜单栏托盘驻留
  --always-on-top            窗口始终置顶
  --css <文件或CSS代码>       注入自定义 CSS（去广告/隐藏顶栏等）
  --cmd <命令>               本地全栈项目启动命令（如 "node server.js"）
  --dmg                      同时打包 .dmg 安装镜像（macOS）
  --install                  直接安装到 /Applications（macOS）
  --open                     打包完成后立即打开测试
  --build                    Electron 引擎模式下立即执行 npm install & 构建安装包
  --json                     以 JSON 格式输出结果

示例:
  hxweb2app https://chat.deepseek.com --name DeepSeek --dmg --open
  hxweb2app ./my-vite-app --name 我的本地工具 --install
  hxweb2app https://www.notion.so --name Notion --engine electron
`);
}

function parseArgs(argv) {
  const args = argv.slice(2);
  if (args.length === 0 || args.includes('-h') || args.includes('--help')) {
    return { command: 'help' };
  }
  if (args[0] === 'gui') {
    return { command: 'gui' };
  }
  if (args[0] === 'detect' && args[1]) {
    return { command: 'detect', target: args[1] };
  }

  const opts = { command: 'pack', target: '' };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    const next = () => args[++i];
    if (!a.startsWith('-') && !opts.target) {
      opts.target = a;
    } else if (a === '--name' || a === '-n') {
      opts.name = next();
    } else if (a === '--mode') {
      opts.mode = next();
    } else if (a === '--engine' || a === '-e') {
      opts.engine = next();
    } else if (a === '--icon' || a === '-i') {
      opts.icon = next();
    } else if (a === '--out' || a === '-o') {
      opts.outputDir = next();
    } else if (a === '--width') {
      opts.width = Number(next());
    } else if (a === '--height') {
      opts.height = Number(next());
    } else if (a === '--hide-titlebar') {
      opts.hideTitlebar = true;
    } else if (a === '--tray') {
      opts.tray = true;
    } else if (a === '--always-on-top') {
      opts.alwaysOnTop = true;
    } else if (a === '--css') {
      const val = next();
      opts.customCSS = fs.existsSync(val) ? fs.readFileSync(val, 'utf8') : val;
    } else if (a === '--js') {
      const val = next();
      opts.customJS = fs.existsSync(val) ? fs.readFileSync(val, 'utf8') : val;
    } else if (a === '--cmd' || a === '--start-command') {
      opts.startCommand = next();
      opts.localKind = 'command';
    } else if (a === '--health-path') {
      opts.healthPath = next();
    } else if (a === '--bundle-id') {
      opts.bundleId = next();
    } else if (a === '--dmg') {
      opts.dmg = true;
    } else if (a === '--install') {
      opts.install = true;
    } else if (a === '--open') {
      opts.open = true;
    } else if (a === '--build') {
      opts.buildElectron = true;
    } else if (a === '--json') {
      opts.json = true;
    }
  }
  return opts;
}

async function main() {
  const parsed = parseArgs(process.argv);
  if (parsed.command === 'help') {
    printHelp();
    return;
  }
  if (parsed.command === 'gui') {
    const serverPath = new URL('../gui/server.mjs', import.meta.url).pathname;
    await import(serverPath);
    return;
  }
  if (parsed.command === 'detect') {
    const info = detectLocalProject(parsed.target);
    console.log(JSON.stringify(info, null, 2));
    return;
  }

  if (!parsed.target) {
    console.error('❌ 请提供目标网址或本地文件夹路径。运行 hxweb2app --help 查看用法。');
    process.exit(1);
  }

  const isLocalPath =
    parsed.mode === 'local' ||
    (!/^https?:\/\//i.test(parsed.target) && fs.existsSync(path.resolve(parsed.target)));

  const packOpts = {
    ...parsed,
    mode: isLocalPath ? 'local' : 'url',
    url: isLocalPath ? '' : parsed.target,
    localDir: isLocalPath ? parsed.target : '',
  };

  const log = parsed.json ? () => {} : (msg) => console.log(`[汇芯网页转桌面] ${msg}`);
  try {
    const result = await packDesktopApp(packOpts, log);
    if (parsed.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log('');
      console.log('==============================================');
      console.log(`🎉 应用名称：${result.name}`);
      console.log(`⚙️  打包引擎：${result.engine === 'native' ? '原生 WKWebView 极速轻量引擎' : 'Electron 全能跨平台引擎'}`);
      console.log(`📦 产物体积：${result.sizeLabel}`);
      console.log(`📂 输出路径：${result.outputPath}`);
      if (result.dmgPath) console.log(`💿 DMG 镜像：${result.dmgPath}`);
      if (result.installedPath) console.log(`🚀 已安装至：${result.installedPath}`);
      console.log('==============================================');
    }
    if (parsed.open && result.engine === 'native' && process.platform === 'darwin') {
      execFileSync('open', [result.installedPath || result.outputPath]);
    }
  } catch (err) {
    if (parsed.json) {
      console.error(JSON.stringify({ ok: false, error: err.message }));
    } else {
      console.error(`❌ 打包失败：${err.message}`);
    }
    process.exit(1);
  }
}

main();
