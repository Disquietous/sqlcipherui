import { api } from './client';

export const getCipherStatus = (db) => api.get('/cipher/status?db=' + encodeURIComponent(db));
export const rekeyDatabase = (new_passphrase, db) => api.post('/cipher/rekey?db=' + encodeURIComponent(db), { new_passphrase });
export const verifyPassphrase = (passphrase, db) => api.post('/cipher/verify?db=' + encodeURIComponent(db), { passphrase });
export const encryptDatabase = (passphrase, db) => api.post('/cipher/encrypt?db=' + encodeURIComponent(db), { passphrase });
export const decryptDatabase = (passphrase, db) => api.post('/cipher/decrypt?db=' + encodeURIComponent(db), { passphrase });
