import { api } from './client';

export const getPipelines = () => api.get('/dataflow/pipelines');
export const getPipeline = (id) => api.get(`/dataflow/pipelines/${id}`);
export const createPipeline = (data) => api.post('/dataflow/pipelines', data);
export const updatePipeline = (id, data) => api.put(`/dataflow/pipelines/${id}`, data);
export const deletePipeline = (id) => api.del(`/dataflow/pipelines/${id}`);
export const duplicatePipeline = (id, name) =>
  api.post(`/dataflow/pipelines/${id}/duplicate`, { name });

export const getDfConnections = () => api.get('/dataflow/connections');
export const createDfConnection = (data) => api.post('/dataflow/connections', data);
export const updateDfConnection = (id, data) => api.put(`/dataflow/connections/${id}`, data);
export const deleteDfConnection = (id) => api.del(`/dataflow/connections/${id}`);

export const getTemplates = () => api.get('/dataflow/templates');
export const getStats = () => api.get('/dataflow/stats');

export const runPipeline = (id, data) => api.post(`/dataflow/pipelines/${id}/run`, data);
export const cancelRun = (runId) => api.post(`/dataflow/runs/${runId}/cancel`);
export const getRuns = (id, limit = 50) => api.get(`/dataflow/pipelines/${id}/runs?limit=${limit}`);
export const getRun = (runId) => api.get(`/dataflow/runs/${runId}`);
export const getRunEvents = (runId) => api.get(`/dataflow/runs/${runId}/events`);

export const previewNode = (pipelineId, nodeId, sampleSize = 5) =>
  api.post(`/dataflow/pipelines/${pipelineId}/preview-node`, {
    node_id: nodeId, sample_size: sampleSize,
  });

export const getSchema = (pipelineId, sampleSize = 20) =>
  api.post(`/dataflow/pipelines/${pipelineId}/schema`, { sample_size: sampleSize });

export const validatePipeline = (id) => api.post(`/dataflow/pipelines/${id}/validate`);

/**
 * Start a streaming run. Returns a handle with `abort()`.
 * `onEvent` receives every server event: status, log, progress, edge_progress, done, error.
 * `onDone` fires exactly once when the stream closes for any reason.
 */
export function streamRun(pipelineId, runRequest, onEvent, onDone) {
  const url = `/api/dataflow/pipelines/${pipelineId}/run-stream`;
  const controller = new AbortController();
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    onDone?.();
  };

  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(runRequest),
    signal: controller.signal,
  }).then(async (res) => {
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      onEvent({ type: 'error', message: err.detail || `HTTP ${res.status}` });
      finish();
      return;
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const line of lines) {
        if (line.startsWith('data: ')) {
          try {
            onEvent(JSON.parse(line.slice(6)));
          } catch { /* skip malformed */ }
        }
      }
    }
    finish();
  }).catch((err) => {
    if (err.name !== 'AbortError') onEvent({ type: 'error', message: err.message });
    finish();
  });

  return { abort: () => controller.abort() };
}
