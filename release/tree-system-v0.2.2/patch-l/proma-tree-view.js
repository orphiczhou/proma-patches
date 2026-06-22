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
    activeTreeId: null,
    trees: [],
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

  function showOverlay() {
    if (!overlayEl) buildOverlay();
    overlayEl.classList.add('ptv-overlay-show');
    state.floatingVisible = true;
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
      const result = await ipc.invoke('proma:get-tree-states', {});
      if (result && result.ok) {
        state.trees = result.trees || [];
        // 选择默认 tree: 上次选中的 / 第一个
        if (!state.activeTreeId || !state.trees.find(t => t.tree_id === state.activeTreeId)) {
          // 优先活跃 tree（有任意 active leaf）
          const activeTree = state.trees.find(t => Object.values(t.leaves || {}).some(l =>
            ['active', 'pending_brief', 'segment_pending'].includes(l.status)
          ));
          state.activeTreeId = activeTree ? activeTree.tree_id : (state.trees[0] && state.trees[0].tree_id);
        }
        render();
      } else {
        state.trees = [];
        render();
      }
    } catch (e) {
      if (statusEl) statusEl.textContent = '获取失败: ' + (e && e.message);
    }
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

  function startPolling() {
    stopPolling();
    state.pollTimer = setInterval(fetchData, 3000);
  }
  function stopPolling() {
    if (state.pollTimer) { clearInterval(state.pollTimer); state.pollTimer = null; }
  }

  // ============ 渲染 ============

  function render() {
    if (!treeTabsEl || !treeCanvasEl) return;
    renderTreeTabs();
    renderTree();
    renderDetail();
  }

  function renderTreeTabs() {
    treeTabsEl.innerHTML = '';
    if (state.trees.length === 0) {
      treeTabsEl.appendChild(h('div', { className: 'ptv-empty' }, '暂无 tree'));
      return;
    }
    for (const tree of state.trees) {
      const isActive = Object.values(tree.leaves || {}).some(l =>
        ['active', 'pending_brief', 'segment_pending'].includes(l.status)
      );
      const isSelected = tree.tree_id === state.activeTreeId;
      const tab = h('div', {
        className: 'ptv-tree-tab' + (isSelected ? ' ptv-tree-tab-active' : '') + (isActive ? ' ptv-tree-tab-live' : ''),
        title: tree.tree_id + (isActive ? ' (活跃)' : ' (空闲)'),
        onClick: () => { state.activeTreeId = tree.tree_id; state.selectedLeafId = null; render(); }
      });
      tab.appendChild(h('span', { className: 'ptv-tree-tab-id' }, tree.tree_id));
      const leafCount = Object.keys(tree.leaves || {}).length;
      const nudgeCount = Object.values(tree.leaves || {}).reduce((sum, l) => sum + (l.nudge_count || 0), 0);
      tab.appendChild(h('span', { className: 'ptv-tree-tab-count' }, leafCount + ' leaves' + (nudgeCount ? ' ⚠' + nudgeCount : '')));
      treeTabsEl.appendChild(tab);
    }
  }

  function renderTree() {
    treeCanvasEl.innerHTML = '';
    const tree = state.trees.find(t => t.tree_id === state.activeTreeId);
    if (!tree) {
      treeCanvasEl.appendChild(h('div', { className: 'ptv-empty' }, '选择上面的 tab 查看树'));
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
        title: 'session: ' + leaf.session_id,
        onClick: () => { state.selectedLeafId = leaf.leaf_id; render(); handleLeafClick(leaf); }
      });
      // 角色 icon
      node.appendChild(h('span', { className: 'ptv-role' }, ROLE_ICON[leaf.role] || '?'));
      // 状态圆点
      const statusColor = STATUS_COLOR[leaf.status] || '#9ca3af';
      node.appendChild(h('span', { className: 'ptv-dot', style: 'background:' + statusColor }));
      // leaf_id
      node.appendChild(h('span', { className: 'ptv-leaf-id' }, leaf.leaf_id));
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
    const tree = state.trees.find(t => t.tree_id === state.activeTreeId);
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

    // 违规列表（nudge_log）
    if (leaf.nudge_log && leaf.nudge_log.length > 0) {
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
    } else {
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

  let entryBtn = null;
  let observer = null;

  function injectEntryButton() {
    if (entryBtn && document.body.contains(entryBtn)) return;  // 已注入

    // 候选 selector（Proma UI 可能变化, 提供多个）
    // 找包含 "+" 按钮的容器, 或工作区 tab 栏
    const candidates = [
      // 优先: 找创建会话按钮附近的容器（"+"按钮的父节点）
      { selector: '[class*="workspace"][class*="header"]', insert: 'append' },
      { selector: '[class*="WorkspaceHeader"]', insert: 'append' },
      // 备选: 找有 "+" 文字或 Plus icon 的按钮, 注入到它父节点
      { selector: 'button[class*="new"], button[class*="create"], button[class*="add"]', insert: 'after-parent' },
      // 兜底: 顶部任何 header
      { selector: 'header', insert: 'append' }
    ];

    let host = null;
    let insertMode = 'append';
    for (const c of candidates) {
      const el = document.querySelector(c.selector);
      if (el) { host = el; insertMode = c.insert; break; }
    }
    if (!host) return false;

    // 创建按钮
    if (!entryBtn) {
      entryBtn = h('button', {
        className: 'ptv-entry-btn',
        title: '打开任务树面板',
        onClick: (e) => {
          e.preventDefault();
          e.stopPropagation();
          if (state.floatingVisible) hideOverlay();
          else showOverlay();
        }
      }, '🌳');
    }

    try {
      if (insertMode === 'append') {
        host.appendChild(entryBtn);
      } else if (insertMode === 'after-parent' && host.parentNode) {
        host.parentNode.insertBefore(entryBtn, host.nextSibling);
      }
      return true;
    } catch (_) {
      return false;
    }
  }

  function startObserver() {
    if (observer) return;
    observer = new MutationObserver(() => {
      if (!entryBtn || !document.body.contains(entryBtn)) {
        if (!injectEntryButton()) {
          // 注入失败, 检查 fallback 按钮是否存在
          ensureFallbackButton();
        } else if (fallbackBtn && fallbackBtn.parentNode) {
          // 注入成功, 移除 fallback
          fallbackBtn.remove();
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    // 初次尝试
    let attempts = 0;
    const initialTry = () => {
      attempts++;
      if (injectEntryButton()) return;
      if (attempts < 30) { setTimeout(initialTry, 500); return; }
      // 30 次尝试都失败, 启用 fallback 浮动按钮
      ensureFallbackButton();
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
