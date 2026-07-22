// ============================================================
// 补丁 L (v0.17): 树形 UI 面板 IPC 桥接
// 暴露 window.electronAPI.proma 给 renderer 进程
// ============================================================
try {
  const promaBridge = {
    invoke: (channel, ...args) => {
      // 补丁 L (UI 面板)
      if (channel === 'proma:get-tree-states' || channel === 'proma:tree-view-ready' || channel === 'proma:dom-dump') {
        return import_electron.ipcRenderer.invoke(channel, ...args);
      }
      // 补丁 M (Watcher 控制)
      if (['proma:watcher-status', 'proma:watcher-toggle', 'proma:watcher-set-interval',
           'proma:watcher-run-now', 'proma:watcher-config-patch'].includes(channel)) {
        return import_electron.ipcRenderer.invoke(channel, ...args);
      }
      return Promise.reject(new Error('unknown proma invoke channel: ' + channel));
    },
    send: (channel, ...args) => {
      if (channel === 'proma:navigate-to-session') {
        import_electron.ipcRenderer.send(channel, ...args);
        return true;
      }
      return false;
    },
    on: (channel, listener) => {
      if (channel === 'proma:navigate-to-session' || channel === 'proma:navigate-failed') {
        const wrapped = (_event, ...args) => listener(...args);
        import_electron.ipcRenderer.on(channel, wrapped);
        return () => import_electron.ipcRenderer.removeListener(channel, wrapped);
      }
      return () => {};
    }
  };
  // 附加到已暴露的 electronAPI（contextBridge 不允许二次 exposeInMainWorld 同名，所以挂到子对象）
  // 但已 expose 的对象是 frozen proxy，无法直接添加属性。改用单独 expose
  import_electron.contextBridge.exposeInMainWorld("promaTreeIpc", promaBridge);
} catch (e) {
  console.error('[Patch L preload] failed to expose promaTreeIpc:', e);
}
