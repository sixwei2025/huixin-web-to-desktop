const state = {
  mode: 'url',
  engine: 'native',
  iconDataUrl: '',
  defaultOutputDir: '',
};

const $ = (id) => document.getElementById(id);

function setSegmented(containerId, val) {
  document.querySelectorAll(`#${containerId} button`).forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.val === val);
  });
}

function updatePreview() {
  const name = ($('inputName').value || '未命名应用').trim();
  const target = state.mode === 'url'
    ? ($('inputUrl').value || 'https://chat.deepseek.com').trim()
    : ($('inputLocalDir').value || '请选择本地网页或全栈项目目录').trim();
  const w = $('inputWidth').value || 1280;
  const h = $('inputHeight').value || 840;

  $('previewTitle').textContent = $('chkHideTitlebar').checked ? '' : name;
  $('previewTitlebar').classList.toggle('immersive', $('chkHideTitlebar').checked);
  $('previewEngineTag').textContent = state.engine === 'native' ? '原生 ~1MB' : 'Electron 跨平台';
  $('previewNameBig').textContent = state.engine === 'native' ? `${name}.app` : `${name} (跨平台工程)`;
  $('previewTarget').textContent = target;

  const iconEl = $('previewIcon');
  if (state.iconDataUrl) {
    iconEl.innerHTML = `<img src="${state.iconDataUrl}" alt="icon" />`;
  } else {
    iconEl.textContent = (name.slice(0, 1) || 'H').toUpperCase();
  }

  const chips = [`${w} × ${h}`];
  if (state.mode === 'local') chips.push('本地服务自动拉起');
  if ($('chkHideTitlebar').checked) chips.push('沉浸顶栏');
  if ($('chkTray').checked) chips.push('托盘驻留');
  if ($('chkAlwaysOnTop').checked) chips.push('窗口置顶');
  if ($('chkDmg').checked && state.engine === 'native') chips.push('含 .dmg');
  $('previewChips').innerHTML = chips.map((c) => `<span class="chip">${c}</span>`).join('');
}

async function api(url, opts = {}) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  return res.json();
}

function renderHistory(items) {
  $('historyCount').textContent = `${items.length} 个`;
  const box = $('historyList');
  if (!items.length) {
    box.innerHTML = '<div class="empty-tip">还没有打包记录，点击左侧「一键生成桌面端 App」试试吧！</div>';
    return;
  }
  box.innerHTML = items.map((item) => `
    <div class="history-item">
      <div>
        <div class="h-title">${item.name} <span class="badge">${item.engine === 'native' ? '原生' : 'Electron'}</span></div>
        <div class="h-meta">${item.sizeLabel || ''} · ${item.target || ''}</div>
      </div>
      <div class="h-btns">
        ${item.engine === 'native' && item.exists ? `<button class="btn-secondary" data-open="${encodeURIComponent(item.installedPath || item.outputPath)}">打开</button>` : ''}
        ${item.exists ? `<button class="btn-secondary" data-reveal="${encodeURIComponent(item.outputPath)}">定位</button>` : '<span class="muted">已移动</span>'}
      </div>
    </div>
  `).join('');

  box.querySelectorAll('[data-open]').forEach((btn) => {
    btn.onclick = () => api('/api/open', { method: 'POST', body: JSON.stringify({ targetPath: decodeURIComponent(btn.dataset.open) }) });
  });
  box.querySelectorAll('[data-reveal]').forEach((btn) => {
    btn.onclick = () => api('/api/reveal', { method: 'POST', body: JSON.stringify({ targetPath: decodeURIComponent(btn.dataset.reveal) }) });
  });
}

async function init() {
  const info = await api('/api/info');
  state.defaultOutputDir = info.defaultOutputDir || '';
  $('inputOutDir').value = state.defaultOutputDir;
  $('inputUrl').value = 'https://chat.deepseek.com';
  $('inputName').value = 'DeepSeek';

  $('presetsGrid').innerHTML = (info.presets || []).map((p) => `
    <button type="button" class="preset-chip" data-name="${p.name}" data-url="${p.url}">
      <div class="p-name">${p.name}</div>
      <div class="p-desc">${p.desc}</div>
    </button>
  `).join('');

  $('presetsGrid').querySelectorAll('.preset-chip').forEach((btn) => {
    btn.onclick = () => {
      state.mode = 'url';
      setSegmented('modeSegment', 'url');
      $('urlGroup').classList.remove('hidden');
      $('localGroup').classList.add('hidden');
      $('inputName').value = btn.dataset.name;
      $('inputUrl').value = btn.dataset.url;
      updatePreview();
    };
  });

  const hist = await api('/api/history');
  renderHistory(hist.items || []);
  updatePreview();
}

$('modeSegment').addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  state.mode = btn.dataset.val;
  setSegmented('modeSegment', state.mode);
  $('urlGroup').classList.toggle('hidden', state.mode !== 'url');
  $('localGroup').classList.toggle('hidden', state.mode !== 'local');
  updatePreview();
});

$('engineSegment').addEventListener('click', (e) => {
  const btn = e.target.closest('button');
  if (!btn) return;
  state.engine = btn.dataset.val;
  setSegmented('engineSegment', state.engine);
  updatePreview();
});

['inputUrl', 'inputLocalDir', 'inputName', 'inputWidth', 'inputHeight', 'chkHideTitlebar', 'chkTray', 'chkAlwaysOnTop', 'chkDmg'].forEach((id) => {
  $(id).addEventListener('input', updatePreview);
  $(id).addEventListener('change', updatePreview);
});

$('btnPickFolder').onclick = async () => {
  const res = await api('/api/pick-folder', { method: 'POST', body: '{}' });
  if (res.path) {
    $('inputLocalDir').value = res.path;
    if (res.detected) {
      $('detectBanner').textContent = `已自动识别：${res.detected.label}`;
      $('detectBanner').classList.remove('hidden');
      if (!$('inputName').value || $('inputName').value === 'DeepSeek') {
        $('inputName').value = res.detected.suggestedName || '';
      }
      $('inputStartCmd').value = res.detected.startCommand || '';
    }
    updatePreview();
  }
};

$('btnPickIcon').onclick = async () => {
  const res = await api('/api/pick-icon', { method: 'POST', body: '{}' });
  if (res.path) {
    $('inputIconPath').value = res.path;
    state.iconDataUrl = '';
    updatePreview();
  }
};

$('btnOpenOutDir').onclick = () => {
  api('/api/open', { method: 'POST', body: JSON.stringify({ targetPath: $('inputOutDir').value || state.defaultOutputDir }) });
};

$('btnPack').onclick = async () => {
  const btn = $('btnPack');
  btn.disabled = true;
  $('btnPackText').textContent = '正在极速打包中...';
  $('resultBox').classList.add('hidden');
  $('logBox').classList.remove('hidden');
  $('logBox').textContent = '开始构建桌面端应用...';

  try {
    const payload = {
      mode: state.mode,
      engine: state.engine,
      url: $('inputUrl').value.trim(),
      localDir: $('inputLocalDir').value.trim(),
      startCommand: $('inputStartCmd').value.trim(),
      localKind: $('inputStartCmd').value.trim() ? 'command' : undefined,
      healthPath: $('inputHealthPath').value.trim() || '/',
      name: $('inputName').value.trim(),
      icon: $('inputIconPath').value.trim(),
      iconDataUrl: state.iconDataUrl,
      outputDir: $('inputOutDir').value.trim(),
      width: Number($('inputWidth').value) || 1280,
      height: Number($('inputHeight').value) || 840,
      hideTitlebar: $('chkHideTitlebar').checked,
      tray: $('chkTray').checked,
      alwaysOnTop: $('chkAlwaysOnTop').checked,
      dmg: $('chkDmg').checked,
      install: $('chkInstall').checked,
    };

    const data = await api('/api/pack', { method: 'POST', body: JSON.stringify(payload) });
    $('logBox').textContent = (data.logs || []).join('\n');
    const rb = $('resultBox');
    rb.classList.remove('hidden', 'error');

    if (!data.ok) {
      rb.classList.add('error');
      rb.innerHTML = `<strong>打包失败：</strong>${data.error || '未知错误'}`;
    } else {
      const r = data.result;
      rb.innerHTML = `
        <div><strong>✅ 打包成功！</strong> 体积：${r.sizeLabel} · 耗时：${(r.elapsedMs / 1000).toFixed(2)}s</div>
        <div style="margin-top:4px;word-break:break-all;">产物路径：${r.outputPath}</div>
        <div class="result-actions">
          ${r.engine === 'native' ? `<button class="btn-secondary" id="resLaunch">立即启动测试</button>` : ''}
          <button class="btn-secondary" id="resReveal">在 Finder 中查看</button>
          ${r.dmgPath ? `<button class="btn-secondary" id="resDmg">查看 .dmg 安装包</button>` : ''}
        </div>
      `;
      if ($('resLaunch')) {
        $('resLaunch').onclick = () => api('/api/open', { method: 'POST', body: JSON.stringify({ targetPath: r.installedPath || r.outputPath }) });
      }
      $('resReveal').onclick = () => api('/api/reveal', { method: 'POST', body: JSON.stringify({ targetPath: r.outputPath }) });
      if ($('resDmg')) {
        $('resDmg').onclick = () => api('/api/reveal', { method: 'POST', body: JSON.stringify({ targetPath: r.dmgPath }) });
      }
      renderHistory(data.history || []);
    }
  } catch (err) {
    const rb = $('resultBox');
    rb.classList.remove('hidden');
    rb.classList.add('error');
    rb.innerHTML = `<strong>请求失败：</strong>${err.message}`;
  } finally {
    btn.disabled = false;
    $('btnPackText').textContent = '一键生成桌面端 App';
  }
};

init();
