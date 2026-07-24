/* Proma Tree View — v0.2 Overlay Edition (补丁 M+)
 * 从侧边栏小面板重写为可调节浮窗
 *
 * 入口: 工作区 tab 栏右侧注入的 🌳 按钮 (MutationObserver)
 * 浮窗: position fixed, 可拖动边缘调整大小, 位置/大小记忆 localStorage
 * 内部布局: 顶部 tree tabs + watcher 控件 → 左侧横向缩进树 + 右侧详情面板
 * 点击节点: 触发 tray:open-agent-session 真正切换会话
 */
(function () {
  'use strict';

  // ============ 工具函数 ============

  function getIpc() {
    try {
      if (typeof window !== 'undefined' && window.promaTreeIpc) return window.promaTreeIpc;
      if (typeof window !== 'undefined' && window.electronAPI && window.electronAPI.proma) {
        return window.electronAPI.proma;
      }
    } catch (_) {}
    return null;
  }

  function h(tag, attrs, children) {
    const el = document.createElement(tag);
    if (attrs) {
      for (const k in attrs) {
        if (k === 'className') el.className = attrs[k];
        else if (k === 'textContent') el.textContent = attrs[k];
        else if (k === 'title') el.title = attrs[k];
        else if (k === 'style' && typeof attrs[k] === 'string') el.setAttribute('style', attrs[k]);
        else if (k.startsWith('on') && typeof attrs[k] === 'function') {
          el.addEventListener(k.slice(2).toLowerCase(), attrs[k]);
        } else if (attrs[k] !== undefined && attrs[k] !== null) {
          el.setAttribute(k, attrs[k]);
        }
      }
    }
    if (children) {
      if (typeof children === 'string') el.textContent = children;
      else if (Array.isArray(children)) {
        for (const c of children) {
          if (c == null) continue;
          el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
        }
      }
    }
    return el;
  }

  function formatRelative(iso) {
    if (!iso) return '从未';
    const t = new Date(iso).getTime();
    if (isNaN(t)) return '?';
    const sec = Math.floor((Date.now() - t) / 1000);
    if (sec < 60) return sec + 's 前';
    if (sec < 3600) return Math.floor(sec / 60) + 'm 前';
    if (sec < 86400) return Math.floor(sec / 3600) + 'h 前';
    return Math.floor(sec / 86400) + 'd 前';
  }

  const STATUS_COLOR = {
    active: '#3b82f6', pending_brief: '#a855f7', done: '#22c55e',
    pruned: '#ef4444', archived: '#6b7280', segment_pending: '#f59e0b'
  };
  const STATUS_LABEL = {
    active: '进行中', pending_brief: '待brief', done: '完成',
    pruned: '已剪枝', archived: '已归档', segment_pending: '竹节交接'
  };
  const ROLE_ICON = { root: '📁', commander: '🔀', worker: '🍃' };
  const GATE_COLOR = {
    pass: '#22c55e', required: '#f59e0b', fail: '#ef4444',
    skip: '#9ca3af', null: '#9ca3af'
  };

  // ============ 浮窗状态 ============

  const state = {
    floatingVisible: false,
    activeWorkspaceSlug: null,   // 选中的 workspace
    pendingWorkspaceSlug: null,  // 用户从特定项目入口进时暂存, fetchData 后激活
    activeTreeId: null,
    workspaces: [],              // [{workspace_slug, is_current, tree_count, ...}]
    trees: [],                   // 所有 tree (每个带 workspace_slug)
    selectedLeafId: null,
    watcherEnabled: null,
    watcherWatchers: [],
    pollTimer: null,
    watcherPollTimer: null,
    // 浮窗位置/大小（记忆 localStorage）
    overlayRect: loadOverlayRect()
  };

  function loadOverlayRect() {
    try {
      const raw = localStorage.getItem('proma-tree-overlay-rect');
      if (raw) {
        const r = JSON.parse(raw);
        if (r && typeof r.w === 'number' && typeof r.h === 'number') return r;
      }
    } catch (_) {}
    // 默认: 居中 70% 宽, 80% 高
    return {
      x: Math.round(window.innerWidth * 0.15),
      y: Math.round(window.innerHeight * 0.10),
      w: Math.round(window.innerWidth * 0.70),
      h: Math.round(window.innerHeight * 0.80)
    };
  }

  function saveOverlayRect(rect) {
    try { localStorage.setItem('proma-tree-overlay-rect', JSON.stringify(rect)); } catch (_) {}
  }

  // ============ 浮窗 DOM 构建 ============

  let overlayEl = null;
  let bodyEl = null;
  let treeTabsEl = null;
  let treeCanvasEl = null;
  let detailEl = null;
  let statusEl = null;

  function buildOverlay() {
    overlayEl = h('div', { className: 'ptv-overlay', id: 'proma-tree-overlay' });
    overlayEl.style.left = state.overlayRect.x + 'px';
    overlayEl.style.top = state.overlayRect.y + 'px';
    overlayEl.style.width = state.overlayRect.w + 'px';
    overlayEl.style.height = state.overlayRect.h + 'px';

    // 顶部 header
    const header = h('div', { className: 'ptv-overlay-header' });
    header.appendChild(h('span', { className: 'ptv-overlay-title' }, '🌳 任务树'));

    // Watcher 控件区
    const watcherArea = h('div', { className: 'ptv-overlay-watcher' });
    const watcherBtn = h('button', {
      className: 'ptv-btn ptv-watcher-btn',
      title: 'TAO Watcher 开关',
      onClick: () => toggleWatcher()
    }, '👁…');
    const runBtn = h('button', {
      className: 'ptv-btn',
      title: '立即跑一次 Watcher 检查',
      onClick: () => runWatcherNow()
    }, '⚡');
    watcherArea.appendChild(watcherBtn);
    watcherArea.appendChild(runBtn);
    header.appendChild(watcherArea);

    // 关闭按钮
    const closeBtn = h('button', {
      className: 'ptv-btn ptv-overlay-close',
      title: '关闭浮窗 (ESC)',
      onClick: () => hideOverlay()
    }, '×');
    header.appendChild(closeBtn);
    overlayEl.appendChild(header);

    // tree tabs 栏（在 header 下面）
    treeTabsEl = h('div', { className: 'ptv-tree-tabs' });
    overlayEl.appendChild(treeTabsEl);

    // body（左树 + 右详情）
    bodyEl = h('div', { className: 'ptv-overlay-body' });
    treeCanvasEl = h('div', { className: 'ptv-tree-canvas' });
    const splitter = h('div', { className: 'ptv-splitter' });
    detailEl = h('div', { className: 'ptv-detail-panel' });
    bodyEl.appendChild(treeCanvasEl);
    bodyEl.appendChild(splitter);
    bodyEl.appendChild(detailEl);
    overlayEl.appendChild(bodyEl);

    // 底部状态条
    statusEl = h('div', { className: 'ptv-overlay-status' }, '就绪');
    overlayEl.appendChild(statusEl);

    // 拖动调整大小（右下角）
    const resizeHandle = h('div', { className: 'ptv-resize-handle' });
    overlayEl.appendChild(resizeHandle);
    setupResize(resizeHandle);
    setupDrag(header);

    document.body.appendChild(overlayEl);

    // Splitter 拖动（左右分栏）
    setupSplitter(splitter);
  }

  function showOverlay(workspaceSlug) {
    if (!overlayEl) buildOverlay();
    overlayEl.classList.add('ptv-overlay-show');
    state.floatingVisible = true;
    // 优先使用传入的 workspace_slug (用户从某个项目入口进)
    if (workspaceSlug) state.pendingWorkspaceSlug = workspaceSlug;
    fetchData();
    fetchWatcherStatus();
    startPolling();
  }

  function hideOverlay() {
    if (overlayEl) overlayEl.classList.remove('ptv-overlay-show');
    state.floatingVisible = false;
    stopPolling();
  }

  // ============ 拖动 ============

  function setupDrag(handleEl) {
    let dragging = false;
    let startX = 0, startY = 0, startLeft = 0, startTop = 0;
    handleEl.addEventListener('mousedown', (e) => {
      if (e.target.closest('button')) return;  // 不拖按钮
      dragging = true;
      startX = e.clientX; startY = e.clientY;
      startLeft = state.overlayRect.x;
      startTop = state.overlayRect.y;
      document.body.style.userSelect = 'none';
      e.preventDefault();
    });
    document.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      state.overlayRect.x = Math.max(0, Math.min(window.innerWidth - 100, startLeft + dx));
      state.overlayRect.y = Math.max(0, Math.min(window.innerHeight - 50, startTop + dy));
      overlayEl.style.left = state.overlayRect.x + 'px';
      overlayEl.style.top = state.overlayRect.y + 'px';
    });
    document.addEventListener('mouseup', () => {
      if (dragging) { dragging = false; document.body.style.userSelect = ''; saveOverlayRect(state.overlayRect); }
    });
  }

  function setupResize(handleEl) {
    let resizing = false;
    let startX = 0, startY = 0, startW = 0, startH = 0;
    handleEl.addEventListener('mousedown', (e) => {
      resizing = true;
      startX = e.clientX; startY = e.clientY;
      startW = state.overlayRect.w;
      startH = state.overlayRect.h;
      document.body.style.userSelect = 'none';
      e.preventDefault();
      e.stopPropagation();
    });
    document.addEventListener('mousemove', (e) => {
      if (!resizing) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      state.overlayRect.w = Math.max(400, Math.min(window.innerWidth - state.overlayRect.x - 10, startW + dx));
      state.overlayRect.h = Math.max(300, Math.min(window.innerHeight - state.overlayRect.y - 10, startH + dy));
      overlayEl.style.width = state.overlayRect.w + 'px';
      overlayEl.style.height = state.overlayRect.h + 'px';
    });
    document.addEventListener('mouseup', () => {
      if (resizing) { resizing = false; document.body.style.userSelect = ''; saveOverlayRect(state.overlayRect); }
    });
  }

  function setupSplitter(splitterEl) {
    let splitting = false;
    let startX = 0;
    let startTreeW = 0;
    splitterEl.addEventListener('mousedown', (e) => {
      splitting = true;
      startX = e.clientX;
      startTreeW = treeCanvasEl.offsetWidth;
      document.body.style.userSelect = 'none';
      document.body.style.cursor = 'col-resize';
      e.preventDefault();
    });
    document.addEventListener('mousemove', (e) => {
      if (!splitting) return;
      const dx = e.clientX - startX;
      const newTreeW = Math.max(200, Math.min(bodyEl.offsetWidth - 200, startTreeW + dx));
      treeCanvasEl.style.flex = '0 0 ' + newTreeW + 'px';
    });
    document.addEventListener('mouseup', () => {
      if (splitting) {
        splitting = false;
        document.body.style.userSelect = '';
        document.body.style.cursor = '';
      }
    });
  }

  // ============ 数据获取 ============

  async function fetchData() {
    const ipc = getIpc();
    if (!ipc || !ipc.invoke) {
      if (treeCanvasEl) treeCanvasEl.innerHTML = '';
      if (treeCanvasEl) treeCanvasEl.appendChild(h('div', { className: 'ptv-empty' }, 'IPC 不可用（请检查 preload）'));
      return;
    }
    try {
      // 拉所有 workspace 的 tree（按 workspace 分组）
      const result = await ipc.invoke('proma:get-tree-states', {});
      if (result && result.ok) {
        state.workspaces = result.workspaces || [];
        state.trees = result.trees || [];
        // 决定 activeWorkspaceSlug: 优先 pendingWorkspaceSlug (用户从特定项目入口进), 否则用 is_current, 否则第一个
        const pendingSlug = state.pendingWorkspaceSlug;
        if (pendingSlug && state.workspaces.find(w => w.workspace_slug === pendingSlug)) {
          state.activeWorkspaceSlug = pendingSlug;
          state.pendingWorkspaceSlug = null;
        } else if (!state.activeWorkspaceSlug || !state.workspaces.find(w => w.workspace_slug === state.activeWorkspaceSlug)) {
          const currentWs = state.workspaces.find(w => w.is_current);
          state.activeWorkspaceSlug = currentWs ? currentWs.workspace_slug : (state.workspaces[0] && state.workspaces[0].workspace_slug);
        }
        // 当前 workspace 下的 tree (按最近活动时间倒排: 最新活动在前)
        const wsTrees = state.trees
          .filter(t => t.workspace_slug === state.activeWorkspaceSlug)
          .sort((a, b) => (b.latest_activity_ts || 0) - (a.latest_activity_ts || 0));
        if (!state.activeTreeId || !wsTrees.find(t => t.tree_id === state.activeTreeId)) {
          // 默认激活第一个 (排序后最活跃的最新 tree)
          state.activeTreeId = wsTrees[0] && wsTrees[0].tree_id;
        }
        render();
      } else {
        state.workspaces = [];
        state.trees = [];
        render();
      }
    } catch (e) {
      if (statusEl) statusEl.textContent = '获取失败: ' + (e && e.message);
    }
  }

  // 切换 workspace 时重置选中 tree
  function selectWorkspace(slug) {
    if (state.activeWorkspaceSlug === slug) return;
    state.activeWorkspaceSlug = slug;
    state.activeTreeId = null;
    state.selectedLeafId = null;
    render();
  }

  async function fetchWatcherStatus() {
    const ipc = getIpc();
    if (!ipc || !ipc.invoke) return;
    try {
      const result = await ipc.invoke('proma:watcher-status', {});
      if (result && result.ok) {
        state.watcherEnabled = !!result.config.enabled;
        state.watcherWatchers = result.watchers || [];
        updateWatcherBtn();
      }
    } catch (_) {}
  }

  async function toggleWatcher() {
    const ipc = getIpc();
    if (!ipc || !ipc.invoke) { showToast('IPC 不可用'); return; }
    const target = !state.watcherEnabled;
    try {
      const result = await ipc.invoke('proma:watcher-toggle', { enabled: target });
      if (result && result.ok) {
        state.watcherEnabled = !!result.enabled;
        updateWatcherBtn();
        showToast('Watcher: ' + (state.watcherEnabled ? 'ON' : 'OFF'));
        if (state.watcherEnabled) setTimeout(() => runWatcherNow(), 500);
      }
    } catch (e) { showToast('切换失败: ' + (e && e.message)); }
  }

  async function runWatcherNow() {
    const ipc = getIpc();
    if (!ipc || !ipc.invoke) return;
    showToast('Watcher 跑一轮...');
    if (statusEl) statusEl.textContent = 'Watcher 检查中...';
    try {
      const result = await ipc.invoke('proma:watcher-run-now', {});
      if (result && result.ok) {
        const count = (result.runs || []).length;
        const errs = (result.runs || []).filter(r => !r.ok).length;
        showToast('完成: ' + count + ' ws, ' + errs + ' 错误');
        if (statusEl) statusEl.textContent = 'Watcher 完成 (' + count + ' ws)';
        setTimeout(() => fetchData(), 500);
      }
    } catch (e) {
      showToast('Watcher 失败: ' + (e && e.message));
    }
  }

  function updateWatcherBtn() {
    const btn = overlayEl && overlayEl.querySelector('.ptv-watcher-btn');
    if (!btn) return;
    if (state.watcherEnabled === null) {
      btn.textContent = '👁…';
      btn.style.color = '';
    } else if (state.watcherEnabled) {
      btn.textContent = '👁 ON';
      btn.style.color = '#22c55e';
    } else {
      btn.textContent = '👁 OFF';
      btn.style.color = '#9ca3af';
    }
  }

  let _pollPaused = false;
  function startPolling() {
    stopPolling();
    state.pollTimer = setInterval(function () { if (!_pollPaused) fetchData(); }, 3000);
  }
  function stopPolling() {
    if (state.pollTimer) { clearInterval(state.pollTimer); state.pollTimer = null; }
  }
  function pausePolling() { _pollPaused = true; }
  function resumePolling() { _pollPaused = false; }

  // ============ 渲染 ============

  function render() {
    if (!treeTabsEl || !treeCanvasEl) return;
    renderTreeTabs();
    renderTree();
    renderDetail();
  }

  // combobox 复用缓存：render 时复用已存在的 combobox，避免 list 打开时被 render 重建打断
  let _wsCombo = null;
  let _treeCombo = null;

  // 带搜索的联动下拉框（combobox）：input + 浮层列表。
  // 稳健设计：list 打开时不被 render 重建打断；选中可靠触发（mousedown preventDefault）；点击外部才隐藏。
  function makeComboBox(items, getLabel, getValue, currentValue, onSelect, placeholder) {
    const wrapper = h('div', { style: 'position:relative;flex:1;min-width:0' });
    const cur = items.find(function (it) { return getValue(it) === currentValue; });
    const input = h('input', {
      type: 'text',
      style: 'width:100%;box-sizing:border-box;padding:5px 9px;font-size:13px;background:#1f2937;color:#e5e7eb;border:1px solid rgba(255,255,255,0.15);border-radius:6px;outline:none',
      placeholder: placeholder || '搜索...',
      value: cur ? getLabel(cur) : '',
      autocomplete: 'off'
    });
    const list = h('div', { style: 'display:none;position:absolute;top:100%;left:0;right:0;max-height:280px;overflow-y:auto;background:#1f2937;border:1px solid rgba(255,255,255,0.15);border-radius:6px;margin-top:2px;z-index:1000;box-shadow:0 6px 16px rgba(0,0,0,0.45)' });

    let isOpen = false;
    let filterStr = '';

    function buildItems() {
      list.innerHTML = '';
      const f = filterStr.toLowerCase().trim();
      const matched = items.filter(function (it) {
        if (!f) return true;
        return String(getLabel(it)).toLowerCase().indexOf(f) >= 0 || String(getValue(it)).toLowerCase().indexOf(f) >= 0;
      });
      if (matched.length === 0) {
        list.appendChild(h('div', { style: 'padding:6px 10px;color:#9ca3af;font-size:12px' }, '无匹配'));
        return;
      }
      matched.forEach(function (it) {
        const isActive = getValue(it) === currentValue;
        const item = h('div', {
          style: 'padding:5px 10px;cursor:pointer;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis' + (isActive ? ';background:rgba(79,70,229,0.3);color:#fff' : ''),
          // mousedown preventDefault 阻止 input 失焦，保证 click 必达 onSelect
          onMousedown: function (e) { e.preventDefault(); },
          onMouseenter: function (e) { if (!isActive) e.target.style.background = 'rgba(255,255,255,0.06)'; },
          onMouseleave: function (e) { if (!isActive) e.target.style.background = 'transparent'; },
          onClick: function (e) { e.preventDefault(); e.stopPropagation(); input.value = getLabel(it); close(); onSelect(getValue(it)); }
        }, getLabel(it));
        list.appendChild(item);
      });
    }

    function open() {
      if (isOpen) { filterStr = ''; buildItems(); try { input.select(); } catch (_) {} return; }
      isOpen = true;
      filterStr = '';
      buildItems();
      list.style.display = 'block';
      try { input.select(); } catch (_) {}
      if (typeof pausePolling === 'function') pausePolling();
      setTimeout(function () { document.addEventListener('mousedown', onDocMousedown, true); }, 0);
    }
    function close() {
      if (!isOpen) return;
      isOpen = false;
      list.style.display = 'none';
      document.removeEventListener('mousedown', onDocMousedown, true);
      if (typeof resumePolling === 'function') resumePolling();
    }
    function onDocMousedown(e) {
      if (wrapper.contains(e.target)) return;
      close();
    }

    input.addEventListener('focus', open);
    input.addEventListener('input', function () { filterStr = input.value; if (isOpen) buildItems(); });
    input.addEventListener('keydown', function (e) { if (e.key === 'Escape') { close(); try { input.blur(); } catch (_) {} } });

    wrapper.appendChild(input);
    wrapper.appendChild(list);

    // render 复用：更新数据 + 当前值，不销毁 DOM（list 打开状态保留）
    wrapper._updateCombo = function (newItems, newCurrentValue) {
      items = newItems;
      currentValue = newCurrentValue;
      if (!isOpen) {
        const c = items.find(function (it) { return getValue(it) === currentValue; });
        input.value = c ? getLabel(c) : '';
      }
    };
    wrapper._destroyCombo = function () { if (isOpen) close(); };
    return wrapper;
  }

  function renderTreeTabs() {
    // 外层 flex 容器：工作区 + 会话 两个下拉框左右并排
    const row = h('div', { style: 'display:flex;gap:8px;align-items:flex-start;flex-wrap:wrap' });

    // 左：工作区下拉框（复用 _wsCombo，避免重建打断 list）
    const wsCell = h('div', { style: 'display:flex;gap:6px;align-items:center;flex:1;min-width:180px' });
    wsCell.appendChild(h('span', { style: 'font-size:12px;color:#9ca3af;flex-shrink:0;width:42px' }, '工作区'));
    if (state.workspaces.length > 0) {
      if (_wsCombo) {
        _wsCombo._updateCombo(state.workspaces, state.activeWorkspaceSlug);
      } else {
        _wsCombo = makeComboBox(
          state.workspaces,
          function (ws) { return (ws.workspace_name || ws.workspace_slug) + (ws.is_current ? ' ★' : '') + '  (' + ws.tree_count + ')'; },
          function (ws) { return ws.workspace_slug; },
          state.activeWorkspaceSlug,
          function (slug) { selectWorkspace(slug); },
          '搜索工作区...'
        );
      }
      wsCell.appendChild(_wsCombo);
    } else {
      if (_wsCombo) { _wsCombo._destroyCombo(); _wsCombo = null; }
      wsCell.appendChild(h('span', { style: 'font-size:12px;color:#9ca3af' }, '无 workspace'));
    }
    row.appendChild(wsCell);

    // 右：会话下拉框（联动当前 workspace，复用 _treeCombo）
    const wsTrees = state.trees.filter(function (t) { return t.workspace_slug === state.activeWorkspaceSlug; });
    // 切 ws 后 activeTreeId 失效时自动选中第一个
    if (wsTrees.length > 0 && !wsTrees.find(function (t) { return t.tree_id === state.activeTreeId; })) {
      state.activeTreeId = wsTrees[0].tree_id;
    }
    // 切 ws 时强制销毁旧 tree combobox（items 完全变了）
    if (_treeCombo && _treeCombo._lastWs !== state.activeWorkspaceSlug) {
      _treeCombo._destroyCombo();
      _treeCombo = null;
    }
    const treeCell = h('div', { style: 'display:flex;gap:6px;align-items:center;flex:1;min-width:180px' });
    treeCell.appendChild(h('span', { style: 'font-size:12px;color:#9ca3af;flex-shrink:0;width:42px' }, '会话'));
    if (_treeCombo) {
      _treeCombo._updateCombo(wsTrees, state.activeTreeId);
    } else {
      _treeCombo = makeComboBox(
        wsTrees,
        function (t) { return (t.title || t.tree_id) + (t.has_active_leaf ? ' ●' : '') + '  (' + Object.keys(t.leaves || {}).length + ' leaves)'; },
        function (t) { return t.tree_id; },
        state.activeTreeId,
        function (treeId) { state.activeTreeId = treeId; state.selectedLeafId = null; render(); },
        wsTrees.length ? '搜索会话...' : '此工作区无 tree'
      );
      _treeCombo._lastWs = state.activeWorkspaceSlug;
    }
    treeCell.appendChild(_treeCombo);
    row.appendChild(treeCell);

    treeTabsEl.innerHTML = '';
    treeTabsEl.appendChild(row);
  }

  function renderTree() {
    treeCanvasEl.innerHTML = '';
    // 按当前 workspace 过滤
    const tree = state.trees.find(t => t.tree_id === state.activeTreeId && t.workspace_slug === state.activeWorkspaceSlug);
    if (!tree) {
      const wsTrees = state.trees.filter(t => t.workspace_slug === state.activeWorkspaceSlug);
      if (wsTrees.length === 0) {
        treeCanvasEl.appendChild(h('div', { className: 'ptv-empty' },
          '当前 workspace 无 tree。通过 `node tree-state.js init <tree_id> ...` 创建第一个 tree。'));
      } else {
        treeCanvasEl.appendChild(h('div', { className: 'ptv-empty' }, '选择上面的 tab 查看树'));
      }
      return;
    }
    if (tree.error) {
      treeCanvasEl.appendChild(h('div', { className: 'ptv-error' }, '解析失败: ' + tree.error));
      return;
    }

    // 构建 children map
    const leaves = tree.leaves || {};
    const childrenMap = {};
    let rootLeaf = null;
    for (const [lid, leaf] of Object.entries(leaves)) {
      if (leaf.parent === null || leaf.parent === undefined) rootLeaf = leaf;
      else {
        if (!childrenMap[leaf.parent]) childrenMap[leaf.parent] = [];
        childrenMap[leaf.parent].push(leaf);
      }
    }

    function renderLeaf(leaf, depth) {
      const node = h('div', {
        className: 'ptv-leaf-row' + (leaf.leaf_id === state.selectedLeafId ? ' ptv-leaf-selected' : '') + (leaf.status === 'pending_brief' ? ' ptv-leaf-pending' : ''),
        style: 'margin-left:' + (depth * 18) + 'px',
        title: (leaf.session_title ? leaf.session_title + ' · ' : '') + 'leaf:' + leaf.leaf_id + ' · session:' + leaf.session_id.slice(0, 8),
        onClick: () => { state.selectedLeafId = leaf.leaf_id; render(); handleLeafClick(leaf); }
      });
      // 角色 icon
      node.appendChild(h('span', { className: 'ptv-role' }, ROLE_ICON[leaf.role] || '?'));
      // 状态圆点
      const statusColor = STATUS_COLOR[leaf.status] || '#9ca3af';
      node.appendChild(h('span', { className: 'ptv-dot', style: 'background:' + statusColor }));
      // leaf 标签: session title 为主 (人友好), leaf_id 附加 (Agent 友好)
      const _hasTitle = leaf.session_title && String(leaf.session_title).trim();
      node.appendChild(h('span', { className: 'ptv-leaf-id' }, _hasTitle ? leaf.session_title : leaf.leaf_id));
      if (_hasTitle) {
        node.appendChild(h('span', { className: 'ptv-leaf-id', style: 'font-size:11px;color:#9ca3af;margin-left:6px;opacity:0.85' }, leaf.leaf_id));
      }
      // 元数据 chips
      const meta = h('span', { className: 'ptv-leaf-chips' });
      meta.appendChild(h('span', { className: 'ptv-chip ptv-status-chip', style: 'color:' + statusColor }, STATUS_LABEL[leaf.status] || leaf.status));
      if (leaf.audit_gate && leaf.audit_gate.verdict) {
        const gc = GATE_COLOR[leaf.audit_gate.verdict];
        meta.appendChild(h('span', { className: 'ptv-chip', style: 'color:' + gc, title: 'audit_gate: ' + leaf.audit_gate.verdict }, leaf.audit_gate.verdict));
      }
      if (leaf.role === 'worker' && leaf.milestones && leaf.milestones.length > 0) {
        const done = leaf.milestones.filter(m => m.status === 'done').length;
        meta.appendChild(h('span', { className: 'ptv-chip' }, done + '/' + leaf.milestones.length));
      }
      if (leaf.nudge_count > 0) {
        meta.appendChild(h('span', { className: 'ptv-chip ptv-nudge-chip', title: '点击查看违规' }, '⚠' + leaf.nudge_count));
      }
      if (leaf.context_usage_pct > 0) {
        meta.appendChild(h('span', { className: 'ptv-chip' }, leaf.context_usage_pct + '%'));
      }
      node.appendChild(meta);
      return node;
    }

    function renderRecursive(leaf, depth) {
      const wrapper = h('div');
      wrapper.appendChild(renderLeaf(leaf, depth));
      const kids = childrenMap[leaf.leaf_id] || [];
      kids.sort((a, b) => {
        if (a.role !== b.role) {
          const order = { commander: 0, worker: 1, root: 2 };
          return (order[a.role] || 9) - (order[b.role] || 9);
        }
        return a.leaf_id.localeCompare(b.leaf_id);
      });
      for (const k of kids) wrapper.appendChild(renderRecursive(k, depth + 1));
      return wrapper;
    }

    if (rootLeaf) {
      treeCanvasEl.appendChild(renderRecursive(rootLeaf, 0));
    } else {
      // 无根, 平铺
      for (const leaf of Object.values(leaves)) {
        treeCanvasEl.appendChild(renderLeaf(leaf, 0));
      }
    }
  }

  function renderDetail() {
    if (!detailEl) return;
    detailEl.innerHTML = '';
    if (!state.selectedLeafId) {
      detailEl.appendChild(h('div', { className: 'ptv-empty' }, '点击左侧节点查看详情'));
      return;
    }
    const tree = state.trees.find(t => t.tree_id === state.activeTreeId && t.workspace_slug === state.activeWorkspaceSlug);
    if (!tree) return;
    const leaf = (tree.leaves || {})[state.selectedLeafId];
    if (!leaf) {
      detailEl.appendChild(h('div', { className: 'ptv-empty' }, '节点不存在'));
      return;
    }

    // 节点标题
    detailEl.appendChild(h('div', { className: 'ptv-detail-header' }, [
      h('span', { className: 'ptv-role' }, ROLE_ICON[leaf.role] || '?'),
      h('span', { className: 'ptv-detail-title' }, leaf.leaf_id)
    ]));

    // 元数据
    const metaTable = h('div', { className: 'ptv-detail-meta' });
    function metaRow(label, value, color) {
      const row = h('div', { className: 'ptv-meta-row' });
      row.appendChild(h('span', { className: 'ptv-meta-label' }, label));
      const valEl = h('span', { className: 'ptv-meta-value' }, String(value));
      if (color) valEl.style.color = color;
      row.appendChild(valEl);
      return row;
    }
    const sc = STATUS_COLOR[leaf.status] || '#9ca3af';
    metaTable.appendChild(metaRow('status', STATUS_LABEL[leaf.status] || leaf.status, sc));
    metaTable.appendChild(metaRow('role', leaf.role));
    metaTable.appendChild(metaRow('session_id', leaf.session_id.slice(0, 8) + '...'));
    metaTable.appendChild(metaRow('parent', leaf.parent || '(root)'));
    metaTable.appendChild(metaRow('model', leaf.model || '?'));
    metaTable.appendChild(metaRow('last_event', formatRelative(leaf.last_event_ts)));
    metaTable.appendChild(metaRow('context', (leaf.context_usage_pct || 0) + '%'));
    if (leaf.audit_gate) {
      const gc = GATE_COLOR[leaf.audit_gate.verdict];
      metaTable.appendChild(metaRow('audit_gate', leaf.audit_gate.verdict, gc));
    }
    metaTable.appendChild(metaRow('nudge_count', leaf.nudge_count || 0, (leaf.nudge_count || 0) > 0 ? '#f59e0b' : null));
    metaTable.appendChild(metaRow('audit_log', (leaf.audit_log_count || 0) + ' 条'));
    detailEl.appendChild(metaTable);

    // 操作按钮
    const actions = h('div', { className: 'ptv-detail-actions' });
    actions.appendChild(h('button', {
      className: 'ptv-btn ptv-action-btn',
      title: '切换到此 Agent 会话',
      onClick: () => handleLeafClick(leaf, true)
    }, '→ 切换会话'));
    actions.appendChild(h('button', {
      className: 'ptv-btn ptv-action-btn',
      title: '复制 session_id 到剪贴板',
      onClick: () => {
        try {
          navigator.clipboard.writeText(leaf.session_id);
          showToast('已复制: ' + leaf.session_id.slice(0, 8) + '...');
        } catch (_) { showToast(leaf.session_id); }
      }
    }, '复制 ID'));
    detailEl.appendChild(actions);

    // 违规记录（nudge_log）+ 偏移记录（drift_history）
    const hasNudge = leaf.nudge_log && leaf.nudge_log.length > 0;
    const hasDrift = leaf.drift_history && leaf.drift_history.length > 0;

    if (hasNudge) {
      detailEl.appendChild(h('div', { className: 'ptv-detail-section-title' }, '⚠ 违规记录 (' + leaf.nudge_log.length + ')'));
      const logWrap = h('div', { className: 'ptv-violation-list' });
      const sorted = leaf.nudge_log.slice().sort((a, b) => new Date(b.ts) - new Date(a.ts));
      for (const v of sorted) {
        const entry = h('div', { className: 'ptv-violation-entry ptv-severity-' + v.severity });
        entry.appendChild(h('div', { className: 'ptv-violation-header' }, [
          h('span', { className: 'ptv-violation-rule' }, v.rule_id),
          h('span', { className: 'ptv-violation-sev ptv-severity-' + v.severity }, v.severity),
          h('span', { className: 'ptv-violation-ts' }, formatRelative(v.ts))
        ]));
        entry.appendChild(h('div', { className: 'ptv-violation-evidence' }, v.evidence || '(无证据)'));
        if (v.suggest) entry.appendChild(h('div', { className: 'ptv-violation-suggest' }, '→ ' + v.suggest));
        if (v.send_message === false) entry.appendChild(h('div', { className: 'ptv-violation-note' }, '(已达 nudge 上限, 仅记录)'));
        logWrap.appendChild(entry);
      }
      detailEl.appendChild(logWrap);
    }

    if (hasDrift) {
      detailEl.appendChild(h('div', { className: 'ptv-detail-section-title' }, '↕ 偏移记录 (' + leaf.drift_history.length + ')'));
      const driftWrap = h('div', { className: 'ptv-violation-list' });
      const dsorted = leaf.drift_history.slice().sort((a, b) => new Date(b.ts) - new Date(a.ts));
      for (const d of dsorted) {
        const sev = d.severity || 'low';
        const entry = h('div', { className: 'ptv-violation-entry ptv-severity-' + sev });
        entry.appendChild(h('div', { className: 'ptv-violation-header' }, [
          h('span', { className: 'ptv-violation-rule' }, (d.kind || 'drift') + ' · ' + (d.action || '-')),
          h('span', { className: 'ptv-violation-sev ptv-severity-' + sev }, sev),
          h('span', { className: 'ptv-violation-ts' }, formatRelative(d.ts))
        ]));
        if (d.reason) entry.appendChild(h('div', { className: 'ptv-violation-evidence' }, d.reason));
        if (d.fork_to) entry.appendChild(h('div', { className: 'ptv-violation-suggest' }, '→ fork 到 ' + d.fork_to));
        driftWrap.appendChild(entry);
      }
      detailEl.appendChild(driftWrap);
    }

    if (!hasNudge && !hasDrift) {
      detailEl.appendChild(h('div', { className: 'ptv-detail-section-title' }, '✓ 无违规记录'));
    }
  }

  // ============ 点击节点行为 ============

  function handleLeafClick(leaf, force) {
    const ipc = getIpc();
    if (!ipc || !ipc.send) {
      // fallback: 复制 session_id
      try {
        navigator.clipboard.writeText(leaf.session_id);
        showToast('已复制: ' + leaf.session_id.slice(0, 8) + '...');
      } catch (_) {}
      return;
    }
    // 调 tray:open-agent-session（IPC handler 会转发）
    try {
      ipc.send('proma:navigate-to-session', leaf.session_id);
      if (force) showToast('切换到 ' + leaf.leaf_id);
    } catch (e) {
      showToast('切换失败: ' + (e && e.message));
    }
  }

  // ============ Toast ============

  function showToast(msg) {
    const toast = h('div', { className: 'ptv-toast' }, msg);
    document.body.appendChild(toast);
    setTimeout(() => toast.classList.add('ptv-toast-show'), 10);
    setTimeout(() => {
      toast.classList.remove('ptv-toast-show');
      setTimeout(() => toast.remove(), 300);
    }, 2000);
  }

  // ============ 入口按钮注入（MutationObserver）============

  // 每个项目行注入一个按钮 + 保留 fallback 单按钮 (向后兼容)
  const entryBtnsByProject = new Map();  // projectKey -> {btn, group}
  let entryBtn = null;  // 兼容旧引用 (用作"是否已注入"标志)

  let observer = null;

  // 从项目行 (.group/project) 提取 workspace_slug
  // 3 重保险: aria-controls UUID → React fiber props.group.workspace.slug → textContent 反查
  let workspaceNameToSlug = {};  // name → slug 缓存 (init 时从 Proma API 拉一次)
  let workspaceIdToSlug = {};    // id → slug 缓存 (UUID → slug 反查)

  async function refreshWorkspaceMap() {
    try {
      const ea = window.electronAPI;
      if (!ea || !ea.listAgentWorkspaces) return;
      const workspaces = await ea.listAgentWorkspaces();
      if (!Array.isArray(workspaces)) return;
      workspaceNameToSlug = {};
      workspaceIdToSlug = {};
      for (const ws of workspaces) {
        if (ws && ws.name && ws.slug) workspaceNameToSlug[ws.name] = ws.slug;
        if (ws && ws.id && ws.slug) workspaceIdToSlug[ws.id] = ws.slug;
      }
    } catch (_) {}
  }

  function getWorkspaceSlugFromProjectGroup(group) {
    try {
      const projectBtn = group.querySelector('button[class*="agent-project-item"]');
      if (!projectBtn) return null;

      // 方法 0 (最稳): aria-controls 含 workspace UUID, 反查 workspaceIdToSlug
      try {
        const ariaControls = projectBtn.getAttribute('aria-controls') || '';
        const uuidMatch = ariaControls.match(/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/i);
        if (uuidMatch) {
          const wsId = uuidMatch[1];
          if (workspaceIdToSlug[wsId]) return workspaceIdToSlug[wsId];
        }
      } catch (_) {}

      // 方法 1: React fiber props (关键字段: props.group.workspace.slug, props.currentWorkspaceId)
      const fiberKey = Object.keys(projectBtn).find(k =>
        k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$')
      );
      if (fiberKey) {
        let fiber = projectBtn[fiberKey];
        let depth = 0;
        while (fiber && depth < 25) {
          const props = fiber.memoizedProps;
          if (props && typeof props === 'object') {
            // 关键: props.group.workspace.slug (Proma 实际用的字段名)
            if (props.group && props.group.workspace) {
              const w = props.group.workspace;
              if (typeof w.slug === 'string') return w.slug;
              if (typeof w.id === 'string' && workspaceIdToSlug[w.id]) return workspaceIdToSlug[w.id];
            }
            // props.currentWorkspaceId 反查
            if (typeof props.currentWorkspaceId === 'string' && workspaceIdToSlug[props.currentWorkspaceId]) {
              return workspaceIdToSlug[props.currentWorkspaceId];
            }
            // 通用字段名 (兼容其他可能)
            if (typeof props.workspaceSlug === 'string') return props.workspaceSlug;
            if (props.workspace && typeof props.workspace.slug === 'string') return props.workspace.slug;
            if (props.project && typeof props.project.slug === 'string') return props.project.slug;
          }
          fiber = fiber.return;
          depth++;
        }
      }

      // 方法 2: textContent 反查 workspaceNameToSlug
      const text = (projectBtn.textContent || '').trim();
      if (text && workspaceNameToSlug[text]) return workspaceNameToSlug[text];
    } catch (_) {}
    return null;
  }

  // dump 单个项目按钮的 React fiber 信息 (调试用, 定位 workspace_slug 字段名)
  function dumpProjectInfo(projectBtn, source) {
    try {
      const info = {
        source: source || 'unknown',
        textContent: (projectBtn.textContent || '').trim().slice(0, 100),
        className: (typeof projectBtn.className === 'string' ? projectBtn.className : '').slice(0, 250),
        ariaLabel: projectBtn.getAttribute ? projectBtn.getAttribute('aria-label') : null,
        dataset: { ...(projectBtn.dataset || {}) },
        reactPropKeys: [],
        workspaceNameToSlug_cache: workspaceNameToSlug
      };
      const fiberKey = Object.keys(projectBtn).find(k =>
        k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$')
      );
      if (fiberKey) {
        let fiber = projectBtn[fiberKey];
        let depth = 0;
        while (fiber && depth < 25) {
          const props = fiber.memoizedProps;
          if (props && typeof props === 'object') {
            for (const k of Object.keys(props)) {
              if (k === 'children' || k.length > 30) continue;  // 跳过 children (太长)
              const v = props[k];
              const t = Array.isArray(v) ? 'array' : (v === null ? 'null' : typeof v);
              let preview = '';
              if (t === 'object') {
                try { preview = 'keys: ' + Object.keys(v).slice(0, 15).join(','); } catch(_) { preview = '?'; }
              } else if (t === 'string') {
                preview = '"' + v.slice(0, 60) + '"';
              } else if (t === 'number' || t === 'boolean') {
                preview = String(v);
              } else if (t === 'array') {
                preview = '[' + v.length + ']';
              }
              info.reactPropKeys.push('d' + depth + '.' + k + ' (' + t + ') = ' + preview);
            }
          }
          fiber = fiber.return;
          depth++;
        }
      } else {
        info.reactPropKeys.push('(no React fiber key found)');
      }
      const ipc = getIpc();
      if (ipc && ipc.invoke) {
        ipc.invoke('proma:dom-dump', {
          dumps: { __project_info__: info },
          url: location.href,
          windowName: 'project-info',
          ts: Date.now()
        }).catch(()=>{});
      }
    } catch (_) {}
  }

  function makeEntryBtn(workspaceSlug) {
    return h('button', {
      className: 'ptv-entry-btn ptv-entry-btn-project',
      title: '打开任务树面板 (Ctrl+Shift+T)' + (workspaceSlug ? ' — ' + workspaceSlug : ''),
      onClick: (e) => {
        e.preventDefault();
        e.stopPropagation();
        // 修 race condition: 注入按钮时 React fiber 可能未就绪 → 闭包 workspaceSlug=null
        // 每次点击都重新从 DOM 拿 slug, 闭包值只作为兜底
        let slug = workspaceSlug;
        let group = null;
        try {
          group = e.currentTarget.closest ? e.currentTarget.closest('.group\\/project') : null;
        } catch (_) {}
        if (group) {
          try {
            const freshSlug = getWorkspaceSlugFromProjectGroup(group);
            if (freshSlug) slug = freshSlug;
          } catch (_) {}
          // 调试: dump 该项目按钮的 React 信息 (定位 workspace_slug 字段名)
          try {
            const pBtn = group.querySelector('button[class*="agent-project-item"]');
            if (pBtn) dumpProjectInfo(pBtn, 'entry-btn-click');
          } catch (_) {}
        }
        if (state.floatingVisible) {
          hideOverlay();
        } else {
          showOverlay(slug);  // 传 workspace_slug 进去, 浮窗默认激活它
        }
      },
      onMouseDown: (e) => {
        // 保险: 优先于 click 触发, 避免被父级 React 事件系统吞掉
        e.preventDefault();
        e.stopPropagation();
      }
    }, '🌳');
  }

  function injectEntryButton() {
    // 主路径: 每个 .group/project 项目行注入一个按钮
    let injectedAny = false;
    try {
      const groups = document.querySelectorAll('.group\\/project');
      groups.forEach((group, idx) => {
        // 给每个项目行打一个稳定 key (用 data 属性记忆)
        let key = group.dataset.promaBtnKey;
        if (!key) {
          key = 'proj-' + idx + '-' + Math.random().toString(36).slice(2, 8);
          group.dataset.promaBtnKey = key;
        }
        const existing = entryBtnsByProject.get(key);
        if (existing && group.contains(existing)) {
          injectedAny = true;
          return;  // 已注入
        }
        // 提取该项目行的 workspace_slug (从 React fiber props)
        const workspaceSlug = getWorkspaceSlugFromProjectGroup(group);
        const btn = makeEntryBtn(workspaceSlug);
        try {
          group.appendChild(btn);
          entryBtnsByProject.set(key, btn);
          injectedAny = true;
        } catch (_) {}
      });
    } catch (_) {}

    // 兜底: 没找到任何项目行, 注入一个全局按钮 (老逻辑, 用 .tabbar-bg 或 sidebar)
    if (!injectedAny && (!entryBtn || !document.body.contains(entryBtn))) {
      const candidates = [
        { selector: '.tabbar-bg', insert: 'append' },
        { selector: '[class*="tabbar"]', insert: 'append' },
        { selector: '.crt-sidebar', insert: 'append' },
        { selector: 'header', insert: 'append' }
      ];
      let host = null;
      for (const c of candidates) {
        try {
          const el = document.querySelector(c.selector);
          if (el) { host = el; break; }
        } catch (_) {}
      }
      if (host) {
        if (!entryBtn) {
          entryBtn = h('button', {
            className: 'ptv-entry-btn',
            title: '打开任务树面板 (Ctrl+Shift+T)',
            onClick: (e) => {
              e.preventDefault();
              e.stopPropagation();
              if (state.floatingVisible) hideOverlay();
              else showOverlay();
            },
            onMouseDown: (e) => {
              e.preventDefault();
              e.stopPropagation();
            }
          }, '🌳');
        }
        try { host.appendChild(entryBtn); injectedAny = true; } catch (_) {}
      }
    }
    return injectedAny;
  }

  // ============ DOM 探测：把工作区顶部栏的 DOM 结构 dump 到文件 ============

  function dumpDOMForDebug() {
    try {
      // 扫描候选容器, 把 outerHTML 通过 IPC 发回主进程
      const candidates = [
        '.automation-entry', '.titlebar-no-drag', '.titlebar-drag-region',
        '.tabbar-bg', '[class*="tabbar"]',
        '.crt-sidebar', '[class*="sidebar"]',
        '.agent-project-item-current', '[class*="agent-project"]', '[class*="project-item"]',
        '.workspace-badge', '.workspace-switcher', '[class*="workspace"]',
        '.session-item', '[class*="session"]',
        'header', 'nav'
      ];
      const dumps = {};
      for (const sel of candidates) {
        try {
          const el = document.querySelector(sel);
          if (el) {
            dumps[sel] = {
              found: true,
              outerHTML: el.outerHTML.slice(0, 3000),
              parent_class: el.parentElement ? el.parentElement.className.slice(0, 200) : null,
              child_count: el.children.length
            };
          } else {
            dumps[sel] = { found: false };
          }
        } catch (e) {
          dumps[sel] = { found: false, error: String(e && e.message) };
        }
      }
      // 收集 body 内所有 class 名 (去重)
      try {
        const allClasses = new Set();
        document.querySelectorAll('[class]').forEach(el => {
          const cls = el.className;
          if (typeof cls === 'string') {
            cls.split(/\s+/).forEach(c => { if (c && c.length > 1) allClasses.add(c); });
          }
        });
        dumps['__all_classes__'] = Array.from(allClasses).sort().slice(0, 400);
      } catch (_) {}
      // 文本搜索: 找含项目/工作区关键词的元素
      try {
        const keywords = ['默认工作区域', '结构化实现方案', '工作区', '项目'];
        const matches = [];
        document.querySelectorAll('button, div, span, a, li, p').forEach(el => {
          const ownText = Array.from(el.childNodes)
            .filter(n => n.nodeType === 3)
            .map(n => n.textContent.trim())
            .join('');
          const fullText = (el.textContent || '').trim();
          if (!ownText && !fullText) return;
          for (const kw of keywords) {
            // 优先记录"自己直接包含"的元素 (ownText 含 kw)
            // 否则记录 fullText 含 kw 但子元素文本总量明显更少的 (说明它是接近叶子的容器)
            const isDirect = ownText.includes(kw);
            const isContainer = fullText.includes(kw) && fullText.length < 60;
            if (isDirect || isContainer) {
              const cls = (typeof el.className === 'string') ? el.className : '';
              matches.push({
                tag: el.tagName,
                keyword: kw,
                direct: isDirect,
                text: (isDirect ? ownText : fullText).slice(0, 80),
                class: cls.slice(0, 250),
                parent_class: el.parentElement ? (typeof el.parentElement.className === 'string' ? el.parentElement.className : '').slice(0, 150) : '',
                outerHTML: el.outerHTML.slice(0, 600)
              });
              break;
            }
          }
        });
        dumps['__text_search__'] = matches.slice(0, 30);
      } catch (_) {}
      // 算 window 名, 让 dump 文件按 window 区分
      let windowName = 'main';
      try {
        const ws = new URLSearchParams(location.search).get('window');
        if (ws) windowName = ws;
      } catch (_) {}
      const ipc = getIpc();
      if (ipc && ipc.invoke) {
        ipc.invoke('proma:dom-dump', { dumps, url: location.href, windowName, ts: Date.now() }).catch(()=>{});
      }
    } catch (_) {}
  }

  let domDumped = false;
  function startObserver() {
    if (observer) return;
    observer = new MutationObserver(() => {
      // 多按钮模式: 每次都尝试注入 (新项目动态出现时也覆盖). injectEntryButton 内部幂等
      const hasProjectBtns = entryBtnsByProject.size > 0;
      const hasGlobalBtn = entryBtn && document.body.contains(entryBtn);
      if (!hasProjectBtns && !hasGlobalBtn) {
        if (!injectEntryButton()) {
          ensureFallbackButton();
        } else if (fallbackBtn && fallbackBtn.parentNode) {
          fallbackBtn.remove();
        }
      } else {
        // 已注入过, 但仍尝试覆盖新出现的项目行
        injectEntryButton();
      }
      // DOM 探测: 注入成功后 3 秒做一次 dump
      if (!domDumped && (hasProjectBtns || hasGlobalBtn)) {
        domDumped = true;
        setTimeout(dumpDOMForDebug, 3000);
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    // 初次尝试
    let attempts = 0;
    const initialTry = () => {
      attempts++;
      if (injectEntryButton()) {
        setTimeout(dumpDOMForDebug, 3000);
        domDumped = true;
        return;
      }
      if (attempts < 30) { setTimeout(initialTry, 500); return; }
      // 30 次尝试都失败, 启用 fallback 浮动按钮 + 也 dump 一次
      ensureFallbackButton();
      if (!domDumped) { dumpDOMForDebug(); domDumped = true; }
    };
    initialTry();
  }

  // ============ Fallback: 固定浮动按钮（注入失败时）============

  let fallbackBtn = null;

  function ensureFallbackButton() {
    if (fallbackBtn && document.body.contains(fallbackBtn)) return;
    fallbackBtn = h('button', {
      className: 'ptv-entry-fallback',
      title: '打开任务树面板 (Ctrl+Shift+T)',
      onClick: (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (state.floatingVisible) hideOverlay();
        else showOverlay();
      }
    }, '🌳');
    document.body.appendChild(fallbackBtn);
  }

  // ============ 键盘快捷键 ============

  function setupKeyboard() {
    document.addEventListener('keydown', (e) => {
      // ESC 关闭浮窗
      if (e.key === 'Escape' && state.floatingVisible) {
        hideOverlay();
      }
      // Ctrl+Shift+T 切换浮窗
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'T' || e.key === 't')) {
        e.preventDefault();
        if (state.floatingVisible) hideOverlay();
        else showOverlay();
      }
    });
  }

  // ============ 启动 ============

  function init() {
    setupKeyboard();
    // 缓存 workspace name → slug 映射 (供 getWorkspaceSlugFromProjectGroup 反查兜底)
    refreshWorkspaceMap();
    // 每 30s 刷一次 (workspace 列表可能变化)
    setInterval(refreshWorkspaceMap, 30000);
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => startObserver());
    } else {
      startObserver();
    }
  }

  // 暴露调试接口
  window.__promaTreeView = {
    showOverlay, hideOverlay, fetchData, render,
    state, toggleWatcher, runWatcherNow, fetchWatcherStatus,
    injectEntryButton
  };

  init();
})();
