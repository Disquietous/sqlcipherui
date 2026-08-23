import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { Icon } from '../icons/Icon';
import { useConnectionStore } from '../../stores/connection';
import { getTables, getTableDetail, getViews, getIndexes, getTriggers, executeDdl } from '../../api/schema';

const cx = (...xs) => xs.filter(Boolean).join(' ');

const CARD_W = 240;
const ROW_H = 22;
const HEAD_H = 36;

const ENTITY_TYPES = [
  { kind: 'table', name: 'Table', icon: 'table', desc: 'Stores rows and columns' },
  { kind: 'view', name: 'View', icon: 'view', desc: 'Virtual table from a query' },
  { kind: 'index', name: 'Index', icon: 'list', desc: 'Speed up queries on a table' },
  { kind: 'trigger', name: 'Trigger', icon: 'play-circle', desc: 'Auto-run SQL on events' },
];

let _draftCounter = 0;
function nextDraftId() { return `draft_${++_draftCounter}`; }

function collectDropStmts(deletions) {
  return deletions.map(d => {
    const kw = d.type === 'view' ? 'VIEW' : d.type === 'index' ? 'INDEX' : d.type === 'trigger' ? 'TRIGGER' : 'TABLE';
    return `DROP ${kw} IF EXISTS "${d.name}"`;
  });
}

function colDef(c) {
  let def = `"${c.name}" ${c.type || 'TEXT'}`;
  if (c.pk) def += ' PRIMARY KEY';
  if (c.notnull) def += ' NOT NULL';
  if (c.unique) def += ' UNIQUE';
  if (c.defaultValue) def += ` DEFAULT ${c.defaultValue}`;
  if (c.fkTable && c.fkColumn) def += ` REFERENCES "${c.fkTable}"("${c.fkColumn}")`;
  return def;
}

function collectCreateStmts(drafts) {
  const stmts = [];
  for (const d of drafts) {
    if (d.kind === 'table') {
      const cols = (d.columns || []).map(colDef);
      if (cols.length === 0) cols.push('"id" INTEGER PRIMARY KEY');
      stmts.push(`CREATE TABLE "${d.name}" (\n  ${cols.join(',\n  ')}\n)`);
    } else if (d.kind === 'view') {
      const sql = d.sql || 'SELECT 1';
      stmts.push(`CREATE VIEW "${d.name}" AS\n${sql}`);
    } else if (d.kind === 'index') {
      const tbl = d.targetTable || 'table_name';
      const idxCols = d.indexColumns || 'column_name';
      const unique = d.unique ? 'UNIQUE ' : '';
      stmts.push(`CREATE ${unique}INDEX "${d.name}" ON "${tbl}" (${idxCols})`);
    } else if (d.kind === 'trigger') {
      const tbl = d.targetTable || 'table_name';
      const event = d.event || 'INSERT';
      const timing = d.timing || 'AFTER';
      const body = d.sql || '/* trigger body */';
      stmts.push(`CREATE TRIGGER "${d.name}"\n${timing} ${event} ON "${tbl}"\nBEGIN\n  ${body}\nEND`);
    }
  }
  return stmts;
}

function collectModStmts(modifications, originalSchema) {
  const stmts = [];
  for (const mod of modifications) {
    const finalName = mod.newName || mod.name;
    const renamed = mod.newName && mod.newName !== mod.name;

    if (mod.kind === 'table') {
      const orig = originalSchema.tables[mod.name];
      if (!orig) continue;
      const origCols = orig.columnDetails || [];
      const newCols = mod.columns;
      const renameOnly = renamed && !newCols;
      const columnsChanged = !!newCols;

      if (renameOnly) {
        stmts.push(`ALTER TABLE "${mod.name}" RENAME TO "${finalName}"`);
      } else if (columnsChanged) {
        const addedOnly = !renamed && newCols.length >= origCols.length &&
          origCols.every((oc, i) => {
            const nc = newCols[i];
            return nc && nc.name === oc.name && nc.type === (oc.type || 'TEXT') &&
              nc.pk === (oc.pk || false) && nc.notnull === (oc.notnull || false) &&
              nc.unique === (oc.unique || false) &&
              (nc.defaultValue || '') === (oc.default_value || oc.defaultValue || '') &&
              (nc.fkTable || '') === (oc.fkTable || '') &&
              (nc.fkColumn || '') === (oc.fkColumn || '');
          });
        if (addedOnly) {
          for (let i = origCols.length; i < newCols.length; i++) {
            const c = newCols[i];
            let def = `"${c.name}" ${c.type || 'TEXT'}`;
            if (c.notnull && c.defaultValue) def += ` NOT NULL DEFAULT ${c.defaultValue}`;
            else if (c.defaultValue) def += ` DEFAULT ${c.defaultValue}`;
            if (c.fkTable && c.fkColumn) def += ` REFERENCES "${c.fkTable}"("${c.fkColumn}")`;
            stmts.push(`ALTER TABLE "${mod.name}" ADD COLUMN ${def}`);
          }
        } else {
          const colDefs = newCols.map(colDef);
          const sharedCols = newCols.filter(nc => origCols.some(oc => oc.name === nc.name));
          const colList = sharedCols.map(c => `"${c.name}"`).join(', ');
          stmts.push(`ALTER TABLE "${mod.name}" RENAME TO "_old_${mod.name}"`);
          stmts.push(`CREATE TABLE "${finalName}" (\n  ${colDefs.join(',\n  ')}\n)`);
          if (colList) {
            stmts.push(`INSERT INTO "${finalName}" (${colList}) SELECT ${colList} FROM "_old_${mod.name}"`);
          }
          stmts.push(`DROP TABLE "_old_${mod.name}"`);
        }
      }
    } else if (mod.kind === 'view') {
      stmts.push(`DROP VIEW IF EXISTS "${mod.name}"`);
      const sql = mod.sql ?? originalSchema.views.find(v => v.name === mod.name)?.sql?.replace(/^CREATE VIEW [^\s]+ AS\s*/i, '') ?? 'SELECT 1';
      stmts.push(`CREATE VIEW "${finalName}" AS\n${sql}`);
    } else if (mod.kind === 'index') {
      stmts.push(`DROP INDEX IF EXISTS "${mod.name}"`);
      const orig = originalSchema.indexes.find(v => v.name === mod.name);
      const unique = (mod.unique ?? orig?.unique) ? 'UNIQUE ' : '';
      const tbl = mod.targetTable ?? orig?.table_name;
      const cols = mod.indexColumns ?? orig?.columns.join(', ');
      stmts.push(`CREATE ${unique}INDEX "${finalName}" ON "${tbl}" (${cols})`);
    } else if (mod.kind === 'trigger') {
      stmts.push(`DROP TRIGGER IF EXISTS "${mod.name}"`);
      const orig = originalSchema.triggers.find(v => v.name === mod.name);
      const timing = mod.timing || 'AFTER';
      const event = mod.event || orig?.event || 'INSERT';
      const tbl = mod.targetTable ?? orig?.table_name;
      const body = mod.sql ?? '';
      stmts.push(`CREATE TRIGGER "${finalName}"\n${timing} ${event} ON "${tbl}"\nBEGIN\n  ${body || '/* trigger body */'}\nEND`);
    }
  }
  return stmts;
}

function formatDdlPreview(stmts) {
  return stmts.map(s => s + ';').join('\n\n');
}

export function CanvasMode() {
  const connections = useConnectionStore((s) => s.connections);
  const activeDbId = useConnectionStore((s) => s.activeDbId);
  const isConnected = Object.keys(connections).length > 0;
  const [tables, setTables] = useState({});
  const [views, setViews] = useState([]);
  const [indexes, setIndexes] = useState([]);
  const [triggers, setTriggers] = useState([]);
  const [fks, setFks] = useState([]);
  const [positions, setPositions] = useState({});
  const [selected, setSelected] = useState(null);
  const [zoom, setZoom] = useState(1);
  const [loading, setLoading] = useState(true);
  const [drafts, setDrafts] = useState([]);
  const [deletions, setDeletions] = useState([]);
  const [modifications, setModifications] = useState([]);
  const [showPublish, setShowPublish] = useState(false);
  const [publishError, setPublishError] = useState(null);
  const [publishing, setPublishing] = useState(false);
  const dragRef = useRef(null);
  const stageRef = useRef(null);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;

  const originalSchema = useMemo(() => ({ tables, views, indexes, triggers }), [tables, views, indexes, triggers]);

  const loadSchema = useCallback(async () => {
    if (!isConnected) {
      setTables({});
      setViews([]);
      setIndexes([]);
      setTriggers([]);
      setFks([]);
      setPositions({});
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const [tableList, viewList, indexList, triggerList] = await Promise.all([
        getTables(activeDbId),
        getViews(activeDbId).catch(() => []),
        getIndexes(activeDbId).catch(() => []),
        getTriggers(activeDbId).catch(() => []),
      ]);

      const tableMap = {};
      const allFks = [];
      const pos = {};

      for (let i = 0; i < tableList.length; i++) {
        const t = tableList[i];
        try {
          const detail = await getTableDetail(t.name, activeDbId);
          tableMap[t.name] = {
            name: t.name,
            rows: t.row_count || 0,
            cols: (detail.columns || []).map(c => c.name),
            pk: (detail.columns || []).find(c => c.pk)?.name || null,
            columnDetails: detail.columns || [],
          };
          if (detail.foreign_keys) {
            for (const fk of detail.foreign_keys) {
              allFks.push({ from: t.name, fromCol: fk.from_column, to: fk.to_table, toCol: fk.to_column });
            }
          }
        } catch {
          tableMap[t.name] = { name: t.name, rows: t.row_count || 0, cols: [], pk: null, columnDetails: [] };
        }
      }

      const singularize = (name) => {
        if (name.endsWith('ies')) return name.slice(0, -3) + 'y';
        if (name.endsWith('ses')) return name.slice(0, -2);
        if (name.endsWith('s')) return name.slice(0, -1);
        return name;
      };
      const isStructural = (fk) => {
        const col = fk.fromCol;
        const target = fk.to;
        return col === `${target}_id` || col === `${singularize(target)}_id`;
      };
      const structuralFks = allFks.filter(fk => isStructural(fk) && fk.from !== fk.to);

      const allNames = tableList.map(t => t.name);
      const nameSet = new Set(allNames);
      const children = {};
      const depth = {};
      for (const n of allNames) { children[n] = []; depth[n] = 0; }
      for (const fk of structuralFks) {
        if (nameSet.has(fk.to) && nameSet.has(fk.from)) {
          children[fk.to].push(fk.from);
        }
      }
      const hasStructuralParent = new Set(structuralFks.filter(fk => nameSet.has(fk.to)).map(fk => fk.from));
      const roots = allNames.filter(n => !hasStructuralParent.has(n));
      const queue = [...roots];
      const visited = new Set(roots);
      while (queue.length > 0) {
        const cur = queue.shift();
        for (const child of children[cur]) {
          const d = depth[cur] + 1;
          if (d > depth[child]) depth[child] = d;
          if (!visited.has(child)) { visited.add(child); queue.push(child); }
        }
      }
      let changed = true;
      while (changed) {
        changed = false;
        for (const fk of structuralFks) {
          if (nameSet.has(fk.from) && nameSet.has(fk.to)) {
            const d = depth[fk.to] + 1;
            if (d > depth[fk.from]) { depth[fk.from] = d; changed = true; }
          }
        }
      }
      const maxDepth = Math.max(0, ...Object.values(depth));
      for (const n of allNames) { if (!visited.has(n)) depth[n] = maxDepth + 1; }

      const byDepth = {};
      for (const n of allNames) {
        const d = depth[n];
        if (!byDepth[d]) byDepth[d] = [];
        byDepth[d].push(n);
      }

      let yOffset = 60;
      for (const d of Object.keys(byDepth).map(Number).sort((a, b) => a - b)) {
        const group = byDepth[d];
        const startX = 320;
        let maxCardH = 0;
        for (let i = 0; i < group.length; i++) {
          const name = group[i];
          pos[name] = { x: startX + i * 320, y: yOffset };
          const cardH = HEAD_H + (tableMap[name]?.cols?.length || 0) * ROW_H + 8;
          if (cardH > maxCardH) maxCardH = cardH;
        }
        yOffset += maxCardH + 60;
      }

      // position views/indexes/triggers below tables
      let vIdx = 0;
      for (const v of viewList) {
        if (!pos[v.name]) {
          pos[`view:${v.name}`] = { x: 320 + vIdx * 280, y: yOffset };
          vIdx++;
        }
      }
      if (viewList.length > 0) yOffset += HEAD_H + 38 + 60;

      let iIdx = 0;
      for (const idx of indexList) {
        if (!pos[`index:${idx.name}`]) {
          pos[`index:${idx.name}`] = { x: 320 + iIdx * 280, y: yOffset };
          iIdx++;
        }
      }
      if (indexList.length > 0) yOffset += HEAD_H + 38 + 60;

      let tIdx = 0;
      for (const tr of triggerList) {
        if (!pos[`trigger:${tr.name}`]) {
          pos[`trigger:${tr.name}`] = { x: 320 + tIdx * 280, y: yOffset };
          tIdx++;
        }
      }

      setTables(tableMap);
      setViews(viewList);
      setIndexes(indexList);
      setTriggers(triggerList);
      setFks(allFks);
      setPositions(pos);
      setLoading(false);
    } catch {
      setLoading(false);
    }
  }, [isConnected, activeDbId]);

  useEffect(() => { loadSchema(); }, [loadSchema]);

  const startDrag = (table, e) => {
    e.preventDefault();
    const key = table;
    const start = { ...positions[key] };
    const origin = { x: e.clientX, y: e.clientY };
    dragRef.current = key;
    setSelected(key);
    const move = (ev) => {
      setPositions(prev => ({
        ...prev,
        [key]: {
          x: start.x + (ev.clientX - origin.x) / zoomRef.current,
          y: start.y + (ev.clientY - origin.y) / zoomRef.current,
        },
      }));
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      dragRef.current = null;
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }, []);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    const kind = e.dataTransfer.getData('text/plain');
    if (!ENTITY_TYPES.find(t => t.kind === kind)) return;
    const stageEl = stageRef.current;
    if (!stageEl) return;
    const rect = stageEl.getBoundingClientRect();
    const x = (e.clientX - rect.left + stageEl.scrollLeft) / zoomRef.current;
    const y = (e.clientY - rect.top + stageEl.scrollTop) / zoomRef.current;

    const id = nextDraftId();
    const name = kind === 'table' ? 'new_table' : kind === 'view' ? 'new_view' : kind === 'index' ? 'new_index' : 'new_trigger';
    const existing = drafts.filter(d => d.kind === kind).length;
    const draftName = existing > 0 ? `${name}_${existing + 1}` : name;

    const draft = {
      id, kind, name: draftName,
      columns: kind === 'table' ? [{ name: 'id', type: 'INTEGER', pk: true, notnull: false, unique: false, defaultValue: '', fkTable: '', fkColumn: '' }] : undefined,
      sql: kind === 'view' ? '' : undefined,
      targetTable: (kind === 'index' || kind === 'trigger') ? '' : undefined,
      indexColumns: kind === 'index' ? '' : undefined,
      unique: kind === 'index' ? false : undefined,
      event: kind === 'trigger' ? 'INSERT' : undefined,
      timing: kind === 'trigger' ? 'AFTER' : undefined,
    };

    setDrafts(prev => [...prev, draft]);
    setPositions(prev => ({ ...prev, [id]: { x: Math.round(x), y: Math.round(y) } }));
    setSelected(id);
  }, [drafts]);

  const updateDraft = useCallback((id, updates) => {
    setDrafts(prev => prev.map(d => d.id === id ? { ...d, ...updates } : d));
  }, []);

  const removeDraft = useCallback((id) => {
    setDrafts(prev => prev.filter(d => d.id !== id));
    setPositions(prev => { const p = { ...prev }; delete p[id]; return p; });
    setSelected(s => s === id ? null : s);
  }, []);

  const markForDeletion = useCallback((name, type) => {
    setDeletions(prev => {
      if (prev.some(d => d.name === name)) return prev;
      const next = [...prev];
      if (type === 'table') {
        const childTables = fks.filter(f => f.to === name).map(f => f.from);
        for (const child of childTables) {
          if (!next.some(d => d.name === child)) {
            next.push({ name: child, type: 'table', cascadedFrom: name });
          }
        }
      }
      next.push({ name, type });
      return next;
    });
    setModifications(prev => prev.filter(m => m.name !== name));
    setSelected(null);
  }, [fks]);

  const unmarkDeletion = useCallback((name) => {
    setDeletions(prev => prev.filter(d => d.name !== name && d.cascadedFrom !== name));
  }, []);

  const modifyEntity = useCallback((name, kind, changes) => {
    setModifications(prev => {
      const existing = prev.find(m => m.name === name && m.kind === kind);
      if (existing) {
        return prev.map(m => m.name === name && m.kind === kind ? { ...m, ...changes } : m);
      }
      return [...prev, { name, kind, ...changes }];
    });
  }, []);

  const unmodifyEntity = useCallback((name, kind) => {
    setModifications(prev => prev.filter(m => !(m.name === name && m.kind === kind)));
  }, []);

  const hasChanges = drafts.length > 0 || deletions.length > 0 || modifications.length > 0;

  const discardAll = useCallback(() => {
    setDrafts([]);
    setDeletions([]);
    setModifications([]);
    setSelected(null);
  }, []);

  const handlePublish = async () => {
    setPublishing(true);
    setPublishError(null);
    try {
      const allStmts = [
        ...collectDropStmts(deletions),
        ...collectModStmts(modifications, originalSchema),
        ...collectCreateStmts(drafts),
      ];
      for (const stmt of allStmts) {
        await executeDdl(stmt, activeDbId);
      }
      setDrafts([]);
      setDeletions([]);
      setModifications([]);
      setShowPublish(false);
      await loadSchema();
    } catch (e) {
      setPublishError(e.message || 'Failed to publish');
    }
    setPublishing(false);
  };

  const selectedDraft = drafts.find(d => d.id === selected);
  const selectedTable = !selectedDraft && selected && tables[selected] ? tables[selected] : null;
  const selectedView = !selectedDraft && !selectedTable && selected?.startsWith('view:') ? views.find(v => `view:${v.name}` === selected) : null;
  const selectedIndex = !selectedDraft && !selectedTable && selected?.startsWith('index:') ? indexes.find(v => `index:${v.name}` === selected) : null;
  const selectedTrigger = !selectedDraft && !selectedTable && selected?.startsWith('trigger:') ? triggers.find(v => `trigger:${v.name}` === selected) : null;
  const selectedExisting = selectedTable || selectedView || selectedIndex || selectedTrigger;
  const selectedExistingKind = selectedTable ? 'table' : selectedView ? 'view' : selectedIndex ? 'index' : selectedTrigger ? 'trigger' : null;
  const selectedExistingName = selectedTable?.name || selectedView?.name || selectedIndex?.name || selectedTrigger?.name;

  return (
    <>
      <div className="cv-toolbar">
        {hasChanges && (
          <div className="cv-toolbar-drafts">
            {drafts.length > 0 && <span className="pill pill-accent small">{drafts.length} new</span>}
            {modifications.length > 0 && <span className="pill pill-warn small">{modifications.length} modified</span>}
            {deletions.length > 0 && <span className="pill pill-err small">{deletions.length} to drop</span>}
            <button className="btn btn-primary btn-xs" onClick={() => setShowPublish(true)}>
              <Icon name="upload" size={10} />
              Publish
            </button>
            <button className="btn btn-xs" onClick={discardAll}>
              Discard all
            </button>
          </div>
        )}
        <div style={{ flex: 1 }} />
        <div className="cv-zoom">
          <button className="cv-zoom-btn" onClick={() => setZoom(Math.max(0.5, zoom - 0.1))}><Icon name="minus" size={11} /></button>
          <span className="mono small">{Math.round(zoom * 100)}%</span>
          <button className="cv-zoom-btn" onClick={() => setZoom(Math.min(1.6, zoom + 0.1))}><Icon name="plus" size={11} /></button>
        </div>
      </div>

      <div className="cv-body">
        <CVSidebar />

        {loading ? (
          <div className="cv-stage" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-3)' }}>
            Loading schema…
          </div>
        ) : !isConnected ? (
          <div className="cv-stage" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-3)' }}>
            Open a database to view its schema.
          </div>
        ) : (
          <div className="cv-stage" ref={stageRef} onDragOver={handleDragOver} onDrop={handleDrop}>
            <ErdCanvas
              tables={tables}
              views={views}
              indexes={indexes}
              triggers={triggers}
              drafts={drafts}
              deletions={deletions}
              modifications={modifications}
              fks={fks}
              positions={positions}
              selected={selected}
              onSelect={setSelected}
              onDragStart={startDrag}
              onMarkDelete={markForDeletion}
              onUnmarkDelete={unmarkDeletion}
              onRemoveDraft={removeDraft}
              zoom={zoom}
              scrollRef={stageRef}
            />
          </div>
        )}

        {selectedDraft && (
          <CVDraftInspector
            draft={selectedDraft}
            tables={tables}
            onUpdate={updateDraft}
            onRemove={removeDraft}
          />
        )}
        {selectedExisting && (
          <CVEntityInspector
            entity={selectedExisting}
            kind={selectedExistingKind}
            name={selectedExistingName}
            tables={tables}
            fks={fks}
            selected={selected}
            modifications={modifications}
            onModify={modifyEntity}
            onUnmodify={unmodifyEntity}
            onNavigate={setSelected}
          />
        )}
      </div>

      {showPublish && (
        <PublishDialog
          drafts={drafts}
          deletions={deletions}
          modifications={modifications}
          originalSchema={originalSchema}
          onPublish={handlePublish}
          onCancel={() => { setShowPublish(false); setPublishError(null); }}
          error={publishError}
          busy={publishing}
        />
      )}
    </>
  );
}

function CVSidebar() {
  const handleDragStart = (kind, e) => {
    e.dataTransfer.setData('text/plain', kind);
    e.dataTransfer.effectAllowed = 'copy';
  };

  return (
    <div className="cv-sidebar">
      <div className="cv-sb-header">Schema entities</div>
      <div className="cv-sb-items">
        {ENTITY_TYPES.map(t => (
          <div
            key={t.kind}
            className="cv-sb-item"
            draggable
            onDragStart={(e) => handleDragStart(t.kind, e)}
          >
            <div className="cv-sb-item-icon"><Icon name={t.icon} size={14} /></div>
            <div>
              <div className="cv-sb-item-name">{t.name}</div>
              <div className="cv-sb-item-desc">{t.desc}</div>
            </div>
          </div>
        ))}
      </div>
      <div className="cv-sb-hint">
        <Icon name="info" size={11} />
        Drag onto the canvas to create
      </div>
    </div>
  );
}

function ErdCanvas({ tables, views, indexes, triggers, drafts, deletions, modifications, fks, positions, selected, onSelect, onDragStart, onMarkDelete, onUnmarkDelete, onRemoveDraft, zoom, scrollRef }) {
  const cardH = (name) => {
    const draft = drafts.find(d => d.id === name);
    if (draft) {
      if (draft.kind === 'table') return HEAD_H + (draft.columns?.length || 0) * ROW_H + 8;
      return HEAD_H + 30;
    }
    if (tables[name]) {
      const mod = modifications.find(m => m.name === name && m.kind === 'table');
      const cols = mod ? mod.columns : tables[name].cols;
      return HEAD_H + (cols?.length || 0) * ROW_H + 8;
    }
    return HEAD_H + 30;
  };
  const colIdx = (name, col) => (tables[name]?.cols || []).indexOf(col);

  useEffect(() => {
    const el = scrollRef?.current;
    const pos = positions[selected];
    if (!el || !pos) return;
    const ch = cardH(selected);
    const centerX = (pos.x + CARD_W / 2) * zoom;
    const centerY = (pos.y + ch / 2) * zoom;
    el.scrollTo({
      left: centerX - el.clientWidth / 2,
      top: centerY - el.clientHeight / 2,
      behavior: 'smooth',
    });
  }, [selected]);

  const anchor = (t, c, side) => {
    const p = positions[t];
    if (!p) return { x: 0, y: 0 };
    const y = p.y + HEAD_H + colIdx(t, c) * ROW_H + ROW_H / 2;
    const x = side === 'right' ? p.x + CARD_W : p.x;
    return { x, y };
  };

  const fkPaths = fks
    .filter(fk => positions[fk.from] && positions[fk.to])
    .map((fk, i) => {
      const fromCenterX = positions[fk.from].x + CARD_W / 2;
      const toCenterX = positions[fk.to].x + CARD_W / 2;
      const fromSide = fromCenterX < toCenterX ? 'right' : 'left';
      const toSide = fromCenterX < toCenterX ? 'left' : 'right';
      const a = anchor(fk.from, fk.fromCol, fromSide);
      const b = anchor(fk.to, fk.toCol, toSide);
      const dx = Math.max(40, Math.abs(b.x - a.x) * 0.4);
      const c1x = a.x + (fromSide === 'right' ? dx : -dx);
      const c2x = b.x + (toSide === 'right' ? dx : -dx);
      const d = `M ${a.x} ${a.y} C ${c1x} ${a.y}, ${c2x} ${b.y}, ${b.x} ${b.y}`;
      const highlight = fk.from === selected || fk.to === selected;
      return { i, d, highlight };
    });

  const allPositions = Object.values(positions);
  const maxX = Math.max(1200, ...allPositions.map(p => p.x)) + CARD_W + 100;
  const maxY = Math.max(800, ...Object.entries(positions).map(([k, p]) => p.y + cardH(k))) + 100;

  return (
    <div className="cv-canvas-outer">
      <div className="cv-canvas" style={{ width: maxX, height: maxY, transform: `scale(${zoom})`, transformOrigin: '0 0' }}>
        <svg className="cv-svg" width={maxX} height={maxY}>
          <defs>
            <pattern id="cv-dots" width="20" height="20" patternUnits="userSpaceOnUse">
              <circle cx="1" cy="1" r="1" fill="var(--border)" />
            </pattern>
            <marker id="cv-arrow" markerWidth="9" markerHeight="9" refX="6" refY="4.5" orient="auto">
              <path d="M 0 0 L 8 4.5 L 0 9 Z" fill="var(--text-3)" />
            </marker>
            <marker id="cv-arrow-on" markerWidth="9" markerHeight="9" refX="6" refY="4.5" orient="auto">
              <path d="M 0 0 L 8 4.5 L 0 9 Z" fill="var(--accent)" />
            </marker>
          </defs>
          <rect width="100%" height="100%" fill="url(#cv-dots)" />
          {fkPaths.map(({ i, d, highlight }) => (
            <path
              key={i}
              d={d}
              stroke={highlight ? 'var(--accent)' : 'var(--border-strong)'}
              strokeWidth={highlight ? 2 : 1.4}
              fill="none"
              markerEnd={highlight ? 'url(#cv-arrow-on)' : 'url(#cv-arrow)'}
              opacity={highlight ? 1 : 0.7}
            />
          ))}
        </svg>

        {Object.entries(tables).map(([k, t]) => positions[k] && (
          <ErdCard
            key={k}
            table={t}
            pos={positions[k]}
            selected={selected === k}
            deletion={deletions.find(d => d.name === k) || null}
            modified={modifications.some(m => m.name === k && m.kind === 'table')}
            modifiedCols={modifications.find(m => m.name === k && m.kind === 'table')?.columns}
            newName={modifications.find(m => m.name === k && m.kind === 'table')?.newName}
            onSelect={() => onSelect(k)}
            onNavigate={onSelect}
            onDragStart={(e) => onDragStart(k, e)}
            onDelete={() => onMarkDelete(k, 'table')}
            onUndelete={() => onUnmarkDelete(k)}
            fkMap={Object.fromEntries(fks.filter(f => f.from === k).map(f => [f.fromCol, f.to]))}
          />
        ))}

        {views.map(v => {
          const key = `view:${v.name}`;
          return positions[key] && (
            <SchemaCard
              key={key}
              id={key}
              name={v.name}
              kind="view"
              icon="view"
              detail={v.sql?.replace(/^CREATE VIEW [^\s]+ AS\s*/i, '').slice(0, 60)}
              pos={positions[key]}
              selected={selected === key}
              deletion={deletions.find(d => d.name === v.name && d.type === 'view') || null}
              modified={modifications.some(m => m.name === v.name && m.kind === 'view')}
              newName={modifications.find(m => m.name === v.name && m.kind === 'view')?.newName}
              onSelect={() => onSelect(key)}
              onDragStart={(e) => onDragStart(key, e)}
              onDelete={() => onMarkDelete(v.name, 'view')}
              onUndelete={() => onUnmarkDelete(v.name)}
            />
          );
        })}

        {indexes.map(idx => {
          const key = `index:${idx.name}`;
          return positions[key] && (
            <SchemaCard
              key={key}
              id={key}
              name={idx.name}
              kind="index"
              icon="list"
              detail={`ON ${idx.table_name} (${idx.columns.join(', ')})`}
              pos={positions[key]}
              selected={selected === key}
              deletion={deletions.find(d => d.name === idx.name && d.type === 'index') || null}
              modified={modifications.some(m => m.name === idx.name && m.kind === 'index')}
              newName={modifications.find(m => m.name === idx.name && m.kind === 'index')?.newName}
              onSelect={() => onSelect(key)}
              onDragStart={(e) => onDragStart(key, e)}
              onDelete={() => onMarkDelete(idx.name, 'index')}
              onUndelete={() => onUnmarkDelete(idx.name)}
            />
          );
        })}

        {triggers.map(tr => {
          const key = `trigger:${tr.name}`;
          return positions[key] && (
            <SchemaCard
              key={key}
              id={key}
              name={tr.name}
              kind="trigger"
              icon="play-circle"
              detail={`${tr.event} ON ${tr.table_name}`}
              pos={positions[key]}
              selected={selected === key}
              deletion={deletions.find(d => d.name === tr.name && d.type === 'trigger') || null}
              modified={modifications.some(m => m.name === tr.name && m.kind === 'trigger')}
              newName={modifications.find(m => m.name === tr.name && m.kind === 'trigger')?.newName}
              onSelect={() => onSelect(key)}
              onDragStart={(e) => onDragStart(key, e)}
              onDelete={() => onMarkDelete(tr.name, 'trigger')}
              onUndelete={() => onUnmarkDelete(tr.name)}
            />
          );
        })}

        {drafts.map(d => positions[d.id] && (
          <DraftCard
            key={d.id}
            draft={d}
            pos={positions[d.id]}
            selected={selected === d.id}
            onSelect={() => onSelect(d.id)}
            onDragStart={(e) => onDragStart(d.id, e)}
            onDelete={() => onRemoveDraft(d.id)}
          />
        ))}
      </div>
    </div>
  );
}

function ErdCard({ table, pos, selected, deletion, modified, modifiedCols, newName, onSelect, onNavigate, onDragStart, onDelete, onUndelete, fkMap }) {
  const deleted = !!deletion;
  const cascaded = deletion?.cascadedFrom;
  const displayCols = modifiedCols || table.cols;
  const origColNames = new Set(table.cols);
  const renamed = newName && newName !== table.name;
  return (
    <div
      className={cx('erd-card', selected && 'is-selected', deleted && 'is-deleted', modified && 'is-modified')}
      style={{ left: pos.x, top: pos.y, width: CARD_W }}
      onClick={onSelect}
    >
      <div className="erd-head" onMouseDown={onDragStart}>
        <Icon name="table" size={12} />
        <span className="erd-name">{renamed ? newName : table.name}</span>
        {modified && <span className="erd-mod-badge">edited</span>}
        {cascaded && <span className="erd-cascade-badge" title={`Depends on ${cascaded}`}>FK dep</span>}
        {deleted ? (
          <button className="erd-action erd-undo" onClick={(e) => { e.stopPropagation(); onUndelete(); }} title="Undo delete">
            <Icon name="refresh" size={10} />
          </button>
        ) : (
          <button className="erd-action erd-trash" onClick={(e) => { e.stopPropagation(); onDelete(); }} title="Mark for deletion">
            <Icon name="trash" size={10} />
          </button>
        )}
      </div>
      <div className="erd-rows-list">
        {(modifiedCols || table.cols.map(c => ({ name: c }))).map((colOrName, idx) => {
          const colObj = typeof colOrName === 'string' ? null : colOrName;
          const c = colObj?.name || colOrName;
          const isPk = colObj ? colObj.pk : c === table.pk;
          const fkTarget = colObj?.fkTable || fkMap[c];
          const isNew = modifiedCols && !origColNames.has(c);
          return (
            <div
              key={idx}
              className={cx('erd-row', isPk && 'is-pk', fkTarget && 'is-fk', fkTarget && 'is-link', isNew && 'is-added')}
              onClick={fkTarget ? (e) => { e.stopPropagation(); onNavigate(typeof fkTarget === 'string' ? fkTarget : fkTarget); } : undefined}
            >
              <span className="erd-row-icon">
                {isPk ? <Icon name="key" size={10} /> : fkTarget ? <Icon name="chevron-right" size={10} /> : <span className="erd-row-dot"></span>}
              </span>
              <span className="erd-col mono">{c}</span>
              {fkTarget && <span className="erd-fk-target mono">→ {fkTarget}</span>}
              {isNew && <span className="erd-new-badge">+</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SchemaCard({ id, name, kind, icon, detail, pos, selected, deletion, modified, newName, onSelect, onDragStart, onDelete, onUndelete }) {
  const deleted = !!deletion;
  const cascaded = deletion?.cascadedFrom;
  const renamed = newName && newName !== name;
  return (
    <div
      className={cx('erd-card', 'erd-schema-card', selected && 'is-selected', deleted && 'is-deleted', modified && 'is-modified')}
      style={{ left: pos.x, top: pos.y, width: CARD_W }}
      onClick={onSelect}
    >
      <div className="erd-head" onMouseDown={onDragStart}>
        <Icon name={icon} size={12} />
        <span className="erd-name">{renamed ? newName : name}</span>
        {modified && <span className="erd-mod-badge">edited</span>}
        {cascaded && <span className="erd-cascade-badge" title={`Depends on ${cascaded}`}>FK dep</span>}
        {deleted ? (
          <button className="erd-action erd-undo" onClick={(e) => { e.stopPropagation(); onUndelete(); }} title="Undo delete">
            <Icon name="refresh" size={10} />
          </button>
        ) : (
          <button className="erd-action erd-trash" onClick={(e) => { e.stopPropagation(); onDelete(); }} title="Mark for deletion">
            <Icon name="trash" size={10} />
          </button>
        )}
      </div>
      <div style={{ padding: '6px 12px', fontSize: '0.917em', color: 'var(--text-3)' }}>
        <span className="mono">{kind}</span>
        {detail && <span className="mono" style={{ marginLeft: 6, opacity: 0.7 }}>{detail}</span>}
      </div>
    </div>
  );
}

function DraftCard({ draft, pos, selected, onSelect, onDragStart, onDelete }) {
  const iconMap = { table: 'table', view: 'view', index: 'list', trigger: 'play-circle' };
  return (
    <div
      className={cx('erd-card', 'is-draft', selected && 'is-selected')}
      style={{ left: pos.x, top: pos.y, width: CARD_W }}
      onClick={onSelect}
    >
      <div className="erd-head" onMouseDown={onDragStart}>
        <Icon name={iconMap[draft.kind] || 'table'} size={12} />
        <span className="erd-name">{draft.name}</span>
        <button className="erd-action erd-trash" onClick={(e) => { e.stopPropagation(); onDelete(); }} title="Remove draft">
          <Icon name="trash" size={10} />
        </button>
      </div>
      {draft.kind === 'table' && draft.columns && (
        <div className="erd-rows-list">
          {draft.columns.map((c, i) => (
            <div key={i} className={cx('erd-row', c.pk && 'is-pk', c.fkTable && 'is-fk')}>
              <span className="erd-row-icon">
                {c.pk ? <Icon name="key" size={10} /> : c.fkTable ? <Icon name="chevron-right" size={10} /> : <span className="erd-row-dot"></span>}
              </span>
              <span className="erd-col mono">{c.name}</span>
              {c.fkTable ? <span className="erd-fk-target mono">→ {c.fkTable}</span> : <span className="erd-fk-target mono">{c.type}</span>}
            </div>
          ))}
        </div>
      )}
      {draft.kind !== 'table' && (
        <div style={{ padding: '8px 12px', fontSize: '0.917em', color: 'var(--text-3)' }}>
          {draft.kind === 'view' ? 'Click to define query' : 'Click to configure'}
        </div>
      )}
    </div>
  );
}

function CVEntityInspector({ entity, kind, name, tables, fks, selected, modifications, onModify, onUnmodify, onNavigate }) {
  const mod = modifications.find(m => m.name === name && m.kind === kind);
  const isModified = !!mod;

  if (kind === 'table') {
    return (
      <CVTableInspector
        table={entity}
        tables={tables}
        fks={fks}
        selected={selected}
        mod={mod}
        onModify={(changes) => onModify(name, 'table', changes)}
        onUnmodify={() => onUnmodify(name, 'table')}
        onNavigate={onNavigate}
      />
    );
  }

  if (kind === 'view') {
    const currentSql = mod?.sql ?? entity.sql?.replace(/^CREATE VIEW [^\s]+ AS\s*/i, '') ?? '';
    return (
      <CVViewInspector
        view={entity}
        currentSql={currentSql}
        mod={mod}
        isModified={isModified}
        onModify={(changes) => onModify(name, 'view', changes)}
        onUnmodify={() => onUnmodify(name, 'view')}
      />
    );
  }

  if (kind === 'index') {
    return (
      <CVIndexInspector
        index={entity}
        tables={tables}
        mod={mod}
        isModified={isModified}
        onModify={(changes) => onModify(name, 'index', changes)}
        onUnmodify={() => onUnmodify(name, 'index')}
      />
    );
  }

  if (kind === 'trigger') {
    return (
      <CVTriggerInspector
        trigger={entity}
        tables={tables}
        mod={mod}
        isModified={isModified}
        onModify={(changes) => onModify(name, 'trigger', changes)}
        onUnmodify={() => onUnmodify(name, 'trigger')}
      />
    );
  }

  return null;
}

function ColumnEditor({ columns, tables, onAdd, onUpdate, onRemove }) {
  const [expanded, setExpanded] = useState(null);
  const tableNames = Object.keys(tables);

  const getTargetCols = (tableName) => {
    const t = tables[tableName];
    return t?.cols || [];
  };

  return (
    <div className="cv-insp-section">
      <div className="cv-insp-section-h" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span>COLUMNS · {columns.length}</span>
        <button className="cv-zoom-btn" onClick={onAdd} title="Add column" style={{ width: 18, height: 18 }}>
          <Icon name="plus" size={9} />
        </button>
      </div>
      <div className="cv-insp-cols">
        {columns.map((col, i) => (
          <div key={i} className="cv-col-block">
            <div className="cv-draft-col">
              <input
                className="field-input mono cv-draft-col-name"
                value={col.name}
                onChange={(e) => onUpdate(i, { name: e.target.value })}
                placeholder="column_name"
              />
              <select
                className="field-input mono cv-draft-col-type"
                value={col.type}
                onChange={(e) => onUpdate(i, { type: e.target.value })}
              >
                {['INTEGER', 'TEXT', 'REAL', 'BLOB', 'NUMERIC'].map(t => <option key={t}>{t}</option>)}
              </select>
              <label className="cv-draft-flag" title="Primary key">
                <input type="checkbox" checked={col.pk} onChange={(e) => onUpdate(i, { pk: e.target.checked })} />
                PK
              </label>
              <label className="cv-draft-flag" title="Not null">
                <input type="checkbox" checked={col.notnull} onChange={(e) => onUpdate(i, { notnull: e.target.checked })} />
                NN
              </label>
              <button
                className={cx('cv-col-expand', expanded === i && 'is-open')}
                onClick={() => setExpanded(expanded === i ? null : i)}
                title="Default & FK"
              >
                <Icon name="chevron-down" size={9} />
              </button>
              <button className="cv-draft-col-rm" onClick={() => { onRemove(i); if (expanded === i) setExpanded(null); }} title="Remove column">
                <Icon name="close" size={9} />
              </button>
            </div>
            {expanded === i && (
              <div className="cv-col-extra">
                <div className="cv-col-extra-row">
                  <span className="cv-col-extra-label">Default</span>
                  <input
                    className="field-input mono cv-col-extra-input"
                    value={col.defaultValue || ''}
                    onChange={(e) => onUpdate(i, { defaultValue: e.target.value })}
                    placeholder="none"
                  />
                </div>
                <div className="cv-col-extra-row">
                  <span className="cv-col-extra-label">FK →</span>
                  <select
                    className="field-input mono cv-col-extra-select"
                    value={col.fkTable || ''}
                    onChange={(e) => onUpdate(i, { fkTable: e.target.value, fkColumn: '' })}
                  >
                    <option value="">none</option>
                    {tableNames.map(n => <option key={n} value={n}>{n}</option>)}
                  </select>
                  {col.fkTable && (
                    <select
                      className="field-input mono cv-col-extra-select"
                      value={col.fkColumn || ''}
                      onChange={(e) => onUpdate(i, { fkColumn: e.target.value })}
                    >
                      <option value="">column…</option>
                      {getTargetCols(col.fkTable).map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  )}
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function CVTableInspector({ table, tables, fks, selected, mod, onModify, onUnmodify, onNavigate }) {
  const outgoing = fks.filter(f => f.from === (typeof selected === 'string' && !selected.startsWith('view:') && !selected.startsWith('index:') && !selected.startsWith('trigger:') ? selected : ''));
  const incoming = fks.filter(f => f.to === table.name);
  const fkMap = Object.fromEntries(outgoing.map(f => [f.fromCol, { table: f.to, column: f.toCol }]));

  const origCols = (table.columnDetails || []).map(c => {
    const fk = fkMap[c.name];
    return {
      name: c.name,
      type: c.type || 'TEXT',
      pk: c.pk || false,
      notnull: c.notnull || false,
      unique: c.unique || false,
      defaultValue: c.default_value || '',
      fkTable: fk?.table || '',
      fkColumn: fk?.column || '',
    };
  });

  const currentCols = mod?.columns || origCols;
  const currentName = mod?.newName || table.name;
  const isModified = !!mod;

  const checkAndApply = (changes) => {
    const merged = { ...mod, ...changes };
    const nameMatches = !merged.newName || merged.newName === table.name;
    const cols = merged.columns || origCols;
    const colsSame = cols.length === origCols.length && cols.every((c, i) => {
      const o = origCols[i];
      return c.name === o.name && c.type === o.type && c.pk === o.pk && c.notnull === o.notnull &&
        c.unique === o.unique && (c.defaultValue || '') === (o.defaultValue || '') &&
        (c.fkTable || '') === (o.fkTable || '') && (c.fkColumn || '') === (o.fkColumn || '');
    });
    if (nameMatches && colsSame) {
      onUnmodify();
    } else {
      onModify(changes);
    }
  };

  const setColumns = (cols) => {
    checkAndApply({ columns: cols });
  };

  const handleRename = (newName) => {
    checkAndApply({ newName: newName || table.name });
  };

  const addColumn = () => {
    const cols = [...currentCols];
    cols.push({ name: 'column_' + (cols.length + 1), type: 'TEXT', pk: false, notnull: false, unique: false, defaultValue: '', fkTable: '', fkColumn: '' });
    setColumns(cols);
  };

  const updateColumn = (idx, updates) => {
    const cols = [...currentCols];
    cols[idx] = { ...cols[idx], ...updates };
    setColumns(cols);
  };

  const removeColumn = (idx) => {
    const cols = currentCols.filter((_, i) => i !== idx);
    setColumns(cols);
  };

  return (
    <div className="cv-inspector">
      <div className="cv-insp-head">
        <Icon name="table" size={14} />
        <input
          className="cv-insp-title-input mono"
          value={currentName}
          onChange={(e) => handleRename(e.target.value)}
          spellCheck={false}
        />
        <span className="pill pill-soft small">{table.rows.toLocaleString()} rows</span>
        {isModified && <span className="pill pill-warn small">modified</span>}
      </div>

      {isModified && (
        <div className="cv-insp-section" style={{ borderBottom: 'none', paddingBottom: 0 }}>
          <button className="btn btn-xs" style={{ width: '100%' }} onClick={onUnmodify}>
            <Icon name="refresh" size={10} />
            Revert changes
          </button>
        </div>
      )}

      <ColumnEditor
        columns={currentCols}
        tables={tables}
        onAdd={addColumn}
        onUpdate={updateColumn}
        onRemove={removeColumn}
      />

      {(() => {
        const modFks = currentCols.filter(c => c.fkTable && c.fkColumn).map(c => ({
          fromCol: c.name, to: c.fkTable, toCol: c.fkColumn,
        }));
        const dbFks = outgoing.filter(fk => !modFks.some(m => m.fromCol === fk.fromCol));
        const allOut = [...dbFks, ...modFks];
        return allOut.length > 0 && (
          <div className="cv-insp-section">
            <div className="cv-insp-section-h">REFERENCES → · {allOut.length}</div>
            {allOut.map((fk, i) => (
              <div key={i} className="cv-insp-fk is-link" onClick={() => onNavigate(fk.to)}>
                <span className="mono">{fk.fromCol}</span>
                <Icon name="chevron-right" size={10} />
                <span className="mono accent">{fk.to}</span>
                <span className="mono muted small">.{fk.toCol}</span>
              </div>
            ))}
          </div>
        );
      })()}

      {incoming.length > 0 && (
        <div className="cv-insp-section">
          <div className="cv-insp-section-h">REFERENCED BY · {incoming.length}</div>
          {incoming.map((fk, i) => (
            <div key={i} className="cv-insp-fk is-link" onClick={() => onNavigate(fk.from)}>
              <span className="mono accent">{fk.from}</span>
              <span className="mono muted small">.{fk.fromCol}</span>
              <Icon name="chevron-right" size={10} />
              <span className="mono">{fk.toCol}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function CVViewInspector({ view, currentSql, mod, isModified, onModify, onUnmodify }) {
  const origSql = view.sql?.replace(/^CREATE VIEW [^\s]+ AS\s*/i, '') ?? '';
  const currentName = mod?.newName || view.name;

  const checkAndApply = (changes) => {
    const merged = { ...mod, ...changes };
    const nameMatches = !merged.newName || merged.newName === view.name;
    const sqlMatches = !merged.sql || merged.sql.trim() === origSql.trim();
    if (nameMatches && sqlMatches) {
      onUnmodify();
    } else {
      onModify(changes);
    }
  };

  const handleSqlChange = (newSql) => {
    checkAndApply({ sql: newSql });
  };

  const handleRename = (newName) => {
    checkAndApply({ newName: newName || view.name });
  };

  return (
    <div className="cv-inspector">
      <div className="cv-insp-head">
        <Icon name="view" size={14} />
        <input
          className="cv-insp-title-input mono"
          value={currentName}
          onChange={(e) => handleRename(e.target.value)}
          spellCheck={false}
        />
        {isModified && <span className="pill pill-warn small">modified</span>}
      </div>

      {isModified && (
        <div className="cv-insp-section" style={{ borderBottom: 'none', paddingBottom: 0 }}>
          <button className="btn btn-xs" style={{ width: '100%' }} onClick={onUnmodify}>
            <Icon name="refresh" size={10} />
            Revert changes
          </button>
        </div>
      )}

      <div className="cv-insp-section">
        <div className="cv-insp-section-h">SELECT QUERY</div>
        <textarea
          className="field-input mono"
          value={currentSql}
          onChange={(e) => handleSqlChange(e.target.value)}
          placeholder="SELECT * FROM ..."
          rows={8}
          style={{ width: '100%', fontSize: '0.917em', resize: 'vertical' }}
        />
      </div>
    </div>
  );
}

function CVIndexInspector({ index, tables, mod, isModified, onModify, onUnmodify }) {
  const tableNames = Object.keys(tables);
  const currentTable = mod?.targetTable ?? index.table_name;
  const currentCols = mod?.indexColumns ?? index.columns.join(', ');
  const currentUnique = mod?.unique ?? index.unique;
  const currentName = mod?.newName || index.name;

  const handleChange = (field, value) => {
    const updated = {
      targetTable: currentTable,
      indexColumns: currentCols,
      unique: currentUnique,
      newName: currentName,
      [field]: value,
    };
    const nameMatches = !updated.newName || updated.newName === index.name;
    const same = nameMatches &&
      updated.targetTable === index.table_name &&
      updated.indexColumns === index.columns.join(', ') &&
      updated.unique === index.unique;
    if (same) {
      onUnmodify();
    } else {
      onModify(updated);
    }
  };

  return (
    <div className="cv-inspector">
      <div className="cv-insp-head">
        <Icon name="list" size={14} />
        <input
          className="cv-insp-title-input mono"
          value={currentName}
          onChange={(e) => handleChange('newName', e.target.value || index.name)}
          spellCheck={false}
        />
        {isModified && <span className="pill pill-warn small">modified</span>}
      </div>

      {isModified && (
        <div className="cv-insp-section" style={{ borderBottom: 'none', paddingBottom: 0 }}>
          <button className="btn btn-xs" style={{ width: '100%' }} onClick={onUnmodify}>
            <Icon name="refresh" size={10} />
            Revert changes
          </button>
        </div>
      )}

      <div className="cv-insp-section">
        <div className="cv-insp-section-h">TARGET TABLE</div>
        <select
          className="field-input mono"
          value={currentTable}
          onChange={(e) => handleChange('targetTable', e.target.value)}
          style={{ width: '100%', fontSize: '1em' }}
        >
          <option value="">Select table…</option>
          {tableNames.map(n => <option key={n} value={n}>{n}</option>)}
        </select>
      </div>

      <div className="cv-insp-section">
        <div className="cv-insp-section-h">COLUMNS</div>
        <input
          className="field-input mono"
          value={currentCols}
          onChange={(e) => handleChange('indexColumns', e.target.value)}
          placeholder="col1, col2"
          style={{ width: '100%', fontSize: '1em' }}
        />
      </div>

      <div className="cv-insp-section">
        <label className="cv-draft-flag" style={{ fontSize: '1em' }}>
          <input type="checkbox" checked={currentUnique} onChange={(e) => handleChange('unique', e.target.checked)} />
          Unique index
        </label>
      </div>
    </div>
  );
}

function CVTriggerInspector({ trigger, tables, mod, isModified, onModify, onUnmodify }) {
  const tableNames = Object.keys(tables);

  const parsedTiming = (() => {
    const sql = trigger.sql || '';
    const upper = sql.toUpperCase();
    if (upper.includes('INSTEAD OF')) return 'INSTEAD OF';
    if (upper.includes('BEFORE')) return 'BEFORE';
    return 'AFTER';
  })();

  const parsedBody = (() => {
    const sql = trigger.sql || '';
    const beginIdx = sql.toUpperCase().indexOf('BEGIN');
    const endIdx = sql.toUpperCase().lastIndexOf('END');
    if (beginIdx >= 0 && endIdx > beginIdx) {
      return sql.slice(beginIdx + 5, endIdx).trim();
    }
    return '';
  })();

  const currentTable = mod?.targetTable ?? trigger.table_name;
  const currentEvent = mod?.event ?? trigger.event;
  const currentTiming = mod?.timing ?? parsedTiming;
  const currentSql = mod?.sql ?? parsedBody;
  const currentName = mod?.newName || trigger.name;

  const handleChange = (field, value) => {
    const updated = {
      targetTable: currentTable,
      event: currentEvent,
      timing: currentTiming,
      sql: currentSql,
      newName: currentName,
      [field]: value,
    };
    const nameMatches = !updated.newName || updated.newName === trigger.name;
    const same = nameMatches &&
      updated.targetTable === trigger.table_name &&
      updated.event === trigger.event &&
      updated.timing === parsedTiming &&
      updated.sql === parsedBody;
    if (same) {
      onUnmodify();
    } else {
      onModify(updated);
    }
  };

  return (
    <div className="cv-inspector">
      <div className="cv-insp-head">
        <Icon name="play-circle" size={14} />
        <input
          className="cv-insp-title-input mono"
          value={currentName}
          onChange={(e) => handleChange('newName', e.target.value || trigger.name)}
          spellCheck={false}
        />
        {isModified && <span className="pill pill-warn small">modified</span>}
      </div>

      {isModified && (
        <div className="cv-insp-section" style={{ borderBottom: 'none', paddingBottom: 0 }}>
          <button className="btn btn-xs" style={{ width: '100%' }} onClick={onUnmodify}>
            <Icon name="refresh" size={10} />
            Revert changes
          </button>
        </div>
      )}

      <div className="cv-insp-section">
        <div className="cv-insp-section-h">TARGET TABLE</div>
        <select
          className="field-input mono"
          value={currentTable}
          onChange={(e) => handleChange('targetTable', e.target.value)}
          style={{ width: '100%', fontSize: '1em' }}
        >
          <option value="">Select table…</option>
          {tableNames.map(n => <option key={n} value={n}>{n}</option>)}
        </select>
      </div>

      <div className="cv-insp-section">
        <div className="cv-insp-section-h">TIMING & EVENT</div>
        <div style={{ display: 'flex', gap: 6 }}>
          <select className="field-input mono" value={currentTiming} onChange={(e) => handleChange('timing', e.target.value)} style={{ flex: 1, fontSize: '1em' }}>
            {['BEFORE', 'AFTER', 'INSTEAD OF'].map(t => <option key={t}>{t}</option>)}
          </select>
          <select className="field-input mono" value={currentEvent} onChange={(e) => handleChange('event', e.target.value)} style={{ flex: 1, fontSize: '1em' }}>
            {['INSERT', 'UPDATE', 'DELETE'].map(t => <option key={t}>{t}</option>)}
          </select>
        </div>
      </div>

      <div className="cv-insp-section">
        <div className="cv-insp-section-h">TRIGGER BODY</div>
        <textarea
          className="field-input mono"
          value={currentSql}
          onChange={(e) => handleChange('sql', e.target.value)}
          placeholder="UPDATE ... SET ..."
          rows={6}
          style={{ width: '100%', fontSize: '0.917em', resize: 'vertical' }}
        />
      </div>
    </div>
  );
}

function CVDraftInspector({ draft, tables, onUpdate, onRemove }) {
  const iconMap = { table: 'table', view: 'view', index: 'list', trigger: 'play-circle' };
  const tableNames = Object.keys(tables);

  const addColumn = () => {
    const cols = [...(draft.columns || [])];
    cols.push({ name: 'column_' + (cols.length + 1), type: 'TEXT', pk: false, notnull: false, unique: false, defaultValue: '', fkTable: '', fkColumn: '' });
    onUpdate(draft.id, { columns: cols });
  };

  const updateColumn = (idx, updates) => {
    const cols = [...(draft.columns || [])];
    cols[idx] = { ...cols[idx], ...updates };
    onUpdate(draft.id, { columns: cols });
  };

  const removeColumn = (idx) => {
    const cols = (draft.columns || []).filter((_, i) => i !== idx);
    onUpdate(draft.id, { columns: cols });
  };

  return (
    <div className="cv-inspector">
      <div className="cv-insp-head">
        <Icon name={iconMap[draft.kind] || 'table'} size={14} />
        <span className="cv-insp-title">{draft.name}</span>
        <span className="pill pill-accent small">draft</span>
      </div>

      <div className="cv-insp-section">
        <div className="cv-insp-section-h">NAME</div>
        <input
          className="field-input mono"
          value={draft.name}
          onChange={(e) => onUpdate(draft.id, { name: e.target.value })}
          style={{ width: '100%', fontSize: '1em' }}
        />
      </div>

      {draft.kind === 'table' && (
        <ColumnEditor
          columns={draft.columns || []}
          tables={tables}
          onAdd={addColumn}
          onUpdate={updateColumn}
          onRemove={removeColumn}
        />
      )}

      {draft.kind === 'view' && (
        <div className="cv-insp-section">
          <div className="cv-insp-section-h">SELECT QUERY</div>
          <textarea
            className="field-input mono"
            value={draft.sql || ''}
            onChange={(e) => onUpdate(draft.id, { sql: e.target.value })}
            placeholder="SELECT * FROM ..."
            rows={6}
            style={{ width: '100%', fontSize: '0.917em', resize: 'vertical' }}
          />
        </div>
      )}

      {draft.kind === 'index' && (
        <>
          <div className="cv-insp-section">
            <div className="cv-insp-section-h">TARGET TABLE</div>
            <select
              className="field-input mono"
              value={draft.targetTable || ''}
              onChange={(e) => onUpdate(draft.id, { targetTable: e.target.value })}
              style={{ width: '100%', fontSize: '1em' }}
            >
              <option value="">Select table…</option>
              {tableNames.map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
          <div className="cv-insp-section">
            <div className="cv-insp-section-h">COLUMNS</div>
            <input
              className="field-input mono"
              value={draft.indexColumns || ''}
              onChange={(e) => onUpdate(draft.id, { indexColumns: e.target.value })}
              placeholder="col1, col2"
              style={{ width: '100%', fontSize: '1em' }}
            />
          </div>
          <div className="cv-insp-section">
            <label className="cv-draft-flag" style={{ fontSize: '1em' }}>
              <input type="checkbox" checked={draft.unique || false} onChange={(e) => onUpdate(draft.id, { unique: e.target.checked })} />
              Unique index
            </label>
          </div>
        </>
      )}

      {draft.kind === 'trigger' && (
        <>
          <div className="cv-insp-section">
            <div className="cv-insp-section-h">TARGET TABLE</div>
            <select
              className="field-input mono"
              value={draft.targetTable || ''}
              onChange={(e) => onUpdate(draft.id, { targetTable: e.target.value })}
              style={{ width: '100%', fontSize: '1em' }}
            >
              <option value="">Select table…</option>
              {tableNames.map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
          <div className="cv-insp-section">
            <div className="cv-insp-section-h">TIMING & EVENT</div>
            <div style={{ display: 'flex', gap: 6 }}>
              <select className="field-input mono" value={draft.timing || 'AFTER'} onChange={(e) => onUpdate(draft.id, { timing: e.target.value })} style={{ flex: 1, fontSize: '1em' }}>
                {['BEFORE', 'AFTER', 'INSTEAD OF'].map(t => <option key={t}>{t}</option>)}
              </select>
              <select className="field-input mono" value={draft.event || 'INSERT'} onChange={(e) => onUpdate(draft.id, { event: e.target.value })} style={{ flex: 1, fontSize: '1em' }}>
                {['INSERT', 'UPDATE', 'DELETE'].map(t => <option key={t}>{t}</option>)}
              </select>
            </div>
          </div>
          <div className="cv-insp-section">
            <div className="cv-insp-section-h">TRIGGER BODY</div>
            <textarea
              className="field-input mono"
              value={draft.sql || ''}
              onChange={(e) => onUpdate(draft.id, { sql: e.target.value })}
              placeholder="UPDATE ... SET ..."
              rows={4}
              style={{ width: '100%', fontSize: '0.917em', resize: 'vertical' }}
            />
          </div>
        </>
      )}

      <div className="cv-insp-section" style={{ borderBottom: 'none' }}>
        <button className="btn btn-danger btn-xs" style={{ width: '100%' }} onClick={() => onRemove(draft.id)}>
          <Icon name="trash" size={10} />
          Remove draft
        </button>
      </div>
    </div>
  );
}

function PublishDialog({ drafts, deletions, modifications, originalSchema, onPublish, onCancel, error, busy }) {
  const allStmts = [
    ...collectDropStmts(deletions),
    ...collectModStmts(modifications, originalSchema),
    ...collectCreateStmts(drafts),
  ];
  const ddl = formatDdlPreview(allStmts);
  const parts = [];
  if (deletions.length > 0) parts.push(`drop ${deletions.length}`);
  if (modifications.length > 0) parts.push(`modify ${modifications.length}`);
  if (drafts.length > 0) parts.push(`create ${drafts.length}`);
  return (
    <div className="cipher-confirm-overlay" onClick={onCancel}>
      <div className="cipher-confirm" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 560 }}>
        <div className="cipher-confirm-title" style={{ color: deletions.length > 0 ? 'var(--err)' : 'var(--accent)' }}>
          <Icon name="upload" size={16} />
          Publish changes ({parts.join(', ')})
        </div>
        <p className="cipher-confirm-desc">
          The following SQL will be executed against the connected database.
          {deletions.length > 0 && ' Dropped tables and their data cannot be recovered.'}
          {deletions.some(d => d.cascadedFrom) && ' Tables with foreign key dependencies are included automatically.'}
          {modifications.length > 0 && ' Modified tables will be recreated — existing data in shared columns is preserved.'}
        </p>
        <pre className="cv-publish-sql mono">{ddl}</pre>
        {error && (
          <div style={{ padding: '6px 10px', marginTop: 8, borderRadius: 6, fontSize: '1em', background: 'var(--err-soft, rgba(255,80,80,0.1))', color: 'var(--err)' }}>
            {error}
          </div>
        )}
        <div className="btn-row" style={{ marginTop: 16, justifyContent: 'flex-end' }}>
          <button className="btn" onClick={onCancel} disabled={busy}>Cancel</button>
          <button className="btn btn-primary" onClick={onPublish} disabled={busy}>
            {busy ? 'Publishing…' : 'Execute SQL'}
          </button>
        </div>
      </div>
    </div>
  );
}
