import { extractConversation } from './extract.js';
// The injected bundle returns a serializable result to executeScript.
try { globalThis.__ideaCapture = { ok: true, conversation: extractConversation() }; }
catch (error) { globalThis.__ideaCapture = { ok: false, error: error.message }; }
