import { api } from './client';

export const getTables = (db) => api.get('/schema/tables?db=' + encodeURIComponent(db));
export const getTableDetail = (name, db) => api.get(`/schema/tables/${encodeURIComponent(name)}?db=` + encodeURIComponent(db));
export const getViews = (db) => api.get('/schema/views?db=' + encodeURIComponent(db));
export const getIndexes = (db) => api.get('/schema/indexes?db=' + encodeURIComponent(db));
export const getTriggers = (db) => api.get('/schema/triggers?db=' + encodeURIComponent(db));
export const executeDdl = (sql, db) => api.post('/schema/execute?db=' + encodeURIComponent(db), { sql });
