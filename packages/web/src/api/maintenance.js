import { api } from './client';

export const runVacuum = (db) => api.post('/maintenance/vacuum?db=' + encodeURIComponent(db), {});
export const runIntegrityCheck = (db) => api.post('/maintenance/integrity-check?db=' + encodeURIComponent(db), {});
export const runAnalyze = (db) => api.post('/maintenance/analyze?db=' + encodeURIComponent(db), {});
export const getStats = (db) => api.get('/maintenance/stats?db=' + encodeURIComponent(db));
export const getPragmas = (db) => api.get('/maintenance/pragmas?db=' + encodeURIComponent(db));
