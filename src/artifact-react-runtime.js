// Bundled as text into exported artifact documents, never evaluated by the
// extension. Keeping the runtime local makes the exported file work offline.
import * as React from 'react';
import * as ReactDOM from 'react-dom/client';
import * as ReactDOMAPI from 'react-dom';
import * as Lucide from 'lucide-react';
import * as Recharts from 'recharts';
globalThis.React = React;
globalThis.ReactDOM = ReactDOM;
globalThis.IdeaArtifactModules = { react: React, 'react-dom': ReactDOMAPI, 'react-dom/client': ReactDOM, 'lucide-react': Lucide, recharts: Recharts };
