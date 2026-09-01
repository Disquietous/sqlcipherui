export const SNAPSHOT = {
  schema_version: 7,
  schemas: ['main', 'aux'],
  tables: [
    { name: 'users', schema_name: 'main', kind: 'table', columns: [
      { name: 'id', type: 'INTEGER', pk: true, notnull: true, hidden: 0 },
      { name: 'email', type: 'TEXT', pk: false, notnull: true, hidden: 0 },
      { name: 'role', type: 'TEXT', pk: false, notnull: false, hidden: 0 },
    ] },
    { name: 'posts', schema_name: 'main', kind: 'table', columns: [
      { name: 'id', type: 'INTEGER', pk: true, notnull: true, hidden: 0 },
      { name: 'user_id', type: 'INTEGER', pk: false, notnull: true, hidden: 0 },
      { name: 'title', type: 'TEXT', pk: false, notnull: false, hidden: 0 },
      { name: 'body', type: 'TEXT', pk: false, notnull: false, hidden: 0 },
    ] },
    { name: 'active_users', schema_name: 'main', kind: 'view', columns: [
      { name: 'id', type: 'INTEGER' }, { name: 'email', type: 'TEXT' },
    ] },
    { name: 'remote_notes', schema_name: 'aux', kind: 'table', columns: [
      { name: 'id', type: 'INTEGER', pk: true }, { name: 'note', type: 'TEXT' },
    ] },
  ],
  indexes: [{ name: 'idx_posts_user', schema_name: 'main', table: 'posts' }],
  triggers: [{ name: 'trg_posts', schema_name: 'main', table: 'posts' }],
  foreign_keys: [{ from_table: 'posts', from_column: 'user_id', to_table: 'users', to_column: 'id' }],
};
