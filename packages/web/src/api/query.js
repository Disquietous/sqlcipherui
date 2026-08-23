import { api } from './client';

export const executeQuery = (sql, db) => api.post('/query/execute?db=' + encodeURIComponent(db), { sql });
export const explainQuery = (sql, db) => api.post('/query/explain?db=' + encodeURIComponent(db), { sql });
