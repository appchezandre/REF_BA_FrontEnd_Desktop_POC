const { app, BrowserWindow, Menu, ipcMain, session } = require('electron');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const isDevelopment = Boolean(process.env.ELECTRON_RENDERER_URL);

// ---------------------------------------------------------------------------
// WindowManager : registre central des fenêtres.
// Chaque fenêtre reçoit un identifiant stable et un contexte transmis au
// renderer via le canal `window:get-context`.
// ---------------------------------------------------------------------------

/** @type {Map<string, { window: BrowserWindow, context: object }>} */
const windows = new Map();

function getEntryByWebContents(webContents) {
  for (const entry of windows.values()) {
    if (entry.window.webContents === webContents) {
      return entry;
    }
  }
  return undefined;
}

function getSenderWindow(event) {
  const entry = getEntryByWebContents(event.sender);
  return entry ? entry.window : undefined;
}

function isAllowedNavigation(url) {
  if (isDevelopment) {
    return url.startsWith(process.env.ELECTRON_RENDERER_URL);
  }
  return url.startsWith('file://');
}

function createWindow(partialContext) {
  const windowId = `win-${randomUUID()}`;
  const context = { ...partialContext, windowId };

  const window = new BrowserWindow({
    width: 1280,
    height: 832,
    minWidth: 800,
    minHeight: 600,
    // Barre de titre personnalisée rendue par Angular (style VSCode).
    frame: false,
    backgroundColor: '#1e1e1e',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  windows.set(windowId, { window, context });

  window.once('ready-to-show', () => window.show());
  window.on('maximize', () =>
    window.webContents.send('window:maximized-changed', true)
  );
  window.on('unmaximize', () =>
    window.webContents.send('window:maximized-changed', false)
  );
  window.on('closed', () => windows.delete(windowId));

  // Sécurité : pas de window.open ni de navigation hors de l'application.
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => {
    if (!isAllowedNavigation(url)) {
      event.preventDefault();
    }
  });

  if (isDevelopment) {
    window.loadURL(process.env.ELECTRON_RENDERER_URL);
    if (context.mode === 'main') {
      window.webContents.openDevTools({ mode: 'detach' });
    }
  } else {
    window.loadFile(
      path.join(__dirname, '../dist/desktop-app/browser/index.html')
    );
  }

  return { windowId, window };
}

// ---------------------------------------------------------------------------
// Validation IPC : toute donnée venant d'un renderer est non fiable.
// ---------------------------------------------------------------------------

function isNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 512;
}

/** Ne conserve que les champs attendus d'un onglet, avec leur type vérifié. */
function sanitizeTab(raw) {
  if (typeof raw !== 'object' || raw === null) {
    return undefined;
  }
  if (
    !isNonEmptyString(raw.id) ||
    !isNonEmptyString(raw.type) ||
    !isNonEmptyString(raw.title)
  ) {
    return undefined;
  }
  const tab = {
    id: raw.id,
    type: raw.type,
    title: raw.title,
    closable: raw.closable !== false,
    dirty: raw.dirty === true,
    pinned: raw.pinned === true,
    detached: true
  };
  if (isNonEmptyString(raw.entityId)) {
    tab.entityId = raw.entityId;
  }
  if (isNonEmptyString(raw.icon)) {
    tab.icon = raw.icon;
  }
  // État d'écran opaque (onglets internes, brouillons…) : transporté tel quel
  // s'il s'agit d'un objet simple ; la fenêtre destination le revalide.
  if (raw.state !== null && typeof raw.state === 'object' && !Array.isArray(raw.state)) {
    tab.state = raw.state;
  }
  return tab;
}

// ---------------------------------------------------------------------------
// Synchronisation inter-fenêtres : bus de publication/diffusion par sujet.
// Le main ne porte aucune logique métier : il valide, retient le dernier
// état par sujet (rattrapage des fenêtres ouvertes après coup) et rediffuse
// aux autres fenêtres. Les données restent non fiables : chaque renderer
// revalide ce qu'il reçoit.
// ---------------------------------------------------------------------------

/** @type {Map<string, unknown>} Dernier état publié par sujet. */
const syncRegistry = new Map();

const SYNC_TOPIC_PATTERN = /^[a-z0-9][a-z0-9/._-]{0,127}$/i;

function isValidTopic(topic) {
  return typeof topic === 'string' && SYNC_TOPIC_PATTERN.test(topic);
}

function broadcastSyncEvent(sourceEntry, topic, data) {
  for (const entry of windows.values()) {
    if (entry.window !== sourceEntry.window && !entry.window.isDestroyed()) {
      entry.window.webContents.send('sync:event', {
        topic,
        data,
        sourceWindowId: sourceEntry.context.windowId
      });
    }
  }
}

// ---------------------------------------------------------------------------
// IpcRouter : enregistrement centralisé des canaux autorisés.
// ---------------------------------------------------------------------------

function registerIpcHandlers() {
  ipcMain.handle('app:get-version', () => app.getVersion());

  ipcMain.handle('window:get-context', (event) => {
    const entry = getEntryByWebContents(event.sender);
    return entry ? entry.context : null;
  });

  ipcMain.handle('window:minimize', (event) => {
    getSenderWindow(event)?.minimize();
  });

  ipcMain.handle('window:toggle-maximize', (event) => {
    const window = getSenderWindow(event);
    if (!window) {
      return false;
    }
    if (window.isMaximized()) {
      window.unmaximize();
    } else {
      window.maximize();
    }
    return window.isMaximized();
  });

  ipcMain.handle('window:is-maximized', (event) => {
    return getSenderWindow(event)?.isMaximized() ?? false;
  });

  ipcMain.handle('window:close', (event) => {
    getSenderWindow(event)?.close();
  });

  ipcMain.handle('sync:publish', (event, payload) => {
    const source = getEntryByWebContents(event.sender);
    if (!source) {
      return { ok: false, error: 'unknown-source-window' };
    }
    if (typeof payload !== 'object' || payload === null || !isValidTopic(payload.topic)) {
      return { ok: false, error: 'invalid-topic' };
    }
    syncRegistry.set(payload.topic, payload.data);
    broadcastSyncEvent(source, payload.topic, payload.data);
    return { ok: true };
  });

  ipcMain.handle('sync:get-state', (_event, topic) => {
    if (!isValidTopic(topic)) {
      return null;
    }
    return syncRegistry.get(topic) ?? null;
  });

  ipcMain.handle('window:detach-tab', (event, payload) => {
    const source = getEntryByWebContents(event.sender);
    if (!source) {
      return { ok: false, error: 'unknown-source-window' };
    }
    const tab = sanitizeTab(payload?.tab);
    if (!tab) {
      return { ok: false, error: 'invalid-tab-payload' };
    }
    try {
      const { windowId } = createWindow({
        mode: 'detached-tab',
        initialTab: tab
      });
      return { ok: true, windowId };
    } catch {
      // La fenêtre source conserve l'onglet : elle ne le retire qu'après ok.
      return { ok: false, error: 'window-creation-failed' };
    }
  });
}

app.whenReady().then(() => {
  // Supprime le menu par défaut : ses accélérateurs (Ctrl+W, Ctrl+R, F11)
  // court-circuiteraient les raccourcis du renderer.
  Menu.setApplicationMenu(null);

  // Aucune permission web (caméra, notifications…) n'est requise à ce stade.
  session.defaultSession.setPermissionRequestHandler(
    (_webContents, _permission, callback) => callback(false)
  );

  registerIpcHandlers();
  createWindow({ mode: 'main' });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow({ mode: 'main' });
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
