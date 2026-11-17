// Runs in the page before the panels load: a stand-in for Tauri's bridge, so the built desktop panels
// (tauri-client/panels-ui/dist) run in an ordinary browser. Commands go to Node (`__vttInvoke`, exposed
// by desktop.mjs), which answers them from the smoke stack; events come back through `__vttEmit`.
(() => {
  const callbacks = new Map();
  const listeners = new Map(); // event name -> Set of callback ids
  let nextId = 1;

  window.__TAURI_INTERNALS__ = {
    metadata: {
      currentWindow: { label: 'main' },
      currentWebview: { label: 'main', windowLabel: 'main' },
    },
    transformCallback(callback, once) {
      const id = nextId++;
      callbacks.set(id, (payload) => {
        if (once) callbacks.delete(id);
        callback?.(payload);
      });
      return id;
    },
    unregisterCallback(id) {
      callbacks.delete(id);
    },
    convertFileSrc: (path) => path,
    async invoke(cmd, args = {}) {
      if (cmd === 'plugin:event|listen') {
        if (!listeners.has(args.event)) listeners.set(args.event, new Set());
        listeners.get(args.event).add(args.handler);
        return args.handler;
      }
      if (cmd === 'plugin:event|unlisten') {
        listeners.get(args.event)?.delete(args.eventId);
        return null;
      }
      if (cmd.startsWith('plugin:')) return null;
      const answer = JSON.parse(await window.__vttInvoke(cmd, JSON.stringify(args)));
      if (answer.error !== undefined) throw answer.error;
      return answer.value;
    },
  };
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = {
    unregisterListener(event, id) {
      listeners.get(event)?.delete(id);
    },
  };
  window.__vttEmit = (event, payload) => {
    for (const id of listeners.get(event) ?? []) callbacks.get(id)?.({ event, id, payload });
  };
})();
