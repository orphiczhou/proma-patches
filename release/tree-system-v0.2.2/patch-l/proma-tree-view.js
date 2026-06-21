/* Proma Tree View Panel — v0.1 (补丁 L)
 * 独立 vanilla JS 文件，渲染树形任务面板到侧边栏
 * 数据来源: ipcRenderer.invoke('proma:get-tree-states')
 * 点击节点: ipcRenderer.send('proma:navigate-to-session', sessionId)
 */
(function () {
  'use strict';

  // 等待 ipcRenderer 通过 preload 暴露（如果没暴露则降级为复制 session_id）
  function getIpc() {
    try {
      if (typeof window !== 'undefined' && window.promaTreeIpc) return window.promaTreeIpc;
      // 优先用 preload 暴露的 electronAPI
      if (typeof window !== 'undefined' && window.electronAPI && window.electronAPI.proma) {
        return window.electronAPI.proma;
      }
    } catch (_) {}
    return null;
  }

  const POLL_INTERVAL_MS = 3000;
  const STATUS_COLOR = {
    active: '#3b82f6',
    pending_brief: '#a855f7',
    done: '#22c55e',
    pruned: '#ef4444',
    archived: '#6b7280',
    segment_pending: '#f59e0b'
  };
  const STATUS_LABEL = {
    active: '进行中',
    pending_brief: '待brief',
    done: '完成',
    pruned: '已剪枝',
    archived: '已归档',
    segment_pending: '竹节交接'
  };
  const ROLE_ICON = {
    root: '📁',
    commander: '🔀',
    worker: '🍃'
  };
  const GATE_COLOR = {
    pass: '#22c55e',
    required: '#f59e0b',
    fail: '#ef4444',
    skip: '#9ca3af',
    null: '#9ca3af'
  };

  function h(tag, attrs, children) {
    const el = document.createElement(tag);
    if (attrs) {
      for (const k in attrs) {
        if (k === 'className') el.className = attrs[k];
        else if (k === 'textContent') el.textContent = attrs[k];
        else if (k === 'title') el.title = attrs[k];
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

  function buildLeafNode(leaf, treeId, expanded) {
    const statusColor = STATUS_COLOR[leaf.status] || '#9ca3af';
    const gateColor = GATE_COLOR[leaf.audit_gate ? leaf.audit_gate.verdict : null];
    const leafNode = h('div', { className: 'ptv-leaf' + (leaf.status === 'pending_brief' ? ' ptv-leaf-pending' : '') });

    // 缩进图标 + 状态圆点
    leafNode.appendChild(h('span', { className: 'ptv-role', title: 'role: ' + leaf.role }, ROLE_ICON[leaf.role] || '?'));

    // 标签内容
    const main = h('div', { className: 'ptv-leaf-main' });
    const title = h('div', { className: 'ptv-leaf-title', title: 'session: ' + leaf.session_id }, leaf.leaf_id);
    main.appendChild(title);

    // 元信息行
    const meta = h('div', { className: 'ptv-leaf-meta' });
    meta.appendChild(h('span', { className: 'ptv-dot', title: 'status: ' + leaf.status, style: 'background:' + statusColor }));
    meta.appendChild(h('span', { className: 'ptv-status' }, STATUS_LABEL[leaf.status] || leaf.status));

    // audit_gate 状态点（worker/commander 有）
    if (leaf.audit_gate && leaf.audit_gate.verdict) {
      meta.appendChild(h('span', { className: 'ptv-gate-dot', title: 'audit_gate: ' + leaf.audit_gate.verdict, style: 'background:' + gateColor }));
    }
    if (leaf.role === 'worker' && leaf.milestones && leaf.milestones.length > 0) {
      const done = leaf.milestones.filter(m => m.status === 'done').length;
      meta.appendChild(h('span', { className: 'ptv-milestone' }, done + '/' + leaf.milestones.length));
    }
    if (leaf.nudge_count > 0) {
      // 补丁 M: nudge 标记可点击展开违规列表
      const nudgeBtn = h('span', {
        className: 'ptv-nudge',
        title: '点击查看 ' + leaf.nudge_count + ' 条 watcher 违规记录',
        onClick: (ev) => {
          ev.stopPropagation();
          showViolations(leaf, treeId);
        }
      }, '⚠' + leaf.nudge_count);
      meta.appendChild(nudgeBtn);
    }
    if (leaf.context_usage_pct > 0) {
      meta.appendChild(h('span', { className: 'ptv-context', title: '上下文使用率' }, leaf.context_usage_pct + '%'));
    }
    main.appendChild(meta);

    leafNode.appendChild(main);

    // 点击行为
    leafNode.addEventListener('click', (ev) => {
      ev.stopPropagation();
      handleLeafClick(leaf, treeId);
    });
    return leafNode;
  }

  function handleLeafClick(leaf, treeId) {
    const ipc = getIpc();
    if (ipc && ipc.send) {
      // 通过 IPC 发送导航事件
      ipc.send('proma:navigate-to-session', leaf.session_id);
    } else {
      // 降级: 复制到剪贴板
      try {
        navigator.clipboard.writeText(leaf.session_id);
        showToast('已复制 session_id: ' + leaf.session_id.slice(0, 8) + '...');
      } catch (_) {
        showToast('session: ' + leaf.session_id);
      }
    }
  }

  function showToast(msg) {
    const toast = h('div', { className: 'ptv-toast' }, msg);
    document.body.appendChild(toast);
    setTimeout(() => toast.classList.add('ptv-toast-show'), 10);
    setTimeout(() => {
      toast.classList.remove('ptv-toast-show');
      setTimeout(() => toast.remove(), 300);
    }, 2000);
  }

  function renderTree(tree, state) {
    const container = h('div', { className: 'ptv-tree' });

    // tree 头部
    const header = h('div', { className: 'ptv-tree-header' });
    const titleArea = h('div', { className: 'ptv-tree-title' });
    titleArea.appendChild(h('span', { className: 'ptv-tree-id' }, tree.tree_id));
    const leafCount = Object.keys(tree.leaves || {}).length;
    titleArea.appendChild(h('span', { className: 'ptv-tree-count' }, leafCount + ' leaves'));
    header.appendChild(titleArea);

    if (tree.error) {
      container.appendChild(header);
      container.appendChild(h('div', { className: 'ptv-error' }, '解析失败: ' + tree.error));
      return container;
    }

    // 构建 children map 并找 root
    const leaves = tree.leaves || {};
    const childrenMap = {};
    let rootLeaf = null;
    for (const [lid, leaf] of Object.entries(leaves)) {
      if (leaf.parent === null || leaf.parent === undefined) {
        rootLeaf = leaf;
      } else {
        if (!childrenMap[leaf.parent]) childrenMap[leaf.parent] = [];
        childrenMap[leaf.parent].push(leaf);
      }
    }

    // 递归渲染
    function renderRecursive(leaf, depth) {
      const subtree = h('div', { className: 'ptv-subtree', style: 'margin-left:' + (depth * 14) + 'px' });
      subtree.appendChild(buildLeafNode(leaf, tree.tree_id, state.expanded[leaf.leaf_id]));
      const kids = childrenMap[leaf.leaf_id] || [];
      if (kids.length > 0) {
        const kidsWrap = h('div', { className: 'ptv-children' + (state.expanded[leaf.leaf_id] === false ? ' ptv-collapsed' : '') });
        // 排序：commander 在前，worker 在后；同类按 leaf_id
        kids.sort((a, b) => {
          if (a.role !== b.role) {
            const order = { commander: 0, worker: 1, root: 2 };
            return (order[a.role] || 9) - (order[b.role] || 9);
          }
          return a.leaf_id.localeCompare(b.leaf_id);
        });
        for (const k of kids) {
          kidsWrap.appendChild(renderRecursive(k, depth + 1));
        }
        subtree.appendChild(kidsWrap);
      }
      return subtree;
    }

    if (rootLeaf) {
      container.appendChild(renderRecursive(rootLeaf, 0));
      // 处理孤儿子节点（parent 不在树中的）
      const orphans = Object.values(leaves).filter(l => l !== rootLeaf && !leaves[l.parent]);
      if (orphans.length > 0) {
        const orphanWrap = h('div', { className: 'ptv-orphans' });
        orphanWrap.appendChild(h('div', { className: 'ptv-orphan-header' }, '孤儿子节点 (' + orphans.length + ')'));
        for (const o of orphans) orphanWrap.appendChild(renderRecursive(o, 1));
        container.appendChild(orphanWrap);
      }
    } else {
      // 没有根 leaf，平铺所有 leaves
      const flat = h('div', { className: 'ptv-flat' });
      for (const leaf of Object.values(leaves)) {
        flat.appendChild(buildLeafNode(leaf, tree.tree_id, state.expanded[leaf.leaf_id]));
      }
      container.appendChild(flat);
    }

    container.appendChild(header);  // 头部放最前
    container.insertBefore(header, container.firstChild);
    return container;
  }

  // 主面板
  function createPanel() {
    const panel = h('div', { className: 'ptv-panel', id: 'proma-tree-panel' });
    const header = h('div', { className: 'ptv-panel-header' });
    header.appendChild(h('span', { className: 'ptv-panel-title' }, '🌳 任务树'));
    const actions = h('div', { className: 'ptv-panel-actions' });

    // Watcher 控件 (补丁 M)
    const watcherBtn = h('button', {
      className: 'ptv-btn ptv-watcher-btn',
      title: 'TAO Watcher 开关',
      onClick: () => toggleWatcher()
    }, '👁…');
    const watcherRunBtn = h('button', {
      className: 'ptv-btn',
      title: '立即跑一次 Watcher 检查',
      onClick: () => runWatcherNow()
    }, '⚡');
    actions.appendChild(watcherBtn);
    actions.appendChild(watcherRunBtn);

    const refreshBtn = h('button', { className: 'ptv-btn', title: '刷新', onClick: () => fetchData() }, '↻');
    const collapseBtn = h('button', { className: 'ptv-btn', title: '折叠/展开全部', onClick: () => toggleAll() }, '⇕');
    const closeBtn = h('button', { className: 'ptv-btn ptv-btn-close', title: '折叠面板', onClick: () => panel.classList.toggle('ptv-collapsed') }, '–');
    actions.appendChild(refreshBtn);
    actions.appendChild(collapseBtn);
    actions.appendChild(closeBtn);
    header.appendChild(actions);
    panel.appendChild(header);

    const body = h('div', { className: 'ptv-panel-body' }, '加载中...');
    panel.appendChild(body);

    return { panel, body };
  }

  // 全局状态
  const state = {
    expanded: {},           // leaf_id → bool (false=collapsed)
    lastTrees: [],
    workspaceRoot: null,
    pollTimer: null,
    watcherEnabled: null,   // null=未加载, true/false=开关状态
    watcherWatchers: []     // [{ workspace_id, last_run_at, last_run_status, ... }]
  };

  function toggleAll() {
    const anyExpanded = Object.values(state.expanded).some(v => v !== false);
    for (const lid of Object.keys(state.expanded)) state.expanded[lid] = anyExpanded ? false : true;
    render();
  }

  function render() {
    const body = document.querySelector('.ptv-panel-body');
    if (!body) return;
    body.innerHTML = '';

    if (!state.lastTrees || state.lastTrees.length === 0) {
      body.appendChild(h('div', { className: 'ptv-empty' }, '暂无活跃任务树'));
      return;
    }

    // 排序：最近更新的在前
    const sorted = state.lastTrees.slice().sort((a, b) => {
      const ta = a.created_at ? new Date(a.created_at).getTime() : 0;
      const tb = b.created_at ? new Date(b.created_at).getTime() : 0;
      return tb - ta;
    });

    for (const tree of sorted) {
      // 初始化 expanded 状态（首次见到时默认展开）
      for (const lid of Object.keys(tree.leaves || {})) {
        if (!(lid in state.expanded)) state.expanded[lid] = true;
      }
      body.appendChild(renderTree(tree, state));
    }

    if (state.workspaceRoot) {
      body.appendChild(h('div', { className: 'ptv-workspace', title: state.workspaceRoot }, '📂 ' + state.workspaceRoot.replace(/\\/g, '/').split('/').slice(-3).join('/')));
    }
  }

  async function fetchData() {
    const ipc = getIpc();
    if (!ipc || !ipc.invoke) {
      const body = document.querySelector('.ptv-panel-body');
      if (body) body.innerHTML = '';
      if (body) body.appendChild(h('div', { className: 'ptv-error' }, 'ipcRenderer 不可用（请检查 preload 是否暴露 proma API）'));
      return;
    }
    try {
      const result = await ipc.invoke('proma:get-tree-states', {});
      if (result && result.ok) {
        state.lastTrees = result.trees || [];
        state.workspaceRoot = result.workspace_root;
      } else {
        state.lastTrees = [];
      }
      render();
    } catch (e) {
      const body = document.querySelector('.ptv-panel-body');
      if (body) {
        body.innerHTML = '';
        body.appendChild(h('div', { className: 'ptv-error' }, '获取失败: ' + (e && e.message)));
      }
    }
  }

  function startPolling() {
    if (state.pollTimer) clearInterval(state.pollTimer);
    state.pollTimer = setInterval(fetchData, POLL_INTERVAL_MS);
  }

  function stopPolling() {
    if (state.pollTimer) {
      clearInterval(state.pollTimer);
      state.pollTimer = null;
    }
  }

  // 注入到侧边栏顶部
  function mount() {
    if (document.getElementById('proma-tree-panel')) return; // 已挂载
    const { panel } = createPanel();
    // 尝试挂载到侧边栏顶部（Proma 的侧边栏是 React 渲染，我们找一些候选锚点）
    const candidates = [
      '.sidebar',
      '[class*="sidebar"]',
      'aside',
      '.left-panel',
      '.chat-sidebar'
    ];
    let mounted = false;
    for (const sel of candidates) {
      const host = document.querySelector(sel);
      if (host) {
        host.insertBefore(panel, host.firstChild);
        mounted = true;
        break;
      }
    }
    if (!mounted) {
      // fallback: 挂到 body 最前面，浮动定位
      if (!document.body) {
        // DOM 还未完全加载，等待下一次 mount 重试
        return;
      }
      panel.classList.add('ptv-floating');
      document.body.insertBefore(panel, document.body.firstChild);
    }
    fetchData();
    startPolling();
    fetchWatcherStatus();  // 补丁 M: 加载 watcher 状态
  }

  // 监听导航事件（虽然我们不直接控制 React，但可触发 UI 提示）
  function setupNavigationListener() {
    const ipc = getIpc();
    if (!ipc || !ipc.on) return;
    try {
      ipc.on('proma:navigate-to-session', (_event, arg) => {
        if (arg && arg.sessionId) {
          showToast('切换到会话: ' + arg.sessionId.slice(0, 8) + '... (React 端未集成则需手动切换)');
        }
      });
    } catch (_) {}
  }

  // 启动
  function init() {
    setupNavigationListener();
    // 等侧边栏 DOM 加载好（React 异步渲染）
    let attempts = 0;
    const tryMount = () => {
      attempts++;
      mount();
      if (attempts < 20 && !document.querySelector('.sidebar, [class*="sidebar"], aside')) {
        setTimeout(tryMount, 500);
      }
    };
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', tryMount);
    } else {
      tryMount();
    }
    // 监听 URL/hash 变化重新挂载（SPA 路由切换）
    window.addEventListener('hashchange', () => setTimeout(mount, 300));
  }

  // 兼容 preload 的 ipcRenderer.on 签名差异
  function shimIpcOn(name, cb) {
    // 占位，实际由 preload 决定
  }

  // ============================================================
  // 补丁 M: Watcher 控制 + 违规展示
  // ============================================================

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

  function updateWatcherBtn() {
    const btn = document.querySelector('.ptv-watcher-btn');
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

  async function toggleWatcher() {
    const ipc = getIpc();
    if (!ipc || !ipc.invoke) {
      showToast('IPC 不可用，无法切换 Watcher');
      return;
    }
    const target = !state.watcherEnabled;
    try {
      const result = await ipc.invoke('proma:watcher-toggle', { enabled: target });
      if (result && result.ok) {
        state.watcherEnabled = !!result.enabled;
        updateWatcherBtn();
        showToast('Watcher: ' + (state.watcherEnabled ? 'ON' : 'OFF'));
        if (state.watcherEnabled) {
          setTimeout(() => runWatcherNow(), 500);  // 启用时立即跑一次
        }
      } else {
        showToast('切换失败');
      }
    } catch (e) {
      showToast('切换失败: ' + (e && e.message));
    }
  }

  async function runWatcherNow() {
    const ipc = getIpc();
    if (!ipc || !ipc.invoke) {
      showToast('IPC 不可用');
      return;
    }
    showToast('Watcher 跑一轮...');
    try {
      const result = await ipc.invoke('proma:watcher-run-now', {});
      if (result && result.ok) {
        const count = (result.runs || []).length;
        const errs = (result.runs || []).filter(r => !r.ok).length;
        showToast('Watcher 完成: ' + count + ' workspace, ' + errs + ' 错误');
        // 立即刷新数据展示违规
        setTimeout(() => fetchData(), 500);
      }
    } catch (e) {
      showToast('Watcher 失败: ' + (e && e.message));
    }
  }

  function showViolations(leaf, treeId) {
    // 弹出违规详情浮窗
    const existing = document.getElementById('ptv-violations-popup');
    if (existing) existing.remove();

    const popup = h('div', { className: 'ptv-violations-popup', id: 'ptv-violations-popup' });
    popup.appendChild(h('div', { className: 'ptv-popup-title' }, '⚠ ' + leaf.leaf_id + ' 违规记录 (' + leaf.nudge_count + ')'));

    const log = leaf.nudge_log || [];
    if (log.length === 0) {
      popup.appendChild(h('div', { className: 'ptv-empty' }, '(无详细记录)'));
    } else {
      // 按时间倒序
      const sorted = log.slice().sort((a, b) => new Date(b.ts) - new Date(a.ts));
      for (const v of sorted) {
        const entry = h('div', { className: 'ptv-violation-entry ptv-severity-' + v.severity });
        entry.appendChild(h('div', { className: 'ptv-violation-header' }, [
          h('span', { className: 'ptv-violation-rule' }, v.rule_id),
          h('span', { className: 'ptv-violation-sev ptv-severity-' + v.severity }, v.severity),
          h('span', { className: 'ptv-violation-ts' }, formatRelative(v.ts))
        ]));
        entry.appendChild(h('div', { className: 'ptv-violation-evidence' }, v.evidence || '(无证据)'));
        if (v.suggest) {
          entry.appendChild(h('div', { className: 'ptv-violation-suggest' }, '→ ' + v.suggest));
        }
        if (v.send_message === false) {
          entry.appendChild(h('div', { className: 'ptv-violation-note' }, '(已超 nudge 上限, 仅记录)'));
        }
        popup.appendChild(entry);
      }
    }

    const closeBtn = h('button', { className: 'ptv-btn ptv-popup-close', onClick: () => popup.remove() }, '×');
    popup.appendChild(closeBtn);
    document.body.appendChild(popup);
    // 点击外部关闭
    setTimeout(() => {
      const handler = (ev) => {
        if (!popup.contains(ev.target)) {
          popup.remove();
          document.removeEventListener('click', handler);
        }
      };
      document.addEventListener('click', handler);
    }, 100);
  }

  // 暴露给外部调试
  window.__promaTreeView = { mount, fetchData, render, state, startPolling, stopPolling,
                             toggleWatcher, runWatcherNow, fetchWatcherStatus };

  init();
})();
