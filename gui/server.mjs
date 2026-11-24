import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { packDesktopApp } from '../core/packer.mjs';
import { detectLocalProject } from '../core/detect.mjs';
import { loadHistory, removeHistoryRecord } from '../core/history.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'public');
const PORT = Number(process.env.PORT || process.env.HUIXIN_PORT || 18765);

const PRESETS = [
  { name: 'DeepSeek', url: 'https://chat.deepseek.com', desc: '深度求索 AI 对话' },
  { name: 'ChatGPT', url: 'https://chatgpt.com', desc: 'OpenAI 桌面工作台' },
  { name: 'Notion', url: 'https://www.notion.so', desc: '云端知识库与协作' },
  { name: '飞书文档', url: 'https://www.feishu.cn/drive/home/', desc: '飞书云文档独立窗口' },
  { name: '即梦AI', url: 'https://jimeng.jianying.com', desc: 'AI 生图生视频创作台' },
  { name: '微信读书', url: 'https://weread.qq.com', desc: '沉浸式桌面阅读器' },
];

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
};

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', (c) => {
      total += c.length;
      if (total > 15 * 1024 * 1024) {
        reject(new Error('请求体过大'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function macPickPath(kind) {
  if (process.platform !== 'darwin') return '';
  const script =
    kind === 'folder'
      ? 'POSIX path of (choose folder with prompt "选择本地网页或全栈项目文件夹")'
      : 'POSIX path of (choose file with prompt "选择应用图标 (PNG / JPG / ICNS)" of type {"public.png", "public.jpeg", "com.apple.icns", "public.image"})';
  try {
    return execFileSync('osascript', ['-e', script], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch {
    return '';
  }
}

const server = http.createServer(async (req, res) => {
  const urlObj = new URL(req.url || '/', `http://127.0.0.1:${PORT}`);
  const pathname = urlObj.pathname;

  try {
    if (req.method === 'GET' && pathname === '/api/info') {
      return sendJson(res, 200, {
        ok: true,
        version: '1.0.0',
        platform: process.platform,
        defaultOutputDir: path.join(os.homedir(), 'Desktop', '汇芯打包输出'),
        presets: PRESETS,
      });
    }

    if (req.method === 'GET' && pathname === '/api/history') {
      return sendJson(res, 200, { ok: true, items: loadHistory() });
    }

    if (req.method === 'POST' && pathname === '/api/pick-folder') {
      const picked = macPickPath('folder');
      let detected = null;
      if (picked) {
        try {
          detected = detectLocalProject(picked);
        } catch {}
      }
      return sendJson(res, 200, { ok: true, path: picked, detected });
    }

    if (req.method === 'POST' && pathname === '/api/pick-icon') {
      const picked = macPickPath('icon');
      return sendJson(res, 200, { ok: true, path: picked });
    }

    if (req.method === 'POST' && pathname === '/api/detect') {
      const body = await readJsonBody(req);
      const detected = detectLocalProject(body.localDir || '');
      return sendJson(res, 200, { ok: true, detected });
    }

    if (req.method === 'POST' && pathname === '/api/pack') {
      const body = await readJsonBody(req);
      const logs = [];
      let tempIconFile = '';
      try {
        if (body.iconDataUrl && typeof body.iconDataUrl === 'string' && body.iconDataUrl.startsWith('data:image/')) {
          const base64 = body.iconDataUrl.split(',')[1] || '';
          const ext = body.iconDataUrl.includes('jpeg') ? '.jpg' : '.png';
          tempIconFile = path.join(os.tmpdir(), `hx-upload-icon-${Date.now()}${ext}`);
          fs.writeFileSync(tempIconFile, Buffer.from(base64, 'base64'));
        }
        const result = await packDesktopApp(
          {
            ...body,
            icon: tempIconFile || body.icon || '',
          },
          (msg) => logs.push(msg)
        );
        return sendJson(res, 200, { ok: true, result, logs, history: loadHistory() });
      } finally {
        if (tempIconFile && fs.existsSync(tempIconFile)) {
          fs.unlinkSync(tempIconFile);
        }
      }
    }

    if (req.method === 'POST' && pathname === '/api/open') {
      const body = await readJsonBody(req);
      const target = body.targetPath || '';
      if (!target || !fs.existsSync(target)) {
        return sendJson(res, 404, { ok: false, error: '目标文件不存在' });
      }
      if (process.platform === 'darwin') {
        execFileSync('open', [target]);
      }
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === 'POST' && pathname === '/api/reveal') {
      const body = await readJsonBody(req);
      const target = body.targetPath || '';
      if (!target || !fs.existsSync(target)) {
        return sendJson(res, 404, { ok: false, error: '目标路径不存在' });
      }
      if (process.platform === 'darwin') {
        execFileSync('open', ['-R', target]);
      }
      return sendJson(res, 200, { ok: true });
    }

    if (req.method === 'DELETE' && pathname.startsWith('/api/history/')) {
      const id = decodeURIComponent(pathname.replace('/api/history/', ''));
      removeHistoryRecord(id);
      return sendJson(res, 200, { ok: true, items: loadHistory() });
    }

    // Serve static frontend files
    const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    const filePath = path.resolve(PUBLIC_DIR, rel);
    if (!filePath.startsWith(PUBLIC_DIR) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      res.writeHead(404);
      return res.end('Not Found');
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    fs.createReadStream(filePath).pipe(res);
  } catch (err) {
    sendJson(res, 500, { ok: false, error: err.message });
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`🚀 汇芯网页转桌面 GUI 已启动: http://127.0.0.1:${PORT}`);
});
