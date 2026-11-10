import { artifactHtml } from './artifact-export.js';
import { resolveArtifactResources } from './artifact-resources.js';

let runtimeText;
export async function prepareArtifactConversation(conversation, { loadRuntime, fetchResource } = {}) {
  if (!conversation.artifacts?.length) return conversation;
  const readRuntime = loadRuntime || (() => {
    runtimeText ||= fetch(chrome.runtime.getURL('artifact-react-runtime.js')).then(response => {
      if (!response.ok) throw new Error('The packaged artifact runtime could not be loaded. Reload the extension and retry.');
      return response.text();
    });
    return runtimeText;
  });
  const artifacts = [];
  for (const artifact of conversation.artifacts) {
    try {
      const resolved = await resolveArtifactResources(artifact, fetchResource);
      const reactRuntime = artifact.kind === 'react' ? await readRuntime() : '';
      artifacts.push({ ...artifact, preparedHtml: artifactHtml(resolved, { reactRuntime }) });
    } catch (error) {
      throw new Error(`Could not preserve “${artifact.title || 'Interactive artifact'}”: ${error.message}`);
    }
  }
  return { ...conversation, artifacts };
}
