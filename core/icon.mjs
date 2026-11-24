import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ICON_SIZES = [
  [16, 'icon_16x16.png'],
  [32, 'icon_16x16@2x.png'],
  [32, 'icon_32x32.png'],
  [64, 'icon_32x32@2x.png'],
  [128, 'icon_128x128.png'],
  [256, 'icon_128x128@2x.png'],
  [256, 'icon_256x256.png'],
  [512, 'icon_256x256@2x.png'],
  [512, 'icon_512x512.png'],
  [1024, 'icon_512x512@2x.png'],
];

/**
 * 使用 macOS 原生 Swift CoreGraphics 生成高颜值圆角品牌首字图标（零外部依赖）
 */
function generateDefaultIconPng(appName, outPngPath) {
  const firstChar = (appName || 'H').trim().slice(0, 1).toUpperCase() || 'H';
  const safeChar = firstChar.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const safeOut = outPngPath.replace(/\\/g, '\\\\').replace(/"/g, '\\"');

  const swiftCode = `
import Cocoa

let size: CGFloat = 1024
let rep = NSBitmapImageRep(
  bitmapDataPlanes: nil,
  pixelsWide: Int(size),
  pixelsHigh: Int(size),
  bitsPerSample: 8,
  samplesPerPixel: 4,
  hasAlpha: true,
  isPlanar: false,
  colorSpaceName: .deviceRGB,
  bytesPerRow: 0,
  bitsPerPixel: 0
)!

NSGraphicsContext.saveGraphicsState()
NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)

let rect = NSRect(x: 64, y: 64, width: size - 128, height: size - 128)
let path = NSBezierPath(roundedRect: rect, xRadius: 210, yRadius: 210)
path.addClip()

let gradient = NSGradient(colors: [
  NSColor(calibratedRed: 0.85, green: 0.08, blue: 0.20, alpha: 1.0),
  NSColor(calibratedRed: 0.56, green: 0.04, blue: 0.13, alpha: 1.0)
])!
gradient.draw(in: rect, angle: -45)

// Subtle top glossy highlight
let glowRect = NSRect(x: 64, y: size * 0.52, width: size - 128, height: size * 0.44)
let glow = NSGradient(colors: [
  NSColor(calibratedWhite: 1.0, alpha: 0.16),
  NSColor(calibratedWhite: 1.0, alpha: 0.0)
])!
glow.draw(in: glowRect, angle: -90)

let text = "${safeChar}" as NSString
let font = NSFont.systemFont(ofSize: 470, weight: .bold)
let attrs: [NSAttributedString.Key: Any] = [
  .font: font,
  .foregroundColor: NSColor.white
]
let textSize = text.size(withAttributes: attrs)
let textPoint = NSPoint(
  x: (size - textSize.width) / 2.0,
  y: (size - textSize.height) / 2.0 - 12
)
text.draw(at: textPoint, withAttributes: attrs)

NSGraphicsContext.restoreGraphicsState()

if let png = rep.representation(using: .png, properties: [:]) {
  try! png.write(to: URL(fileURLWithPath: "${safeOut}"))
}
`;
  execFileSync('swift', ['-e', swiftCode], { stdio: 'pipe', timeout: 20000 });
}

/**
 * 尝试从远程网站抓取高清 favicon / apple-touch-icon
 */
async function tryFetchSiteIcon(siteUrl, outPngPath) {
  try {
    const parsed = new URL(siteUrl);
    const origin = parsed.origin;
    const candidates = [
      `${origin}/apple-touch-icon.png`,
      `${origin}/apple-touch-icon-precomposed.png`,
      `${origin}/favicon-192x192.png`,
      `${origin}/favicon.png`,
      `https://www.google.com/s2/favicons?domain=${encodeURIComponent(parsed.hostname)}&sz=256`,
    ];

    for (const url of candidates) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 3500);
        const res = await fetch(url, {
          signal: controller.signal,
          headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' },
        });
        clearTimeout(timer);
        if (!res.ok) continue;
        const ct = (res.headers.get('content-type') || '').toLowerCase();
        if (!ct.includes('image') && !url.endsWith('.png') && !url.endsWith('.ico')) continue;
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.length < 300) continue;

        const tmpRaw = outPngPath + '.raw';
        fs.writeFileSync(tmpRaw, buf);
        try {
          execFileSync('sips', ['-s', 'format', 'png', tmpRaw, '--out', outPngPath], { stdio: 'pipe' });
          fs.unlinkSync(tmpRaw);
          if (fs.existsSync(outPngPath) && fs.statSync(outPngPath).size > 300) {
            return true;
          }
        } catch {
          if (fs.existsSync(tmpRaw)) fs.unlinkSync(tmpRaw);
        }
      } catch {
        // try next candidate
      }
    }
  } catch {
    // invalid URL
  }
  return false;
}

/**
 * 将任意 PNG/JPG/WebP 图标转换为标准 1024px PNG 和 macOS .icns
 * 返回 { pngPath, icnsPath, source }
 */
export async function prepareAppIcon({ iconPath, siteUrl, appName, workDir }) {
  const iconDir = path.join(workDir, 'icons');
  fs.mkdirSync(iconDir, { recursive: true });
  const masterPng = path.join(iconDir, 'icon-1024.png');
  const outIcns = path.join(iconDir, 'AppIcon.icns');

  let source = 'generated';

  if (iconPath && fs.existsSync(iconPath)) {
    const ext = path.extname(iconPath).toLowerCase();
    if (ext === '.icns') {
      fs.copyFileSync(iconPath, outIcns);
      try {
        execFileSync('sips', ['-s', 'format', 'png', iconPath, '--out', masterPng], { stdio: 'pipe' });
      } catch {
        generateDefaultIconPng(appName, masterPng);
      }
      return { pngPath: masterPng, icnsPath: outIcns, source: 'custom-icns' };
    }
    execFileSync('sips', ['-s', 'format', 'png', '-z', '1024', '1024', iconPath, '--out', masterPng], {
      stdio: 'pipe',
    });
    source = 'custom';
  } else {
    let fetched = false;
    if (siteUrl && /^https?:\/\//i.test(siteUrl)) {
      fetched = await tryFetchSiteIcon(siteUrl, masterPng);
      if (fetched) {
        execFileSync('sips', ['-z', '1024', '1024', masterPng], { stdio: 'pipe' });
        source = 'favicon';
      }
    }
    if (!fetched) {
      generateDefaultIconPng(appName, masterPng);
      source = 'generated';
    }
  }

  // Build .iconset -> .icns on macOS
  if (process.platform === 'darwin') {
    const iconsetDir = path.join(iconDir, 'AppIcon.iconset');
    fs.mkdirSync(iconsetDir, { recursive: true });
    for (const [sz, fname] of ICON_SIZES) {
      execFileSync(
        'sips',
        ['-z', String(sz), String(sz), masterPng, '--out', path.join(iconsetDir, fname)],
        { stdio: 'pipe' }
      );
    }
    execFileSync('iconutil', ['-c', 'icns', iconsetDir, '-o', outIcns], { stdio: 'pipe' });
    fs.rmSync(iconsetDir, { recursive: true, force: true });
  }

  return { pngPath: masterPng, icnsPath: fs.existsSync(outIcns) ? outIcns : null, source };
}
