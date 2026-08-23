import { api } from './client';

export const getHistory = (limit = 200, offset = 0, search) =>
  api.get(`/app/history?limit=${limit}&offset=${offset}${search ? '&search=' + encodeURIComponent(search) : ''}`);

export const addHistory = (entry) => api.post('/app/history', entry);

export const removeHistory = (id) => api.del(`/app/history/${id}`);

export const clearHistory = () => api.del('/app/history');

export const getSettings = () => api.get('/app/settings');

export const setSetting = (key, value) => api.put('/app/settings', { key, value });

export const getSavedQueries = () => api.get('/app/saved-queries');

export const saveQuery = (name, sql_text, description = '') =>
  api.post('/app/saved-queries', { name, sql_text, description });

export const updateSavedQuery = (id, updates) => api.put(`/app/saved-queries/${id}`, updates);

export const deleteSavedQuery = (id) => api.del(`/app/saved-queries/${id}`);

export const getDatabases = () => api.get('/app/databases');
export const addDatabase = (path, name) => api.post('/app/databases', { path, name });
export const removeDatabase = (id) => api.del(`/app/databases/${id}`);
