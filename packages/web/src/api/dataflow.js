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
export const deleteDfConnection = (id) => api.del(`/dataflow/connections/${id}`);

export const getTemplates = () => api.get('/dataflow/templates');

export const runPipeline = (id, data) => api.post(`/dataflow/pipelines/${id}/run`, data);
export const getRuns = (id) => api.get(`/dataflow/pipelines/${id}/runs`);
export const getRunEvents = (runId) => api.get(`/dataflow/runs/${runId}/events`);

export const previewNode = (pipelineId, nodeId, sampleSize = 5) =>
  api.post(`/dataflow/pipelines/${pipelineId}/preview-node`, {
    pipeline_id: pipelineId, node_id: nodeId, sample_size: sampleSize
  });

export const validatePipeline = (id) => api.post(`/dataflow/pipelines/${id}/validate`);

export function streamRun(pipelineId, runRequest, onEvent, onDone) {
  const url = `/api/dataflow/pipelines/${pipelineId}/run-stream`;
  const body = JSON.stringify(runRequest);

  fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  }).then(async (res) => {
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      onEvent({ type: 'error', message: err.detail || `HTTP ${res.status}` });
      onDone?.();
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
            const event = JSON.parse(line.slice(6));
            onEvent(event);
          } catch { /* skip malformed */ }
        }
      }
    }
    onDone?.();
  }).catch((err) => {
    onEvent({ type: 'error', message: err.message });
    onDone?.();
  });
}
