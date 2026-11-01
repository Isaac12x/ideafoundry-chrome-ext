import { createCaptureControls, installCollapseStyle } from './controls.js';
import { urlMatchesCaptureSites } from './shared.js';

const executionGeneration = (globalThis.__ideaCaptureExecutionGeneration || 0) + 1;
globalThis.__ideaCaptureExecutionGeneration = executionGeneration;

function extensionUnavailable(error) {
  const message = error?.message || String(error || '');
  return !globalThis.chrome?.runtime?.id || /context invalidated|extension context invalidated/i.test(message);
}

let captureSites = null;
let captureSitesRevision = 0;
async function readCaptureSites() {
  const revision = captureSitesRevision;
  const response = await chrome.runtime.sendMessage({ type: 'get-capture-sites' });
  if (revision !== captureSitesRevision) return captureSites;
  if (!response?.ok) throw new Error(response?.error || 'Could not load capture settings.');
  captureSites = response.captureSites || [];
  return captureSites;
}

async function captureAllowed() {
  try {
    const sites = captureSites === null ? await readCaptureSites() : captureSites;
    if (!sites.length) return false;
    const href = (document.defaultView || globalThis).location?.href || globalThis.location?.href;
    return urlMatchesCaptureSites(href, sites);
  } catch (error) {
    globalThis.__ideaCaptureSiteError = error?.message || String(error);
    return false;
  }
}

function teardownController() {
  const hostController = document.querySelector('[data-idea-capture-owned="host"]')?.__ideaCaptureController;
  const controller = globalThis.__ideaCaptureController || hostController;
  if (!controller) return;
  controller.destroy?.();
  delete globalThis.__ideaCaptureController;
  delete globalThis.__ideaCaptureControllerVersion;
  for (const node of document.querySelectorAll('[data-idea-capture-collapse-state], .idea-capture-section-collapsed')) {
    const priorState = node.getAttribute('data-idea-capture-collapse-state');
    node.classList.toggle('idea-capture-section-collapsed', priorState === 'true');
    node.removeAttribute('data-idea-capture-collapse-state');
  }
  document.querySelectorAll('[data-idea-capture-owned="header"], [data-idea-capture-owned="style"], [data-idea-capture-owned="host"]').forEach(node => node.remove());
}

async function boot() {
  if (globalThis.__ideaCaptureExecutionGeneration !== executionGeneration) return;
  if (!(await captureAllowed())) {
    if (globalThis.__ideaCaptureExecutionGeneration !== executionGeneration) return;
    teardownController();
    globalThis.__ideaCapture = {
      ok: false,
      error: globalThis.__ideaCaptureSiteError || 'This page is not listed in capture settings.',
    };
    return;
  }
  if (globalThis.__ideaCaptureExecutionGeneration !== executionGeneration) return;
  try {
    const version = globalThis.chrome?.runtime?.getManifest?.().version || 'dev';
    const hostSelector = '[data-idea-capture-owned="host"]';
    const host = document.querySelector(hostSelector);
    const currentController = globalThis.__ideaCaptureController && globalThis.__ideaCaptureControllerVersion === version
      && host?.getAttribute('data-idea-capture-version') === version;
    if (globalThis.__ideaCaptureController && !currentController) {
      teardownController();
    }
    if (!globalThis.__ideaCaptureController) {
      // A prior injection can leave a mounted shadow host after page globals
      // were cleared. Stop its observer before replacing that host.
      teardownController();
      for (const node of document.querySelectorAll('[data-idea-capture-collapse-state], .idea-capture-section-collapsed')) {
        const priorState = node.getAttribute('data-idea-capture-collapse-state');
        node.classList.toggle('idea-capture-section-collapsed', priorState === 'true');
        node.removeAttribute('data-idea-capture-collapse-state');
      }
      document.querySelectorAll('[data-idea-capture-owned="header"], [data-idea-capture-owned="style"], [data-idea-capture-owned="host"]').forEach(node => node.remove());
      installCollapseStyle(document);
      globalThis.__ideaCaptureController = createCaptureControls(document, window);
      globalThis.__ideaCaptureControllerVersion = version;
      const mountedHost = document.querySelector(hostSelector);
      mountedHost?.setAttribute('data-idea-capture-version', version);
      if (mountedHost) mountedHost.__ideaCaptureController = globalThis.__ideaCaptureController;
    }
    globalThis.__ideaCapture = { ok: true };
  } catch (error) {
    globalThis.__ideaCapture = { ok: false, error: extensionUnavailable(error) ? 'Extension was updated or reloaded. Refresh this page and try again.' : error.message };
  }
}

function runBoot() {
  globalThis.__ideaCaptureBoot = boot();
  return globalThis.__ideaCaptureBoot;
}

function installRouteListeners() {
  const pageWindow = document.defaultView || globalThis;
  const existingMonitor = pageWindow.__ideaCaptureRouteMonitor;
  if (existingMonitor) {
    existingMonitor.onRoute = runBoot;
    return;
  }
  const monitor = { href: pageWindow.location?.href, onRoute: runBoot };
  pageWindow.__ideaCaptureRouteMonitor = monitor;
  const history = pageWindow.history;
  for (const method of ['pushState', 'replaceState']) {
    const original = history?.[method];
    if (typeof original !== 'function') continue;
    history[method] = function (...args) {
      const result = original.apply(this, args);
      queueMicrotask(() => monitor.onRoute());
      return result;
    };
  }
  const onLocationEvent = () => monitor.onRoute();
  pageWindow.addEventListener?.('popstate', onLocationEvent);
  pageWindow.addEventListener?.('hashchange', onLocationEvent);
  pageWindow.setInterval?.(() => {
    const href = pageWindow.location?.href;
    if (href === monitor.href) return;
    monitor.href = href;
    monitor.onRoute();
  }, 500);
  if (typeof MutationObserver !== 'undefined' && document.documentElement) {
    new MutationObserver(() => {
      const href = pageWindow.location?.href;
      if (href === monitor.href) return;
      monitor.href = href;
      monitor.onRoute();
    }).observe(document.documentElement, { childList: true, subtree: true });
  }
}

try {
  installRouteListeners();
  globalThis.__ideaCaptureAcceptSites = sites => {
    captureSitesRevision++;
    captureSites = sites || [];
    delete globalThis.__ideaCaptureSiteError;
    void runBoot();
  };
  if (!globalThis.__ideaCaptureSettingsMessageListenerInstalled) {
    globalThis.__ideaCaptureSettingsMessageListenerInstalled = true;
    globalThis.chrome?.runtime?.onMessage?.addListener(message => {
      if (message?.type === 'capture-sites-updated') globalThis.__ideaCaptureAcceptSites?.(message.captureSites);
    });
  }
  globalThis.__ideaCaptureBoot = readCaptureSites().then(() => {
    delete globalThis.__ideaCaptureSiteError;
    return boot();
  }).catch(error => {
    globalThis.__ideaCaptureSiteError = error?.message || String(error);
    return boot();
  });
} catch (error) {
  globalThis.__ideaCapture = { ok: false, error: extensionUnavailable(error) ? 'Extension was updated or reloaded. Refresh this page and try again.' : error.message };
}
