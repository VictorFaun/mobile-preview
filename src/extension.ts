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
  const manager = new MobilePreviewPanelManager(context);

  context.subscriptions.push(
    vscode.commands.registerCommand('mobilePreview.open', () => manager.open()),
    vscode.commands.registerCommand('mobilePreview.refresh', () => manager.refresh()),
    vscode.commands.registerCommand('mobilePreview.setUrl', async () => {
      const state = manager.getState();
      const value = await vscode.window.showInputBox({
        prompt: 'URL to preview (e.g. http://localhost:3000)',
        value: state.url,
        placeHolder: 'http://localhost:3000'
      });
      if (value) {
        manager.updateState({ url: value });
        manager.loadUrl(value);
      }
    }),
    vscode.commands.registerCommand('mobilePreview.screenshot', () => manager.takeScreenshot()),
    vscode.commands.registerCommand('mobilePreview.toggleControls', () => manager.toggleControls()),
    vscode.window.onDidChangeActiveColorTheme(() => manager.onActiveColorThemeChanged()),
    { dispose: () => manager.dispose() }
  );
}

export function deactivate() {}

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

    this.postMessage({ type: 'viewport', width: spec.width, height: spec.height });

    if (this.pendingUrl) {
      await this.loadUrl(this.pendingUrl);
    }
  }

  async loadUrl(url: string) {
    this.pendingUrl = url;
    if (!this.page) return;
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
    await this.page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {});
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

class MobilePreviewPanelManager {
  public static readonly viewType = 'mobilePreview.panel';

  private panel?: vscode.WebviewPanel;
  private session?: BrowserSession;

  constructor(private readonly context: vscode.ExtensionContext) {}

  public getState(): PreviewState {
    return this.context.globalState.get<PreviewState>(STATE_KEY, DEFAULT_STATE);
  }

  public updateState(patch: Partial<PreviewState>) {
    const next = { ...this.getState(), ...patch };
    this.context.globalState.update(STATE_KEY, next);
  }

  public postMessage(message: unknown) {
    this.panel?.webview.postMessage(message);
  }

  public async refresh() {
    await this.session?.refresh();
  }

  public async loadUrl(url: string) {
    await this.session?.loadUrl(url);
  }

  public toggleControls() {
    const visible = !this.getState().controlsVisible;
    this.updateState({ controlsVisible: visible });
    this.postMessage({ type: 'controlsVisible', visible });
  }

  public async onActiveColorThemeChanged() {
    const state = this.getState();
    if (state.colorScheme === 'device') {
      await this.session?.setDevice(resolveDeviceSpec(state));
    }
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
    this.session = new BrowserSession((message) => this.postMessage(message));

    this.panel.webview.html = this.getHtml(this.panel.webview);
    this.panel.webview.onDidReceiveMessage((message) => this.handleMessage(message));
    this.panel.onDidDispose(() => {
      this.session?.dispose();
      this.session = undefined;
      this.panel = undefined;
    });
  }

  public dispose() {
    this.session?.dispose();
    this.panel?.dispose();
  }

  private async handleMessage(message: any) {
    switch (message?.type) {
      case 'ready': {
        const state = this.getState();
        this.postMessage({ type: 'init', state, devicePresets: DEVICE_PRESETS.map(({ id, label }) => ({ id, label })) });
        await this.session?.setDevice(resolveDeviceSpec(state));
        await this.session?.loadUrl(state.url);
        break;
      }
      case 'deviceChange': {
        this.updateState({
          deviceId: message.deviceId,
          orientation: message.orientation,
          customWidth: message.customWidth,
          customHeight: message.customHeight,
          colorScheme: message.colorScheme
        });
        await this.session?.setDevice(resolveDeviceSpec(this.getState()));
        break;
      }
      case 'loadUrl':
        this.updateState({ url: message.url });
        await this.session?.loadUrl(message.url);
        break;
      case 'touch':
        await this.session?.dispatchTouch(message.kind, message.x, message.y);
        break;
      case 'wheel':
        await this.session?.dispatchWheel(message.x, message.y, message.deltaX, message.deltaY);
        break;
      case 'text':
        await this.session?.insertText(message.text);
        break;
      case 'key':
        await this.session?.dispatchKey(message.key);
        break;
      case 'saveState':
        this.updateState(message.state ?? {});
        break;
      case 'error':
        vscode.window.showErrorMessage(`Mobile Preview: ${message.message}`);
        break;
    }
  }

  public async takeScreenshot() {
    if (!this.session) return;
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

  private getHtml(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'main.js'));
    const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'style.css'));
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
  <div id="toolbar-row1" class="toolbar">
    <div class="toolbar-group">
      <label for="device-select">Device</label>
      <select id="device-select"></select>
    </div>
    <div class="toolbar-group">
      <input id="width-input" type="number" min="200" max="2000" title="Width (px)" />
      <span class="dim-sep">&times;</span>
      <input id="height-input" type="number" min="200" max="2000" title="Height (px)" />
      <button id="rotate-btn" title="Rotate device">&#8635;</button>
    </div>
    <div class="toolbar-group" id="theme-group">
      <button id="theme-light-btn" title="Light theme" data-scheme="light">&#9728;</button>
      <button id="theme-dark-btn" title="Dark theme" data-scheme="dark">&#9789;</button>
      <button id="theme-device-btn" title="Match VS Code theme" data-scheme="device">&#9682;</button>
    </div>
    <div class="toolbar-group zoom-group">
      <button id="fit-btn" title="Auto zoom to fit">Fit</button>
      <button id="zoom-out-btn" title="Zoom out">&minus;</button>
      <span id="zoom-label">100%</span>
      <button id="zoom-in-btn" title="Zoom in">+</button>
    </div>
  </div>
  <div id="toolbar-row2" class="toolbar">
    <input id="url-input" type="text" placeholder="http://localhost:3000" />
    <button id="go-btn" title="Load URL">Go</button>
  </div>
  <div id="stage">
    <div id="preview-wrapper">
      <canvas id="preview-canvas" tabindex="0"></canvas>
    </div>
    <div id="status-overlay" class="hidden"></div>
  </div>
  <div id="touch-cursor" class="hidden"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

function getNonce() {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
