import * as vscode from 'vscode';
import * as os from 'os';
import * as path from 'path';
import { chromium, devices as pwDevices, Browser, BrowserContext, CDPSession, Page } from 'playwright';

interface PreviewState {
  url: string;
  deviceId: string;
  customWidth: number;
  customHeight: number;
  zoom: number;
  zoomMode: 'auto' | 'manual';
  orientation: 'portrait' | 'landscape';
  controlsVisible: boolean;
  colorScheme: 'light' | 'dark' | 'device';
}

const DEFAULT_STATE: PreviewState = {
  url: 'http://localhost:3000',
  deviceId: 'iphone14promax',
  customWidth: 390,
  customHeight: 844,
  zoom: 100,
  zoomMode: 'auto',
  orientation: 'portrait',
  controlsVisible: false,
  colorScheme: 'device'
};

const STATE_KEY = 'mobilePreview.state';

function getState(context: vscode.ExtensionContext): PreviewState {
  return context.globalState.get<PreviewState>(STATE_KEY, DEFAULT_STATE);
}

function updateState(context: vscode.ExtensionContext, patch: Partial<PreviewState>) {
  const next = { ...getState(context), ...patch };
  context.globalState.update(STATE_KEY, next);
}

interface DevicePreset {
  id: string;
  label: string;
  pwName?: string;
}

const DEVICE_PRESETS: DevicePreset[] = [
  { id: 'iphonese', label: 'iPhone SE', pwName: 'iPhone SE' },
  { id: 'iphone12', label: 'iPhone 12', pwName: 'iPhone 12' },
  { id: 'iphone14promax', label: 'iPhone 14/15 Pro Max', pwName: 'iPhone 14 Pro Max' },
  { id: 'iphone16pro', label: 'iPhone 16 Pro', pwName: 'iPhone 16 Pro' },
  { id: 'pixel7', label: 'Pixel 7', pwName: 'Pixel 7' },
  { id: 'pixel9pro', label: 'Pixel 9 Pro', pwName: 'Pixel 9 Pro' },
  { id: 'galaxys8', label: 'Galaxy S8', pwName: 'Galaxy S8' },
  { id: 'galaxys24', label: 'Galaxy S24', pwName: 'Galaxy S24' },
  { id: 'ipadmini', label: 'iPad Mini', pwName: 'iPad Mini' },
  { id: 'custom', label: 'Custom' }
];

interface DeviceSpec {
  width: number;
  height: number;
  deviceScaleFactor: number;
  isMobile: boolean;
  hasTouch: boolean;
  userAgent: string;
  colorScheme: 'light' | 'dark' | 'no-preference';
}

const CUSTOM_USER_AGENT =
  'Mozilla/5.0 (Linux; Android 14; Custom Device) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36';

function resolveColorScheme(state: PreviewState): 'light' | 'dark' | 'no-preference' {
  if (state.colorScheme !== 'device') {
    return state.colorScheme;
  }
  const kind = vscode.window.activeColorTheme.kind;
  return kind === vscode.ColorThemeKind.Light || kind === vscode.ColorThemeKind.HighContrastLight ? 'light' : 'dark';
}

function resolveDeviceSpec(state: PreviewState): DeviceSpec {
  const preset = DEVICE_PRESETS.find((p) => p.id === state.deviceId) ?? DEVICE_PRESETS[0];
  const colorScheme = resolveColorScheme(state);

  if (!preset.pwName) {
    let width = state.customWidth;
    let height = state.customHeight;
    if (state.orientation === 'landscape') {
      [width, height] = [height, width];
    }
    return {
      width,
      height,
      deviceScaleFactor: 3,
      isMobile: true,
      hasTouch: true,
      userAgent: CUSTOM_USER_AGENT,
      colorScheme
    };
  }

  const key = state.orientation === 'landscape' ? `${preset.pwName} landscape` : preset.pwName;
  const descriptor = (pwDevices as Record<string, any>)[key] ?? (pwDevices as Record<string, any>)[preset.pwName];
  // Playwright's `viewport` shrinks the height to leave room for a mobile browser's
  // address bar (matching real Mobile Safari/Chrome). Chrome DevTools' device toolbar
  // does not reserve that space, so use the full `screen` size to match the dimensions
  // DevTools shows (e.g. iPhone 14 Pro Max = 430x932, not 430x740).
  const size = descriptor.screen ?? descriptor.viewport;
  return {
    width: size.width,
    height: size.height,
    deviceScaleFactor: descriptor.deviceScaleFactor,
    isMobile: descriptor.isMobile,
    hasTouch: descriptor.hasTouch,
    userAgent: descriptor.userAgent,
    colorScheme
  };
}

export function activate(context: vscode.ExtensionContext) {
  const secondaryViewProvider = new MobilePreviewViewProvider(context);
  const primaryViewProvider = new MobilePreviewViewProvider(context);
  const panelManager = new MobilePreviewPanelManager(context);

  const allHostOwners = [panelManager, secondaryViewProvider, primaryViewProvider];

  function getActiveHost(): MobilePreviewHost | undefined {
    if (panelManager.isActive()) return panelManager.host;
    if (secondaryViewProvider.isVisible()) return secondaryViewProvider.host;
    if (primaryViewProvider.isVisible()) return primaryViewProvider.host;
    return allHostOwners.map((o) => o.host).find((h) => h !== undefined);
  }

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('mobilePreview.view', secondaryViewProvider, {
      webviewOptions: { retainContextWhenHidden: true }
    }),
    vscode.window.registerWebviewViewProvider('mobilePreview.viewPrimary', primaryViewProvider, {
      webviewOptions: { retainContextWhenHidden: true }
    }),
    vscode.commands.registerCommand('mobilePreview.open', () => panelManager.open()),
    vscode.commands.registerCommand('mobilePreview.refresh', () => getActiveHost()?.refresh()),
    vscode.commands.registerCommand('mobilePreview.setUrl', async () => {
      const state = getState(context);
      const value = await vscode.window.showInputBox({
        prompt: 'URL to preview (e.g. http://localhost:3000)',
        value: state.url,
        placeHolder: 'http://localhost:3000'
      });
      if (!value) return;
      updateState(context, { url: value });
      for (const owner of allHostOwners) {
        owner.host?.loadUrl(value);
      }
    }),
    vscode.commands.registerCommand('mobilePreview.screenshot', () => getActiveHost()?.takeScreenshot()),
    vscode.commands.registerCommand('mobilePreview.toggleControls', () => getActiveHost()?.toggleControls()),
    vscode.window.onDidChangeActiveColorTheme(() => {
      for (const owner of allHostOwners) {
        owner.host?.onActiveColorThemeChanged();
      }
    }),
    ...allHostOwners.map((owner) => ({ dispose: () => owner.dispose() }))
  );
}

export function deactivate() {}

interface ConsoleArgSummary {
  kind: 'primitive' | 'function' | 'object';
  type?: string;
  text?: string;
  subtype?: string;
  description?: string;
  objectId?: string;
  preview?: { overflow: boolean; properties: { name: string; type: string; value?: string }[] };
}

function summarizeRemoteObject(obj: any): ConsoleArgSummary {
  if (!obj || obj.type === 'undefined') return { kind: 'primitive', type: 'undefined', text: 'undefined' };
  if (obj.subtype === 'null') return { kind: 'primitive', type: 'null', text: 'null' };
  if (obj.type === 'string') return { kind: 'primitive', type: 'string', text: obj.value };
  if (obj.type === 'number' || obj.type === 'boolean') return { kind: 'primitive', type: obj.type, text: String(obj.value) };
  if (obj.type === 'bigint') return { kind: 'primitive', type: 'bigint', text: `${obj.unserializableValue || obj.description || '0'}n` };
  if (obj.type === 'symbol') return { kind: 'primitive', type: 'symbol', text: obj.description || 'Symbol()' };
  if (obj.type === 'function') {
    return { kind: 'function', text: obj.description ? obj.description.split('\n')[0] : 'ƒ ()' };
  }
  return {
    kind: 'object',
    subtype: obj.subtype,
    description: obj.description,
    objectId: obj.objectId,
    preview: obj.preview
      ? {
          overflow: !!obj.preview.overflow,
          properties: (obj.preview.properties || []).map((p: any) => ({ name: p.name, type: p.type, value: p.value }))
        }
      : undefined
  };
}

function formatStackTrace(details: any): string | undefined {
  const frames = details?.stackTrace?.callFrames;
  if (!frames || !frames.length) return undefined;
  return frames
    .map((f: any) => `    at ${f.functionName || '<anonymous>'} (${f.url || 'unknown'}:${f.lineNumber + 1}:${f.columnNumber + 1})`)
    .join('\n');
}

let consoleEntrySeq = 0;

class BrowserSession {
  private browser?: Browser;
  private context?: BrowserContext;
  private page?: Page;
  private cdp?: CDPSession;
  private specKey = '';
  private pendingUrl?: string;

  constructor(private readonly postMessage: (message: unknown) => void) {}

  async setDevice(spec: DeviceSpec) {
    const key = JSON.stringify(spec);
    if (key === this.specKey && this.page) {
      this.postMessage({ type: 'viewport', width: spec.width, height: spec.height });
      return;
    }
    this.specKey = key;

    if (!this.browser) {
      this.postMessage({ type: 'status', state: 'launching' });
      this.browser = await chromium.launch({ headless: true });
    }

    await this.teardownPage();

    this.context = await this.browser.newContext({
      viewport: { width: spec.width, height: spec.height },
      userAgent: spec.userAgent,
      deviceScaleFactor: spec.deviceScaleFactor,
      isMobile: spec.isMobile,
      hasTouch: spec.hasTouch,
      colorScheme: spec.colorScheme
    });
    this.page = await this.context.newPage();
    this.cdp = await this.context.newCDPSession(this.page);

    this.cdp.on('Page.screencastFrame', async (payload: any) => {
      this.postMessage({ type: 'frame', dataUrl: `data:image/jpeg;base64,${payload.data}` });
      try {
        await this.cdp?.send('Page.screencastFrameAck', { sessionId: payload.sessionId });
      } catch {
        // session may already have been torn down by a device change
      }
    });

    await this.cdp.send('Page.startScreencast', {
      format: 'jpeg',
      quality: 80,
      maxWidth: Math.round(spec.width * spec.deviceScaleFactor),
      maxHeight: Math.round(spec.height * spec.deviceScaleFactor),
      everyNthFrame: 1
    });

    await this.cdp.send('Runtime.enable').catch(() => {});
    this.cdp.on('Runtime.consoleAPICalled', (e: any) => {
      this.postMessage({
        type: 'console',
        entry: {
          id: ++consoleEntrySeq,
          level: e.type,
          timestamp: e.timestamp,
          args: (e.args || []).map(summarizeRemoteObject)
        }
      });
    });
    this.cdp.on('Runtime.exceptionThrown', (e: any) => {
      const details = e.exceptionDetails;
      const message = details?.exception?.description || details?.text || 'Uncaught exception';
      this.postMessage({
        type: 'console',
        entry: {
          id: ++consoleEntrySeq,
          level: 'error',
          timestamp: e.timestamp,
          args: [{ kind: 'primitive', type: 'string', text: message }],
          stack: formatStackTrace(details)
        }
      });
    });

    this.postMessage({ type: 'viewport', width: spec.width, height: spec.height });

    if (this.pendingUrl) {
      await this.loadUrl(this.pendingUrl);
    }
  }

  async loadUrl(url: string) {
    this.pendingUrl = url;
    if (!this.page) return;
    this.postMessage({ type: 'consoleClear' });
    this.postMessage({ type: 'status', state: 'loading' });
    try {
      await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
      this.postMessage({ type: 'status', state: 'ok' });
    } catch (err: any) {
      this.postMessage({ type: 'status', state: 'error', message: err?.message ?? String(err) });
    }
  }

  async refresh() {
    if (!this.page) return;
    this.postMessage({ type: 'consoleClear' });
    await this.page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
  }

  async getProperties(objectId: string): Promise<(ConsoleArgSummary & { name: string })[]> {
    if (!this.cdp) return [];
    try {
      const result: any = await this.cdp.send('Runtime.getProperties', {
        objectId,
        ownProperties: true,
        generatePreview: true
      });
      return (result.result || [])
        .filter((p: any) => p.enumerable !== false && p.name !== '__proto__' && p.value)
        .map((p: any) => ({ name: p.name, ...summarizeRemoteObject(p.value) }));
    } catch {
      return [];
    }
  }

  async dispatchTouch(kind: 'start' | 'move' | 'end', x: number, y: number) {
    if (!this.cdp) return;
    const typeMap = { start: 'touchStart', move: 'touchMove', end: 'touchEnd' } as const;
    const touchPoints = kind === 'end' ? [] : [{ x, y }];
    await this.cdp.send('Input.dispatchTouchEvent', { type: typeMap[kind], touchPoints }).catch(() => {});
  }

  async dispatchWheel(x: number, y: number, deltaX: number, deltaY: number) {
    if (!this.cdp) return;
    await this.cdp
      .send('Input.dispatchMouseEvent', { type: 'mouseWheel', x, y, deltaX, deltaY })
      .catch(() => {});
  }

  async insertText(text: string) {
    if (!this.cdp) return;
    await this.cdp.send('Input.insertText', { text }).catch(() => {});
  }

  private static readonly KEY_MAP: Record<string, { keyCode: number; code: string }> = {
    Backspace: { keyCode: 8, code: 'Backspace' },
    Enter: { keyCode: 13, code: 'Enter' },
    Tab: { keyCode: 9, code: 'Tab' },
    Escape: { keyCode: 27, code: 'Escape' },
    ArrowLeft: { keyCode: 37, code: 'ArrowLeft' },
    ArrowUp: { keyCode: 38, code: 'ArrowUp' },
    ArrowRight: { keyCode: 39, code: 'ArrowRight' },
    ArrowDown: { keyCode: 40, code: 'ArrowDown' },
    Delete: { keyCode: 46, code: 'Delete' }
  };

  async dispatchKey(key: string) {
    if (!this.cdp) return;
    const info = BrowserSession.KEY_MAP[key];
    if (!info) return;
    await this.cdp
      .send('Input.dispatchKeyEvent', { type: 'keyDown', windowsVirtualKeyCode: info.keyCode, code: info.code, key })
      .catch(() => {});
    await this.cdp
      .send('Input.dispatchKeyEvent', { type: 'keyUp', windowsVirtualKeyCode: info.keyCode, code: info.code, key })
      .catch(() => {});
  }

  async screenshot(): Promise<Buffer | null> {
    if (!this.page) return null;
    return this.page.screenshot({ type: 'png' });
  }

  private async teardownPage() {
    try {
      await this.cdp?.send('Page.stopScreencast');
    } catch {
      // ignore
    }
    this.cdp = undefined;
    await this.page?.close().catch(() => {});
    await this.context?.close().catch(() => {});
    this.page = undefined;
    this.context = undefined;
  }

  async dispose() {
    await this.teardownPage();
    await this.browser?.close().catch(() => {});
    this.browser = undefined;
  }
}

/**
 * Owns the BrowserSession and message-handling logic for one hosted webview
 * (either the sidebar view or the editor panel). The two host classes below
 * each create one of these and forward webview lifecycle events into it.
 */
class MobilePreviewHost {
  private session: BrowserSession;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly postMessage: (message: unknown) => void
  ) {
    this.session = new BrowserSession(postMessage);
  }

  public async refresh() {
    await this.session.refresh();
  }

  public async loadUrl(url: string) {
    await this.session.loadUrl(url);
  }

  public toggleControls() {
    const visible = !getState(this.context).controlsVisible;
    updateState(this.context, { controlsVisible: visible });
    this.postMessage({ type: 'controlsVisible', visible });
  }

  public async onActiveColorThemeChanged() {
    const state = getState(this.context);
    if (state.colorScheme === 'device') {
      await this.session.setDevice(resolveDeviceSpec(state));
    }
  }

  public async handleMessage(message: any) {
    switch (message?.type) {
      case 'ready': {
        const state = getState(this.context);
        this.postMessage({ type: 'init', state, devicePresets: DEVICE_PRESETS.map(({ id, label }) => ({ id, label })) });
        await this.session.setDevice(resolveDeviceSpec(state));
        await this.session.loadUrl(state.url);
        break;
      }
      case 'deviceChange': {
        updateState(this.context, {
          deviceId: message.deviceId,
          orientation: message.orientation,
          customWidth: message.customWidth,
          customHeight: message.customHeight,
          colorScheme: message.colorScheme
        });
        await this.session.setDevice(resolveDeviceSpec(getState(this.context)));
        break;
      }
      case 'loadUrl':
        updateState(this.context, { url: message.url });
        await this.session.loadUrl(message.url);
        break;
      case 'refresh':
        await this.session.refresh();
        break;
      case 'screenshot':
        await this.takeScreenshot();
        break;
      case 'touch':
        await this.session.dispatchTouch(message.kind, message.x, message.y);
        break;
      case 'wheel':
        await this.session.dispatchWheel(message.x, message.y, message.deltaX, message.deltaY);
        break;
      case 'text':
        await this.session.insertText(message.text);
        break;
      case 'key':
        await this.session.dispatchKey(message.key);
        break;
      case 'consoleGetProperties': {
        const properties = await this.session.getProperties(message.objectId);
        this.postMessage({ type: 'consoleProperties', requestId: message.requestId, properties });
        break;
      }
      case 'saveState':
        updateState(this.context, message.state ?? {});
        break;
      case 'error':
        vscode.window.showErrorMessage(`Mobile Preview: ${message.message}`);
        break;
    }
  }

  public async takeScreenshot() {
    const buffer = await this.session.screenshot();
    if (!buffer) {
      vscode.window.showWarningMessage('Mobile Preview: nothing to capture yet — load a URL first.');
      return;
    }

    const defaultUri = vscode.Uri.file(path.join(os.homedir(), 'Downloads', `mobile-preview-${Date.now()}.png`));
    const target = await vscode.window.showSaveDialog({
      defaultUri,
      filters: { Images: ['png'] },
      title: 'Save Mobile Preview Screenshot'
    });
    if (!target) return;

    await vscode.workspace.fs.writeFile(target, buffer);
    vscode.window
      .showInformationMessage(`Mobile Preview: screenshot saved to ${target.fsPath}`, 'Open', 'Reveal in Folder')
      .then((choice) => {
        if (choice === 'Open') {
          vscode.env.openExternal(target);
        } else if (choice === 'Reveal in Folder') {
          vscode.commands.executeCommand('revealFileInOS', target);
        }
      });
  }

  public getHtml(webview: vscode.Webview): string {
    return buildHtml(webview, this.context.extensionUri);
  }

  public dispose() {
    this.session.dispose();
  }
}

class MobilePreviewViewProvider implements vscode.WebviewViewProvider {
  private view?: vscode.WebviewView;
  public host?: MobilePreviewHost;

  constructor(private readonly context: vscode.ExtensionContext) {}

  public isVisible(): boolean {
    return this.view?.visible ?? false;
  }

  resolveWebviewView(webviewView: vscode.WebviewView) {
    this.view = webviewView;
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'media')]
    };
    this.host = new MobilePreviewHost(this.context, (message) => webviewView.webview.postMessage(message));
    webviewView.webview.html = this.host.getHtml(webviewView.webview);
    webviewView.webview.onDidReceiveMessage((message) => this.host?.handleMessage(message));
    webviewView.onDidDispose(() => {
      this.host?.dispose();
      this.host = undefined;
      this.view = undefined;
    });
  }

  public dispose() {
    this.host?.dispose();
  }
}

class MobilePreviewPanelManager {
  public static readonly viewType = 'mobilePreview.panel';

  private panel?: vscode.WebviewPanel;
  public host?: MobilePreviewHost;

  constructor(private readonly context: vscode.ExtensionContext) {}

  public isActive(): boolean {
    return this.panel?.active ?? false;
  }

  public open() {
    if (this.panel) {
      this.panel.reveal(vscode.ViewColumn.Beside);
      return;
    }

    this.panel = vscode.window.createWebviewPanel(
      MobilePreviewPanelManager.viewType,
      'Mobile Preview',
      vscode.ViewColumn.Beside,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'media')]
      }
    );
    this.panel.iconPath = vscode.Uri.joinPath(this.context.extensionUri, 'media', 'icon.svg');
    const panel = this.panel;
    this.host = new MobilePreviewHost(this.context, (message) => panel.webview.postMessage(message));

    this.panel.webview.html = this.host.getHtml(this.panel.webview);
    this.panel.webview.onDidReceiveMessage((message) => this.host?.handleMessage(message));
    this.panel.onDidDispose(() => {
      this.host?.dispose();
      this.host = undefined;
      this.panel = undefined;
    });
  }

  public dispose() {
    this.host?.dispose();
    this.panel?.dispose();
  }
}

const ICONS = {
  rotate:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>',
  gear:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
  sun:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>',
  moon:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>',
  monitor:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>',
  globe:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><line x1="3" y1="12" x2="21" y2="12"/><path d="M12 3a15 15 0 0 1 0 18 15 15 0 0 1 0-18z"/></svg>',
  arrowRight:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" y1="12" x2="20" y2="12"/><polyline points="14 6 20 12 14 18"/></svg>',
  refresh:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-3-6.7"/><polyline points="21 3 21 9 15 9"/></svg>',
  camera:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>',
  terminal:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>',
  trash:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/></svg>',
  close:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
  minus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="5" y1="12" x2="19" y2="12"/></svg>',
  plus:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>',
  fit:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3m11-5v3a2 2 0 0 1-2 2h-3"/></svg>',
  warning:
    '<svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3.5 2.5 20h19L12 3.5Z"/><line x1="12" y1="9.5" x2="12" y2="14"/><circle cx="12" cy="17" r="0.9" fill="currentColor" stroke="none"/></svg>',
  empty:
    '<svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><line x1="3" y1="12" x2="21" y2="12"/><path d="M12 3a15 15 0 0 1 0 18 15 15 0 0 1 0-18z"/></svg>'
};

function buildHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'main.js'));
  const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'media', 'style.css'));
  const nonce = getNonce();

  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}'; img-src ${webview.cspSource} data:;">
  <link href="${styleUri}" rel="stylesheet" />
  <title>Mobile Preview</title>
</head>
<body class="controls-hidden">
  <div id="topbar">
    <div class="tb-group">
      <select id="device-select"></select>
    </div>
    <div class="tb-group" id="dims-group">
      <input id="width-input" type="number" min="200" max="2000" title="Width (px)" />
      <span class="dim-sep">&times;</span>
      <input id="height-input" type="number" min="200" max="2000" title="Height (px)" />
    </div>
    <button id="rotate-btn" class="icon-btn" title="Rotate device">${ICONS.rotate}</button>
    <div class="tb-spacer"></div>
    <div class="popover-anchor">
      <button id="settings-btn" class="icon-btn" title="Settings">${ICONS.gear}</button>
      <div id="settings-popover" class="popover hidden">
        <div class="popover-section">
          <span class="popover-label">Theme</span>
          <div class="segmented" id="theme-group">
            <button data-scheme="light" title="Light theme">${ICONS.sun}</button>
            <button data-scheme="dark" title="Dark theme">${ICONS.moon}</button>
            <button data-scheme="device" title="Match VS Code theme">${ICONS.monitor}</button>
          </div>
        </div>
        <div class="popover-section">
          <span class="popover-label">Zoom</span>
          <div class="segmented">
            <button id="zoom-out-btn" title="Zoom out">${ICONS.minus}</button>
            <span id="zoom-label">100%</span>
            <button id="zoom-in-btn" title="Zoom in">${ICONS.plus}</button>
            <button id="fit-btn" title="Auto zoom to fit">${ICONS.fit}</button>
          </div>
        </div>
      </div>
    </div>
  </div>
  <div id="addressbar">
    <div id="addressbar-pill">
      <span class="addr-icon">${ICONS.globe}</span>
      <input id="url-input" type="text" placeholder="http://localhost:3000" />
      <button id="go-btn" class="icon-btn" title="Load URL">${ICONS.arrowRight}</button>
    </div>
  </div>
  <div id="stage">
    <div id="preview-wrapper">
      <canvas id="preview-canvas" tabindex="0"></canvas>
    </div>
    <div id="floating-toolbar">
      <button id="reload-btn" class="icon-btn" title="Reload">${ICONS.refresh}</button>
      <button id="screenshot-btn" class="icon-btn" title="Take screenshot">${ICONS.camera}</button>
      <button id="console-btn" class="icon-btn" title="Toggle console">${ICONS.terminal}</button>
    </div>
    <div id="status-overlay" class="hidden">
      <div id="status-card">
        <div id="status-spinner" class="hidden"></div>
        <div id="status-icon" class="hidden">${ICONS.warning}</div>
        <div id="status-icon-empty" class="hidden">${ICONS.empty}</div>
        <div id="status-title"></div>
        <button id="status-retry-btn" class="hidden">Retry</button>
      </div>
    </div>
    <div id="console-panel">
      <div id="console-header">
        <span id="console-title">Console</span>
        <span id="console-count">0</span>
        <span class="flex-spacer"></span>
        <button id="console-clear-btn" class="icon-btn" title="Clear console">${ICONS.trash}</button>
        <button id="console-close-btn" class="icon-btn" title="Collapse console">${ICONS.close}</button>
      </div>
      <div id="console-body"></div>
    </div>
  </div>
  <div id="touch-cursor" class="hidden"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
}

function getNonce() {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
