(function () {
  const vscode = acquireVsCodeApi();

  const deviceSelect = document.getElementById('device-select');
  const widthInput = document.getElementById('width-input');
  const heightInput = document.getElementById('height-input');
  const rotateBtn = document.getElementById('rotate-btn');
  const fitBtn = document.getElementById('fit-btn');
  const zoomOutBtn = document.getElementById('zoom-out-btn');
  const zoomInBtn = document.getElementById('zoom-in-btn');
  const zoomLabel = document.getElementById('zoom-label');
  const urlInput = document.getElementById('url-input');
  const goBtn = document.getElementById('go-btn');
  const themeButtons = Array.from(document.querySelectorAll('#theme-group button'));
  const stage = document.getElementById('stage');
  const stageWrapper = document.getElementById('stage-wrapper');
  const previewWrapper = document.getElementById('preview-wrapper');
  const canvas = document.getElementById('preview-canvas');
  const statusOverlay = document.getElementById('status-overlay');
  const statusCard = document.getElementById('status-card');
  const statusSpinner = document.getElementById('status-spinner');
  const statusIcon = document.getElementById('status-icon');
  const statusIconEmpty = document.getElementById('status-icon-empty');
  const statusTitle = document.getElementById('status-title');
  const statusRetryBtn = document.getElementById('status-retry-btn');
  const touchCursor = document.getElementById('touch-cursor');
  const consoleBtn = document.getElementById('console-btn');
  const consolePanel = document.getElementById('console-panel');
  const consoleBody = document.getElementById('console-body');
  const consoleCount = document.getElementById('console-count');
  const consoleClearBtn = document.getElementById('console-clear-btn');
  const consoleCloseBtn = document.getElementById('console-close-btn');
  const consoleResizeHandle = document.getElementById('console-resize-handle');
  const elementsTabBtn = document.getElementById('elements-tab-btn');
  const consoleTabBtn = document.getElementById('console-tab-btn');
  const elementsBody = document.getElementById('elements-body');
  const elementsRefreshBtn = document.getElementById('elements-refresh-btn');
  const domHighlight = document.getElementById('dom-highlight');
  const domHighlightLabel = document.getElementById('dom-highlight-label');
  const domBoxMargin = domHighlight.querySelector('.dom-box-margin');
  const domBoxBorder = domHighlight.querySelector('.dom-box-border');
  const domBoxPadding = domHighlight.querySelector('.dom-box-padding');
  const domBoxContent = domHighlight.querySelector('.dom-box-content');
  const settingsBtn = document.getElementById('settings-btn');
  const settingsPopover = document.getElementById('settings-popover');
  const reloadBtn = document.getElementById('reload-btn');
  const screenshotBtn = document.getElementById('screenshot-btn');
  const elementsBtn = document.getElementById('elements-btn');
  const floatingToolbar = document.getElementById('floating-toolbar');
  const ctx = canvas.getContext('2d');

  const STAGE_PADDING = 28;

  let state = {
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

  let viewport = { w: 390, h: 844 };
  const frameImage = new Image();

  let saveTimer = null;
  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => vscode.postMessage({ type: 'saveState', state }), 300);
  }

  function computeFitZoom(w, h) {
    const availW = Math.max(stage.clientWidth - STAGE_PADDING * 2, 50);
    const availH = Math.max(stage.clientHeight - STAGE_PADDING * 2, 50);
    const scale = Math.min(availW / w, availH / h, 2);
    return Math.max(10, Math.round(scale * 100));
  }

  function render() {
    const { w, h } = viewport;

    if (state.zoomMode === 'auto') {
      state.zoom = computeFitZoom(w, h);
    }

    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    canvas.style.transform = `scale(${state.zoom / 100})`;
    // Use the exact (unrounded) scaled size here — it must match what
    // `transform: scale()` renders to the sub-pixel, or the wrapper's clip
    // boundary and the canvas's actual edge disagree by a fraction of a
    // pixel, letting a hairline of the canvas's own white background show.
    previewWrapper.style.width = w * (state.zoom / 100) + 'px';
    previewWrapper.style.height = h * (state.zoom / 100) + 'px';
    domHighlight.style.width = w + 'px';
    domHighlight.style.height = h + 'px';
    domHighlight.style.transform = `scale(${state.zoom / 100})`;

    zoomLabel.textContent = state.zoom + '%';
    fitBtn.classList.toggle('active', state.zoomMode === 'auto');
    widthInput.value = w;
    heightInput.value = h;
    const isCustom = state.deviceId === 'custom';
    widthInput.disabled = !isCustom;
    heightInput.disabled = !isCustom;
    deviceSelect.value = state.deviceId;
    urlInput.value = state.url;
    themeButtons.forEach((btn) => btn.classList.toggle('active', btn.dataset.scheme === state.colorScheme));
  }

  function sendDeviceChange() {
    vscode.postMessage({
      type: 'deviceChange',
      deviceId: state.deviceId,
      orientation: state.orientation,
      customWidth: state.customWidth,
      customHeight: state.customHeight,
      colorScheme: state.colorScheme
    });
    scheduleSave();
  }

  function loadUrl(url) {
    if (!url || !url.trim()) {
      showEmptyStatus();
      return;
    }
    let normalized = url.trim();
    if (!/^https?:\/\//i.test(normalized)) {
      normalized = 'http://' + normalized;
    }
    state.url = normalized;
    urlInput.value = normalized;
    vscode.postMessage({ type: 'loadUrl', url: normalized });
    scheduleSave();
  }

  deviceSelect.addEventListener('change', () => {
    state.deviceId = deviceSelect.value;
    sendDeviceChange();
  });

  widthInput.addEventListener('change', () => {
    const val = parseInt(widthInput.value, 10);
    if (!isNaN(val)) {
      state.customWidth = val;
      sendDeviceChange();
    }
  });

  heightInput.addEventListener('change', () => {
    const val = parseInt(heightInput.value, 10);
    if (!isNaN(val)) {
      state.customHeight = val;
      sendDeviceChange();
    }
  });

  rotateBtn.addEventListener('click', () => {
    state.orientation = state.orientation === 'portrait' ? 'landscape' : 'portrait';
    sendDeviceChange();
  });

  // --- settings popover ---
  settingsBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    settingsPopover.classList.toggle('hidden');
  });
  settingsPopover.addEventListener('click', (e) => e.stopPropagation());
  window.addEventListener('click', () => settingsPopover.classList.add('hidden'));

  // --- floating toolbar actions ---
  reloadBtn.addEventListener('click', () => vscode.postMessage({ type: 'refresh' }));
  screenshotBtn.addEventListener('click', () => vscode.postMessage({ type: 'screenshot' }));

  themeButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      state.colorScheme = btn.dataset.scheme;
      render();
      sendDeviceChange();
    });
  });

  fitBtn.addEventListener('click', () => {
    state.zoomMode = 'auto';
    render();
    scheduleSave();
  });

  zoomOutBtn.addEventListener('click', () => {
    state.zoomMode = 'manual';
    state.zoom = Math.max(10, state.zoom - 10);
    render();
    scheduleSave();
  });

  zoomInBtn.addEventListener('click', () => {
    state.zoomMode = 'manual';
    state.zoom = Math.min(300, state.zoom + 10);
    render();
    scheduleSave();
  });

  goBtn.addEventListener('click', () => loadUrl(urlInput.value));
  urlInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') loadUrl(urlInput.value);
  });

  const resizeObserver = new ResizeObserver(() => {
    if (state.zoomMode === 'auto') render();
  });
  resizeObserver.observe(stage);

  // --- input forwarding to the emulated page ---
  // Mouse interaction on the canvas is translated into real touch gestures (touchstart/
  // touchmove/touchend), the same way Chrome DevTools' device toolbar treats your mouse
  // as a finger. A circular cursor mirrors that so it's visually obvious.
  let pressed = false;

  function canvasLocalPoint(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const scale = state.zoom / 100;
    return { x: (clientX - rect.left) / scale, y: (clientY - rect.top) / scale };
  }

  canvas.addEventListener('mouseenter', () => touchCursor.classList.remove('hidden'));
  canvas.addEventListener('mouseleave', () => {
    touchCursor.classList.add('hidden');
    if (pressed) {
      pressed = false;
      touchCursor.classList.remove('pressed');
      vscode.postMessage({ type: 'touch', kind: 'end', x: 0, y: 0 });
    }
  });

  canvas.addEventListener('mousedown', (e) => {
    canvas.focus();
    pressed = true;
    touchCursor.classList.add('pressed');
    const { x, y } = canvasLocalPoint(e.clientX, e.clientY);
    vscode.postMessage({ type: 'touch', kind: 'start', x, y });
  });

  window.addEventListener('mousemove', (e) => {
    touchCursor.style.left = e.clientX + 'px';
    touchCursor.style.top = e.clientY + 'px';
    if (!pressed) return;
    const { x, y } = canvasLocalPoint(e.clientX, e.clientY);
    vscode.postMessage({ type: 'touch', kind: 'move', x, y });
  });

  window.addEventListener('mouseup', (e) => {
    if (!pressed) return;
    pressed = false;
    touchCursor.classList.remove('pressed');
    const { x, y } = canvasLocalPoint(e.clientX, e.clientY);
    vscode.postMessage({ type: 'touch', kind: 'end', x, y });
  });

  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      vscode.postMessage({ type: 'wheel', x: e.offsetX, y: e.offsetY, deltaX: e.deltaX, deltaY: e.deltaY });
    },
    { passive: false }
  );
  canvas.addEventListener('keydown', (e) => {
    const specialKeys = ['Backspace', 'Enter', 'Tab', 'Escape', 'ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown', 'Delete'];
    if (specialKeys.includes(e.key)) {
      e.preventDefault();
      vscode.postMessage({ type: 'key', key: e.key });
    } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      vscode.postMessage({ type: 'text', text: e.key });
    }
  });

  function hideStatus() {
    statusOverlay.classList.add('hidden');
    statusOverlay.classList.remove('is-error');
    statusCard.title = '';
  }

  function showSimpleStatus(title) {
    statusOverlay.classList.remove('hidden', 'is-error');
    statusCard.title = '';
    statusSpinner.classList.remove('hidden');
    statusIcon.classList.add('hidden');
    statusIconEmpty.classList.add('hidden');
    statusTitle.textContent = title;
    statusRetryBtn.classList.add('hidden');
  }

  function showEmptyStatus() {
    statusOverlay.classList.remove('hidden', 'is-error');
    statusCard.title = '';
    statusSpinner.classList.add('hidden');
    statusIcon.classList.add('hidden');
    statusIconEmpty.classList.remove('hidden');
    statusTitle.textContent = 'Enter a URL to get started';
    statusRetryBtn.classList.add('hidden');
  }

  function friendlyErrorTitle(raw) {
    const msg = raw || '';
    if (/ERR_CONNECTION_REFUSED/i.test(msg)) return "Can't connect";
    if (/ERR_NAME_NOT_RESOLVED|ERR_INTERNET_DISCONNECTED/i.test(msg)) return 'Address not found';
    if (/ERR_CONNECTION_TIMED_OUT|Timeout \d+ms exceeded/i.test(msg)) return 'Timed out';
    if (/ERR_SSL|ERR_CERT/i.test(msg)) return 'Certificate error';
    if (/ERR_EMPTY_RESPONSE/i.test(msg)) return 'Empty response';
    return "Couldn't load page";
  }

  function showErrorStatus(rawMessage) {
    statusOverlay.classList.remove('hidden');
    statusOverlay.classList.add('is-error');
    statusSpinner.classList.add('hidden');
    statusIconEmpty.classList.add('hidden');
    statusIcon.classList.remove('hidden');
    statusTitle.textContent = friendlyErrorTitle(rawMessage);
    statusCard.title = rawMessage || '';
    statusRetryBtn.classList.remove('hidden');
  }

  statusRetryBtn.addEventListener('click', () => loadUrl(state.url));

  // --- console ---
  let consoleEntryCount = 0;
  let consoleRequestSeq = 0;
  const pendingPropertyRequests = new Map();
  let stickToBottom = true;

  consoleBody.addEventListener('scroll', () => {
    stickToBottom = consoleBody.scrollHeight - consoleBody.scrollTop - consoleBody.clientHeight < 24;
  });

  let lastPanelHeight = null; // px; remembers a manually-dragged size across opens
  const PANEL_MARGIN = 8;

  // The floating toolbar must always stay above the console/elements panel, so
  // the panel's own max height is capped by how much room the toolbar needs —
  // squeezed all the way to the top of the stage, at minimum.
  function maxPanelHeight() {
    // Three margins' worth of slack: the toolbar's own gap from the top edge,
    // the toolbar's height, and the gap between the toolbar and the panel —
    // otherwise the two end up touching with zero space between them.
    return stageWrapper.clientHeight - floatingToolbar.offsetHeight - PANEL_MARGIN * 3;
  }

  function defaultPanelHeight() {
    return Math.min(Math.round(stageWrapper.clientHeight * 0.46), maxPanelHeight());
  }

  function setConsoleExpanded(expanded) {
    consolePanel.classList.toggle('expanded', expanded);
    consolePanel.style.height = expanded ? (lastPanelHeight || defaultPanelHeight()) + 'px' : '0px';
    if (expanded && activeDevtoolsTab === 'console' && stickToBottom) {
      consoleBody.scrollTop = consoleBody.scrollHeight;
    }
    applyToolbarPosition();
  }

  // #console-panel's height is CSS-animated, so a getBoundingClientRect() taken
  // right after toggling it still reflects the pre-animation box — re-clamp the
  // toolbar once the animation actually settles.
  consolePanel.addEventListener('transitionend', (e) => {
    if (e.propertyName === 'height') applyToolbarPosition();
  });

  // --- drag the floating toolbar up/down (useful in landscape, where the
  // default centered position can sit over the content) ---
  let userToolbarTop = null; // px from the top of #stage-wrapper, only set once the user drags it
  let draggingToolbar = false;
  let toolbarDragOffset = 0;

  function defaultToolbarTop() {
    return (stageWrapper.clientHeight - floatingToolbar.offsetHeight) / 2;
  }

  function panelTopWithinWrapper() {
    if (!consolePanel.classList.contains('expanded')) return stageWrapper.clientHeight;
    return consolePanel.getBoundingClientRect().top - stageWrapper.getBoundingClientRect().top;
  }

  function clampToolbarTop(top) {
    const wrapperH = stageWrapper.clientHeight;
    const toolbarH = floatingToolbar.offsetHeight;
    // The panel's height is itself capped so the toolbar always fits above it
    // (see maxPanelHeight), so this is a safety clamp, not the primary limit.
    const maxTop = Math.min(wrapperH - toolbarH - PANEL_MARGIN, panelTopWithinWrapper() - toolbarH - PANEL_MARGIN);
    return Math.max(PANEL_MARGIN, Math.min(maxTop, top));
  }

  function applyToolbarPosition() {
    const desired = userToolbarTop !== null ? userToolbarTop : defaultToolbarTop();
    floatingToolbar.style.top = clampToolbarTop(desired) + 'px';
    floatingToolbar.style.bottom = 'auto';
    floatingToolbar.style.transform = 'none';
  }

  floatingToolbar.addEventListener('mousedown', (e) => {
    if (e.target.closest('.icon-btn')) return; // let button clicks through untouched
    draggingToolbar = true;
    floatingToolbar.classList.add('dragging');
    const rect = floatingToolbar.getBoundingClientRect();
    toolbarDragOffset = e.clientY - rect.top;
    e.preventDefault();
  });

  window.addEventListener('mousemove', (e) => {
    if (!draggingToolbar) return;
    const wrapperRect = stageWrapper.getBoundingClientRect();
    userToolbarTop = e.clientY - wrapperRect.top - toolbarDragOffset;
    applyToolbarPosition();
  });

  window.addEventListener('mouseup', () => {
    if (!draggingToolbar) return;
    draggingToolbar = false;
    floatingToolbar.classList.remove('dragging');
  });

  new ResizeObserver(() => applyToolbarPosition()).observe(stageWrapper);

  // --- drag to resize the console/elements panel ---
  let resizing = false;

  consoleResizeHandle.addEventListener('mousedown', (e) => {
    resizing = true;
    consolePanel.classList.add('dragging');
    e.preventDefault();
  });

  window.addEventListener('mousemove', (e) => {
    if (!resizing) return;
    const wrapperRect = stageWrapper.getBoundingClientRect();
    const min = 80;
    const max = maxPanelHeight();
    const newHeight = Math.max(min, Math.min(max, wrapperRect.bottom - e.clientY));
    lastPanelHeight = newHeight;
    consolePanel.style.height = newHeight + 'px';
    applyToolbarPosition();
  });

  window.addEventListener('mouseup', () => {
    if (!resizing) return;
    resizing = false;
    consolePanel.classList.remove('dragging');
  });

  consoleCloseBtn.addEventListener('click', () => setConsoleExpanded(false));
  consoleClearBtn.addEventListener('click', () => clearConsole());

  elementsBtn.addEventListener('click', () => {
    setDevtoolsTab('elements');
    setConsoleExpanded(true);
  });
  consoleBtn.addEventListener('click', () => {
    setDevtoolsTab('console');
    setConsoleExpanded(true);
  });

  // --- devtools tabs (Elements / Console) ---
  let activeDevtoolsTab = 'elements';

  function setDevtoolsTab(tab) {
    activeDevtoolsTab = tab;
    elementsTabBtn.classList.toggle('active', tab === 'elements');
    consoleTabBtn.classList.toggle('active', tab === 'console');
    elementsBody.classList.toggle('hidden', tab !== 'elements');
    consoleBody.classList.toggle('hidden', tab !== 'console');
    elementsRefreshBtn.classList.toggle('hidden', tab !== 'elements');
    consoleClearBtn.classList.toggle('hidden', tab !== 'console');
    if (tab === 'console' && stickToBottom) {
      consoleBody.scrollTop = consoleBody.scrollHeight;
    }
  }

  elementsTabBtn.addEventListener('click', () => setDevtoolsTab('elements'));
  consoleTabBtn.addEventListener('click', () => setDevtoolsTab('console'));
  elementsRefreshBtn.addEventListener('click', () => vscode.postMessage({ type: 'domRefresh' }));

  function clearConsole() {
    consoleBody.innerHTML = '';
    consoleEntryCount = 0;
    consoleCount.textContent = '0';
  }

  function requestProperties(objectId, callback) {
    const requestId = ++consoleRequestSeq;
    pendingPropertyRequests.set(requestId, callback);
    vscode.postMessage({ type: 'consoleGetProperties', requestId, objectId });
  }

  function previewText(arg) {
    const isArray = arg.subtype === 'array';
    if (!arg.preview) return arg.description || (isArray ? 'Array' : 'Object');
    const parts = arg.preview.properties.map((p) => `${p.name}: ${p.value !== undefined ? p.value : p.type}`);
    const body = parts.join(', ') + (arg.preview.overflow ? ', …' : '');
    return isArray ? `(${arg.description ? arg.description.replace(/^Array\((\d+)\)$/, '$1') : ''}) [${body}]` : `{${body}}`;
  }

  function renderPropertyRow(p) {
    const row = document.createElement('div');
    const keySpan = document.createElement('span');
    keySpan.className = 'v-key';
    keySpan.textContent = p.name + ': ';
    row.appendChild(keySpan);
    row.appendChild(renderArg(p));
    return row;
  }

  function renderObject(arg) {
    const wrapper = document.createElement('span');

    const label = document.createElement('span');
    label.className = 'v-punct';
    label.textContent = previewText(arg);

    if (!arg.objectId) {
      wrapper.appendChild(label);
      return wrapper;
    }

    const toggle = document.createElement('span');
    toggle.className = 'console-obj-toggle';
    toggle.textContent = '▶';

    const childrenEl = document.createElement('div');
    childrenEl.className = 'console-obj-children hidden';

    let expanded = false;
    let loaded = false;

    toggle.addEventListener('click', () => {
      expanded = !expanded;
      toggle.textContent = expanded ? '▼' : '▶';
      childrenEl.classList.toggle('hidden', !expanded);
      if (expanded && !loaded) {
        loaded = true;
        childrenEl.textContent = 'Loading…';
        requestProperties(arg.objectId, (properties) => {
          childrenEl.innerHTML = '';
          if (!properties.length) {
            childrenEl.textContent = '(no properties)';
            return;
          }
          properties.forEach((p) => childrenEl.appendChild(renderPropertyRow(p)));
        });
      }
    });

    wrapper.appendChild(toggle);
    wrapper.appendChild(label);
    wrapper.appendChild(childrenEl);
    return wrapper;
  }

  function renderArg(arg) {
    if (arg.kind === 'object') return renderObject(arg);
    const span = document.createElement('span');
    if (arg.kind === 'function') {
      span.className = 'v-function';
      span.textContent = arg.text;
    } else if (arg.type === 'string') {
      span.className = 'v-string';
      span.textContent = arg.text;
    } else if (arg.type === 'number' || arg.type === 'boolean' || arg.type === 'bigint') {
      span.className = 'v-number';
      span.textContent = arg.text;
    } else {
      span.className = 'v-null';
      span.textContent = arg.text;
    }
    return span;
  }

  const LEVEL_CLASS = { error: 'level-error', warning: 'level-warning', warn: 'level-warning', info: 'level-info' };

  function formatLocation(location) {
    // Match Chrome's console format ("tournament.service.ts:169") — just the
    // file name and line, not a full URL or the column.
    let name = location.url;
    try {
      const parsed = new URL(location.url);
      const segments = parsed.pathname.split('/').filter(Boolean);
      name = segments[segments.length - 1] || parsed.hostname;
    } catch {
      const segments = name.split('/').filter(Boolean);
      name = segments[segments.length - 1] || name;
    }
    return `${name}:${location.line}`;
  }

  function appendConsoleEntry(entry) {
    const wrapper = document.createElement('div');
    wrapper.className = 'console-entry ' + (LEVEL_CLASS[entry.level] || '');

    const row = document.createElement('div');
    row.className = 'console-entry-row';

    const time = document.createElement('span');
    time.className = 'console-time';
    const d = entry.timestamp ? new Date(entry.timestamp) : new Date();
    time.textContent = d.toLocaleTimeString(undefined, { hour12: false });
    row.appendChild(time);

    const content = document.createElement('div');
    content.className = 'console-content';
    (entry.args || []).forEach((arg, i) => {
      if (i > 0) content.appendChild(document.createTextNode(' '));
      content.appendChild(renderArg(arg));
    });
    if (entry.stack) {
      const stack = document.createElement('div');
      stack.className = 'console-stack';
      stack.textContent = entry.stack;
      content.appendChild(stack);
    }
    row.appendChild(content);

    let locationDetail;
    if (entry.location) {
      const locationBtn = document.createElement('button');
      locationBtn.type = 'button';
      locationBtn.className = 'console-location-btn';
      locationBtn.title = 'Show source location';
      locationBtn.textContent = 'ℹ';

      locationDetail = document.createElement('div');
      locationDetail.className = 'console-location-detail hidden';
      locationDetail.textContent = formatLocation(entry.location);

      locationBtn.addEventListener('click', () => locationDetail.classList.toggle('hidden'));
      row.appendChild(locationBtn);
    }

    wrapper.appendChild(row);
    if (locationDetail) wrapper.appendChild(locationDetail);

    consoleBody.appendChild(wrapper);
    consoleEntryCount++;
    consoleCount.textContent = String(consoleEntryCount);
    if (stickToBottom) {
      consoleBody.scrollTop = consoleBody.scrollHeight;
    }
  }

  // --- elements tree ---
  function renderDomNode(node, depth) {
    const wrapper = document.createElement('div');

    if (node.nodeType === 3) {
      const row = document.createElement('div');
      row.className = 'dom-row';
      const indent = document.createElement('span');
      indent.className = 'dom-indent';
      indent.style.width = depth * 14 + 12 + 'px';
      row.appendChild(indent);
      const text = document.createElement('span');
      text.className = 'dom-text';
      const trimmed = (node.textContent || '').trim().replace(/\s+/g, ' ');
      text.textContent = trimmed.length > 80 ? trimmed.slice(0, 80) + '…' : trimmed;
      row.appendChild(text);
      wrapper.appendChild(row);
      return wrapper;
    }

    const row = document.createElement('div');
    row.className = 'dom-row';

    const indent = document.createElement('span');
    indent.className = 'dom-indent';
    indent.style.width = depth * 14 + 'px';
    row.appendChild(indent);

    const hasChildren = !!(node.children && node.children.length);
    const toggle = document.createElement('span');
    toggle.className = 'dom-toggle';
    toggle.textContent = hasChildren ? '▾' : '';
    row.appendChild(toggle);

    const tagOpen = document.createElement('span');
    tagOpen.className = 'dom-tag';
    tagOpen.textContent = '<' + (node.nodeName || '').toLowerCase();
    row.appendChild(tagOpen);

    const attrs = node.attributes || [];
    for (let i = 0; i < attrs.length; i += 2) {
      const nameSpan = document.createElement('span');
      nameSpan.className = 'dom-attr-name';
      nameSpan.textContent = ' ' + attrs[i] + '=';
      row.appendChild(nameSpan);
      const valueSpan = document.createElement('span');
      valueSpan.className = 'dom-attr-value';
      valueSpan.textContent = '"' + attrs[i + 1] + '"';
      row.appendChild(valueSpan);
    }

    const tagClose = document.createElement('span');
    tagClose.className = 'dom-tag';
    tagClose.textContent = '>';
    row.appendChild(tagClose);

    row.addEventListener('mouseenter', () => {
      row.classList.add('dom-row-hovered');
      vscode.postMessage({ type: 'domHover', nodeId: node.nodeId });
    });
    row.addEventListener('mouseleave', () => {
      row.classList.remove('dom-row-hovered');
      vscode.postMessage({ type: 'domHoverEnd' });
    });

    wrapper.appendChild(row);

    if (hasChildren) {
      const childrenEl = document.createElement('div');
      childrenEl.className = 'dom-children';
      node.children.forEach((child) => childrenEl.appendChild(renderDomNode(child, depth + 1)));
      wrapper.appendChild(childrenEl);

      let expanded = true;
      toggle.addEventListener('click', (e) => {
        e.stopPropagation();
        expanded = !expanded;
        toggle.textContent = expanded ? '▾' : '▸';
        childrenEl.classList.toggle('hidden', !expanded);
      });
    }

    return wrapper;
  }

  function renderDomTree(tree) {
    elementsBody.innerHTML = '';
    if (tree) elementsBody.appendChild(renderDomNode(tree, 0));
  }

  function quadRect(quad) {
    const xs = [quad[0], quad[2], quad[4], quad[6]];
    const ys = [quad[1], quad[3], quad[5], quad[7]];
    const left = Math.min(...xs);
    const top = Math.min(...ys);
    return { left, top, width: Math.max(...xs) - left, height: Math.max(...ys) - top };
  }

  function setBoxRect(el, quad) {
    if (!quad) {
      el.style.display = 'none';
      return;
    }
    el.style.display = 'block';
    const r = quadRect(quad);
    el.style.left = r.left + 'px';
    el.style.top = r.top + 'px';
    el.style.width = r.width + 'px';
    el.style.height = r.height + 'px';
  }

  function updateDomHighlight(box) {
    if (!box) {
      domHighlight.classList.add('hidden');
      return;
    }
    domHighlight.classList.remove('hidden');
    setBoxRect(domBoxMargin, box.margin);
    setBoxRect(domBoxBorder, box.border);
    setBoxRect(domBoxPadding, box.padding);
    setBoxRect(domBoxContent, box.content);

    const rect = quadRect(box.margin || box.border || box.padding || box.content);
    domHighlightLabel.textContent = `${Math.round(box.width)} × ${Math.round(box.height)}`;
    domHighlightLabel.style.left = rect.left + 'px';
    domHighlightLabel.style.top = Math.max(rect.top, 14) + 'px';
  }

  window.addEventListener('message', (event) => {
    const message = event.data;
    switch (message.type) {
      case 'init':
        state = { ...state, ...message.state };
        (message.devicePresets || []).forEach((d) => {
          const opt = document.createElement('option');
          opt.value = d.id;
          opt.textContent = d.label;
          deviceSelect.appendChild(opt);
        });
        document.body.classList.toggle('controls-hidden', state.controlsVisible === false);
        render();
        break;
      case 'controlsVisible':
        state.controlsVisible = message.visible;
        document.body.classList.toggle('controls-hidden', !message.visible);
        if (state.zoomMode === 'auto') render();
        break;
      case 'viewport':
        viewport = { w: message.width, h: message.height };
        render();
        break;
      case 'frame':
        frameImage.onload = () => {
          if (canvas.width !== frameImage.naturalWidth || canvas.height !== frameImage.naturalHeight) {
            canvas.width = frameImage.naturalWidth;
            canvas.height = frameImage.naturalHeight;
          }
          ctx.drawImage(frameImage, 0, 0);
        };
        frameImage.src = message.dataUrl;
        break;
      case 'status':
        if (message.state === 'launching') showSimpleStatus('Starting…');
        else if (message.state === 'loading') showSimpleStatus('Loading…');
        else if (message.state === 'error') showErrorStatus(message.message);
        else hideStatus();
        break;
      case 'console':
        appendConsoleEntry(message.entry);
        break;
      case 'consoleClear':
        clearConsole();
        break;
      case 'consoleProperties': {
        const callback = pendingPropertyRequests.get(message.requestId);
        pendingPropertyRequests.delete(message.requestId);
        if (callback) callback(message.properties || []);
        break;
      }
      case 'domTree':
        renderDomTree(message.tree);
        break;
      case 'domHighlight':
        updateDomHighlight(message.box);
        break;
    }
  });

  render();
  applyToolbarPosition();
  vscode.postMessage({ type: 'ready' });
})();
