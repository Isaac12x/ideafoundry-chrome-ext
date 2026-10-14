import { createCaptureControls, installCollapseStyle } from './controls.js';

try {
  const version = globalThis.chrome?.runtime?.getManifest?.().version || 'dev';
  const hostSelector = '[data-idea-capture-owned="host"]';
  const host = document.querySelector(hostSelector);
  const currentController = globalThis.__ideaCaptureController && globalThis.__ideaCaptureControllerVersion === version
    && host?.getAttribute('data-idea-capture-version') === version;
  if (globalThis.__ideaCaptureController && !currentController) {
    globalThis.__ideaCaptureController.destroy?.();
    delete globalThis.__ideaCaptureController;
    delete globalThis.__ideaCaptureControllerVersion;
  }
  if (!globalThis.__ideaCaptureController) {
    for (const node of document.querySelectorAll('[data-idea-capture-collapse-state], .idea-capture-section-collapsed')) {
      const priorState = node.getAttribute('data-idea-capture-collapse-state');
      node.classList.toggle('idea-capture-section-collapsed', priorState === 'true');
      node.removeAttribute('data-idea-capture-collapse-state');
    }
    document.querySelectorAll('[data-idea-capture-owned="header"], [data-idea-capture-owned="style"], [data-idea-capture-owned="host"]').forEach(node => node.remove());
  }
  if (!globalThis.__ideaCaptureController) {
    installCollapseStyle(document);
    globalThis.__ideaCaptureController = createCaptureControls(document, window);
    globalThis.__ideaCaptureControllerVersion = version;
    document.querySelector(hostSelector)?.setAttribute('data-idea-capture-version', version);
  }
  globalThis.__ideaCapture = { ok: true };
} catch (error) {
  globalThis.__ideaCapture = { ok: false, error: error.message };
}
