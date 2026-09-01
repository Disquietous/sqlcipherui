import { api } from './client';

export const getTables = (db) => api.get('/schema/tables?db=' + encodeURIComponent(db));
export const getTableDetail = (name, db) => api.get(`/schema/tables/${encodeURIComponent(name)}?db=` + encodeURIComponent(db));
export const getViews = (db) => api.get('/schema/views?db=' + encodeURIComponent(db));
export const getIndexes = (db) => api.get('/schema/indexes?db=' + encodeURIComponent(db));
export const getTriggers = (db) => api.get('/schema/triggers?db=' + encodeURIComponent(db));

/** Fire a window event so interested stores (schema completion) can refetch. */
export const notifySchemaChanged = (db) => {
  try {
    window.dispatchEvent(new CustomEvent('sqlui:schema-changed', { detail: { db } }));
  } catch { /* non-browser env */ }
};

export const executeDdl = async (sql, db) => {
  const res = await api.post('/schema/execute?db=' + encodeURIComponent(db), { sql });
  notifySchemaChanged(db);
  return res;
};

/**
 * Fetch the completion snapshot. Pass the previous ETag to get a cheap
 * `{ notModified: true }` when the schema is unchanged.
 */
export async function getCompletionSnapshot(db, etag) {
  const res = await fetch('/api/schema/completion?db=' + encodeURIComponent(db), {
    headers: etag ? { 'If-None-Match': etag } : {},
  });
  if (res.status === 304) return { notModified: true, etag };
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const err = new Error(body.detail || `HTTP ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return { notModified: false, etag: res.headers.get('ETag'), data: await res.json() };
}
