import { api } from './client';
import { notifySchemaChanged } from './schema';

const DDL_RE = /\b(create|alter|drop|attach|detach)\b/i;

export const executeQuery = async (sql, db) => {
  const res = await api.post('/query/execute?db=' + encodeURIComponent(db), { sql });
  // Conservative: any statement that might have changed the schema triggers a
  // revalidation, which is a cheap 304 when nothing actually changed.
  if (DDL_RE.test(sql)) notifySchemaChanged(db);
  return res;
};
export const explainQuery = (sql, db) => api.post('/query/explain?db=' + encodeURIComponent(db), { sql });
