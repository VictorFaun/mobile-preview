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
  const previewWrapper = document.getElementById('preview-wrapper');
  const canvas = document.getElementById('preview-canvas');
  const statusOverlay = document.getElementById('status-overlay');
  const statusCard = document.getElementById('status-card');
  const statusSpinner = document.getElementById('status-spinner');
  const statusIcon = document.getElementById('status-icon');
  const statusTitle = document.getElementById('status-title');
  const statusRetryBtn = document.getElementById('status-retry-btn');
  const touchCursor = document.getElementById('touch-cursor');
  const consoleBtn = document.getElementById('console-btn');
  const consoleOverlay = document.getElementById('console-overlay');
  const consoleBody = document.getElementById('console-body');
  const consoleCount = document.getElementById('console-count');
  const consoleClearBtn = document.getElementById('console-clear-btn');
  const consoleCloseBtn = document.getElementById('console-close-btn');
  const ctx = canvas.getContext('2d');

  const STAGE_PADDING = 16;

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
    previewWrapper.style.width = Math.round(w * (state.zoom / 100)) + 'px';
    previewWrapper.style.height = Math.round(h * (state.zoom / 100)) + 'px';

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
    if (!url) return;
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
    statusTitle.textContent = title;
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

  consoleBtn.addEventListener('click', () => {
    consoleOverlay.classList.toggle('hidden');
    if (!consoleOverlay.classList.contains('hidden') && stickToBottom) {
      consoleBody.scrollTop = consoleBody.scrollHeight;
    }
  });
  consoleCloseBtn.addEventListener('click', () => consoleOverlay.classList.add('hidden'));
  consoleClearBtn.addEventListener('click', () => clearConsole());

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

  function appendConsoleEntry(entry) {
    const row = document.createElement('div');
    row.className = 'console-entry ' + (LEVEL_CLASS[entry.level] || '');

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

    consoleBody.appendChild(row);
    consoleEntryCount++;
    consoleCount.textContent = String(consoleEntryCount);
    if (stickToBottom) {
      consoleBody.scrollTop = consoleBody.scrollHeight;
    }
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
    }
  });

  render();
  vscode.postMessage({ type: 'ready' });
})();
