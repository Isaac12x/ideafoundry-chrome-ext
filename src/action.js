import { resolveCaptureSites, urlMatchesCaptureSites } from './shared.js';

// The toolbar is also the reliable route to settings when the current tab cannot
// host the capture widget (for example chrome:// pages or excluded sites).
export async function handleActionClick(tab, { getSettings, openOptions, injectCapture }) {
  if (!tab?.id || !/^https?:\/\//i.test(tab.url || '')) {
    await openOptions();
    return { settingsOpened: true };
  }

  let captureSites;
  try { captureSites = resolveCaptureSites(await getSettings()); }
  catch (error) {
    await openOptions();
    return { settingsOpened: true, error };
  }
  if (!urlMatchesCaptureSites(tab.url, captureSites)) {
    await openOptions();
    return { settingsOpened: true, excluded: true };
  }

  try { await injectCapture(tab.id); }
  catch (error) {
    await openOptions();
    return { settingsOpened: true, error };
  }
  return { captured: true };
}
