import { createCaptureControls, installCollapseStyle } from './controls.js';

try {
  if (!globalThis.__ideaCaptureController) {
    installCollapseStyle(document);
    globalThis.__ideaCaptureController = createCaptureControls(document, window);
  }
  globalThis.__ideaCapture = { ok: true };
} catch (error) {
  globalThis.__ideaCapture = { ok: false, error: error.message };
}
