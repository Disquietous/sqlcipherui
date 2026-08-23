import { api } from './client';

export const fetchRows = (table, { offset = 0, limit = 100, sort, dir, search, db } = {}) => {
  const params = new URLSearchParams({ offset, limit });
  if (sort) params.set('sort', sort);
  if (dir) params.set('dir', dir);
  if (search) params.set('search', search);
  if (db) params.set('db', db);
  return api.get(`/data/${encodeURIComponent(table)}/rows?${params}`);
};

export const insertRow = (table, values, db) => api.post(`/data/${encodeURIComponent(table)}/rows?db=${encodeURIComponent(db)}`, { values });
export const updateRow = (table, pk, changes, db) => api.put(`/data/${encodeURIComponent(table)}/rows?db=${encodeURIComponent(db)}`, { pk, changes });
export const deleteRow = (table, pk, db) => api.del(`/data/${encodeURIComponent(table)}/rows?db=${encodeURIComponent(db)}`, { pk });
