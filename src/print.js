function openExportStore() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('idea-capture-exports', 1);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function takeSnapshot(token) {
  const db = await openExportStore();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('print', 'readwrite');
    const store = transaction.objectStore('print');
    const request = store.get(token);
    let value;
    request.onsuccess = () => { value = request.result; store.delete(token); };
    transaction.oncomplete = () => resolve(value?.expiresAt > Date.now() ? value.html : null);
    transaction.onerror = () => reject(transaction.error);
  });
}
function safeSnapshotDocument(html) {
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  parsed.querySelectorAll('script,iframe,object,embed,base,form,meta[http-equiv],link,foreignObject,animate,animateMotion,animateTransform,set').forEach(node => node.remove());
  for (const element of parsed.querySelectorAll('*')) {
    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLowerCase();
      if (name.startsWith('on') || ['srcdoc','srcset','poster','action','formaction'].includes(name)) { element.removeAttribute(attribute.name); continue; }
      if (name === 'style') {
        const withoutRemoteUrls = attribute.value.replace(/url\(([^)]*)\)/gi, (whole, target) => /^\s*["']?#[-\w]+["']?\s*$/.test(target) ? whole : '');
        const safeStyle = withoutRemoteUrls.split(';').filter(value => !/expression\s*\(|@import|behavior\s*:/i.test(value)).join(';');
        if (safeStyle) element.setAttribute('style', safeStyle); else element.removeAttribute('style');
      }
    }
    for (const name of ['src','href','data']) {
      const value = element.getAttribute(name);
      if (!value) continue;
      let valid = false;
      try {
        const url = new URL(value, location.href);
        valid = name === 'src' ? /^data:image\/(?:png|jpeg|gif|webp|avif|bmp|svg\+xml);base64,/i.test(value) : name === 'href' ? url.protocol === 'http:' || url.protocol === 'https:' || value.startsWith('#') || url.protocol === 'mailto:' || element.hasAttribute('download') && /^data:(?:application\/(?:octet-stream|pdf|zip|msword|rtf|vnd\.[\w.+-]+)|image\/(?:png|jpeg|gif|webp|avif|bmp)|audio\/[\w.+-]+|video\/[\w.+-]+|text\/(?:plain|markdown|csv));base64,/i.test(value) : false;
      } catch { /* Strip malformed active resource values. */ }
      if (!valid) element.removeAttribute(name);
    }
  }
  for (const style of parsed.querySelectorAll('style')) if (/@import|url\s*\(|expression\s*\(/i.test(style.textContent)) style.remove();
  for (const element of parsed.querySelectorAll('svg *')) for (const name of ['href','xlink:href']) {
    const value = element.getAttribute(name);
    if (value && !value.startsWith('#')) element.removeAttribute(name);
  }
  return parsed;
}
(async () => {
  try {
    const token = new URL(location.href).searchParams.get('token');
    const html = token && await takeSnapshot(token);
    if (!html) throw new Error('The print snapshot expired or could not be loaded. Export again.');
    const parsed = safeSnapshotDocument(html);
    document.documentElement.replaceWith(document.importNode(parsed.documentElement, true));
    await Promise.all([document.fonts?.ready || Promise.resolve(), ...[...document.images].map(image => image.decode?.().catch(() => {}) || Promise.resolve())]);
    setTimeout(() => window.print(), 200);
  } catch (error) {
    document.body.textContent = `Could not prepare the print layout: ${error.message}`;
  }
})();
