import fs from 'node:fs';
import path from 'node:path';

/**
 * 智能探测本地网页/全栈项目类型，给出开箱即用的运行方案
 */
export function detectLocalProject(projectDir) {
  const absDir = path.resolve(projectDir);
  if (!fs.existsSync(absDir) || !fs.statSync(absDir).isDirectory()) {
    throw new Error(`本地目录不存在或不是文件夹: ${absDir}`);
  }

  const has = (rel) => fs.existsSync(path.join(absDir, rel));
  const readJson = (rel) => {
    try {
      return JSON.parse(fs.readFileSync(path.join(absDir, rel), 'utf8'));
    } catch {
      return null;
    }
  };

  const folderName = path.basename(absDir);

  // 1. Next.js standalone
  if (has('server.js') && has('.next')) {
    return {
      projectType: 'nextjs-standalone',
      label: 'Next.js Standalone 全栈项目',
      suggestedName: folderName,
      kind: 'command',
      startCommand: 'HOSTNAME=127.0.0.1 node server.js',
      healthPath: '/',
      entryDir: absDir,
      copyMode: 'bundle',
    };
  }

  // 2. Built static dist/build/out folder inside project
  for (const distName of ['dist', 'build', 'out']) {
    if (has(path.join(distName, 'index.html'))) {
      return {
        projectType: 'static-dist',
        label: `前端构建产物 (${distName}/index.html)`,
        suggestedName: folderName,
        kind: 'static',
        startCommand: '',
        healthPath: '/',
        entryDir: path.join(absDir, distName),
        copyMode: 'bundle',
      };
    }
  }

  // 3. Pure static HTML site
  if (has('index.html')) {
    return {
      projectType: 'static-html',
      label: '静态网页项目 (index.html)',
      suggestedName: folderName,
      kind: 'static',
      startCommand: '',
      healthPath: '/',
      entryDir: absDir,
      copyMode: 'bundle',
    };
  }

  // 4. Node.js backend / web app
  if (has('package.json')) {
    const pkg = readJson('package.json');
    const scripts = pkg?.scripts || {};
    let cmd = '';
    if (scripts.start) {
      cmd = 'npm run start';
    } else if (scripts.preview) {
      cmd = 'npm run preview -- --host 127.0.0.1 --port $PORT';
    } else if (scripts.dev) {
      cmd = 'npm run dev -- --host 127.0.0.1 --port $PORT';
    } else if (pkg?.main) {
      cmd = `node ${pkg.main}`;
    } else if (has('server.js')) {
      cmd = 'node server.js';
    } else if (has('index.js')) {
      cmd = 'node index.js';
    }
    return {
      projectType: 'node-app',
      label: 'Node.js 网页/全栈应用',
      suggestedName: pkg?.name || folderName,
      kind: 'command',
      startCommand: cmd || 'node server.js',
      healthPath: '/',
      entryDir: absDir,
      copyMode: 'reference',
    };
  }

  // 5. Python FastAPI / Flask / Streamlit / generic web app
  if (has('app.py') || has('main.py') || has('server.py')) {
    const mainFile = has('app.py') ? 'app.py' : has('main.py') ? 'main.py' : 'server.py';
    const content = fs.readFileSync(path.join(absDir, mainFile), 'utf8');
    let cmd = `python3 ${mainFile}`;
    let label = `Python 网页项目 (${mainFile})`;
    if (/streamlit/i.test(content)) {
      label = 'Python Streamlit 应用';
      cmd = `streamlit run ${mainFile} --server.address 127.0.0.1 --server.port $PORT --server.headless true`;
    } else if (/fastapi|uvicorn/i.test(content)) {
      label = 'Python FastAPI 应用';
      const stem = mainFile.replace(/\.py$/, '');
      cmd = `python3 -m uvicorn ${stem}:app --host 127.0.0.1 --port $PORT`;
    } else if (/gradio/i.test(content)) {
      label = 'Python Gradio 应用';
      cmd = `GRADIO_SERVER_PORT=$PORT python3 ${mainFile}`;
    } else if (/flask/i.test(content)) {
      label = 'Python Flask 应用';
      cmd = `FLASK_RUN_PORT=$PORT python3 ${mainFile}`;
    }
    return {
      projectType: 'python-web',
      label,
      suggestedName: folderName,
      kind: 'command',
      startCommand: cmd,
      healthPath: '/',
      entryDir: absDir,
      copyMode: 'reference',
    };
  }

  // Fallback: treat as static directory
  return {
    projectType: 'generic-static',
    label: '通用本地目录 (内置静态服务)',
    suggestedName: folderName,
    kind: 'static',
    startCommand: '',
    healthPath: '/',
    entryDir: absDir,
    copyMode: 'bundle',
  };
}
