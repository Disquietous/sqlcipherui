import { api } from './client';

export const createDatabase = (path, encrypt = false, passphrase = null) =>
  api.post('/db/create', { path, encrypt, passphrase });
export const openDatabase = (path) => api.post('/db/open', { path });
export const closeDatabase = (id) => api.post('/db/close', { id });
export const getDatabaseInfo = (db) => api.get('/db/info?db=' + encodeURIComponent(db));
export const unlockDatabase = (id, passphrase) => api.post('/db/unlock', { id, passphrase });
export const getConnections = () => api.get('/db/connections');
export const browseDirectory = (path = '') => api.get(`/db/browse?path=${encodeURIComponent(path)}`);
