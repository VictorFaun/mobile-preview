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
  const touchCursor = document.getElementById('touch-cursor');
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

  function showStatus(text) {
    if (!text) {
      statusOverlay.classList.add('hidden');
      statusOverlay.textContent = '';
    } else {
      statusOverlay.classList.remove('hidden');
      statusOverlay.textContent = text;
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
        if (message.state === 'launching') showStatus('Starting emulated browser…');
        else if (message.state === 'loading') showStatus('Loading…');
        else if (message.state === 'error') showStatus(`Failed to load: ${message.message}`);
        else showStatus(null);
        break;
    }
  });

  render();
  vscode.postMessage({ type: 'ready' });
})();
