import { useState } from 'react';
import { Icon } from '../icons/Icon';
import { useDataFlowStore } from '../../stores/dataflow';

const cx = (...xs) => xs.filter(Boolean).join(' ');

const SECTIONS = [
  {
    id: 'overview',
    title: 'What are Data Flows?',
    icon: 'shield',
    content: [
      {
        type: 'text',
        body: 'Data Flows is a visual ETL (Extract, Transform, Load) pipeline builder. It moves, reshapes, cleans, and re-encrypts data across your local SQLite and SQLCipher databases and flat files without writing scripts.',
      },
      {
        type: 'text',
        body: 'Each pipeline is a directed graph of nodes connected by edges. Rows flow from source nodes through transform and cleaning steps and land in sink nodes. You build pipelines by dragging nodes onto a canvas and wiring their ports together; the pipeline saves itself as you edit.',
      },
      {
        type: 'concepts',
        items: [
          { icon: 'play-circle', label: 'Pipeline', desc: 'A saved graph of nodes and edges, plus its run history and optional schedule.' },
          { icon: 'dot', label: 'Node', desc: 'A single step: read a table, filter rows, anonymize a column, write a file, and so on. Each node has a Config form and a short editable summary shown on the canvas.' },
          { icon: 'merge', label: 'Edge', desc: 'A connection from an output port to an input port. Most nodes have one "out" port; Validate rows also has "rejected", and Join has "L" and "R" inputs.' },
          { icon: 'database', label: 'Connection', desc: 'A database nodes can read or write. Databases open in the app are always available; register more under Connections.' },
        ],
      },
    ],
  },
  {
    id: 'home',
    title: 'The home page',
    icon: 'home',
    content: [
      {
        type: 'text',
        body: 'The home page lists your pipelines as cards with node count, tags, and the status, duration, row count, and time of the last run. Starred pipelines get their own section. The KPI tiles show runs, rows moved, and failures over the last 7 days.',
      },
      {
        type: 'steps',
        items: [
          { action: 'New pipeline', desc: 'Click "New pipeline" in the top bar or on the primary card. Enter a name (required), an optional description and comma-separated tags, then press Enter or click Create. You land on an empty canvas.' },
          { action: 'From a template', desc: 'Click "From a template" (or "From template…" inside the New dialog). Pick a template, adjust the pipeline name, and click Create. A real pipeline is created with the template\'s nodes, edges, and placeholder settings for you to fill in.' },
          { action: 'Connections', desc: 'Register additional .db or SQLCipher files by name and path so they appear in every database picker.' },
          { action: 'Open a pipeline', desc: 'Click a card, or focus it and press Enter, to open it in the editor.' },
          { action: 'Delete a pipeline', desc: 'Click the X on a card. You are asked to confirm; deletion also removes the run history.' },
        ],
      },
    ],
  },
  {
    id: 'canvas',
    title: 'The canvas editor',
    icon: 'maximize',
    content: [
      {
        type: 'text',
        body: 'The editor has three panels: the node library on the left, the canvas in the centre, and the inspector on the right, with a dock along the bottom. The left and right panels collapse into thin rails.',
      },
      {
        type: 'subsection',
        title: 'Adding nodes',
        body: 'Search or browse the node library and drag a node onto the canvas. It is selected immediately so you can configure it in the inspector. Nodes marked "soon" can be placed, but the backend refuses to run them and validation reports an error.',
      },
      {
        type: 'subsection',
        title: 'Wiring nodes',
        body: 'Drag from an output port (right side of a node) to an input port (left side) to create an edge. Join has two inputs, L and R; Validate rows has a second output, "rejected". When an edge connects nodes that reference different databases, it shows a cross-database badge.',
      },
      {
        type: 'subsection',
        title: 'Selecting and moving',
        body: 'Click a node to select it; shift-click or shift-drag a marquee on empty canvas to select several. Drag to move the selection; moves are undoable. Click empty canvas to deselect.',
      },
      {
        type: 'subsection',
        title: 'Pan and zoom',
        body: 'Plain mouse wheel pans the canvas; hold ctrl or ⌘ while scrolling to zoom around the cursor. Drag empty canvas to pan. The minimap in the corner shows a rectangle for the current viewport; click anywhere on it to jump there.',
      },
      {
        type: 'shortcuts',
        items: [
          { keys: '⌘ Enter', action: 'Run pipeline in the selected mode' },
          { keys: '⌘ S', action: 'Save now (pipelines also auto-save)' },
          { keys: '⌘ Z', action: 'Undo (edits, wiring, moves)' },
          { keys: '⌘ ⇧ Z', action: 'Redo' },
          { keys: '⌘ D', action: 'Duplicate the selection' },
          { keys: 'Delete', action: 'Remove the selected nodes or edge' },
          { keys: 'Shift + drag', action: 'Marquee select' },
          { keys: 'Ctrl / ⌘ + wheel', action: 'Zoom' },
          { keys: 'Escape', action: 'Clear selection' },
        ],
      },
    ],
  },
  {
    id: 'inspector',
    title: 'The inspector panel',
    icon: 'sliders',
    content: [
      {
        type: 'text',
        body: 'Select a node and the inspector shows tabs for that node. The Issues tab shows a count badge when validation reports problems on the node.',
      },
      {
        type: 'tabs',
        items: [
          { label: 'Config', desc: 'An editable summary plus the node\'s settings. Database pickers list open and registered databases; table pickers list existing tables and fall back to a text field when the list cannot be read or you want a new table.' },
          { label: 'Mapping', desc: 'Only for Map columns and the SQLite table sink. Two panes list upstream columns and target columns; click a source then a target to link them, or edit the from → to rows directly. "Auto-map by name" matches case-insensitively; "Clear all" removes every mapping.' },
          { label: 'Schema', desc: 'The columns and types inferred for this node\'s output, with added, removed, and type-changed badges against the first upstream node. Inference runs automatically after each save; use "Run schema inference" to trigger it manually.' },
          { label: 'Preview', desc: 'Runs the pipeline up to this node in preview mode and shows a sample of rows with column types in the header. Nothing is written. Errors are shown inline.' },
          { label: 'Issues', desc: 'Validation results for this node, each with a level pill (warn or error) and message. Click "Validate pipeline" to re-run validation.' },
        ],
      },
    ],
  },
  {
    id: 'dock',
    title: 'The bottom dock',
    icon: 'terminal',
    content: [
      {
        type: 'text',
        body: 'The dock provides pipeline-wide views. Drag its top edge to resize it, or collapse it to a bar.',
      },
      {
        type: 'tabs',
        items: [
          { label: 'Preview', desc: 'Sample rows for the selected node, shown below the canvas.' },
          { label: 'Log', desc: 'The live run log: status changes, per-node info / warn / error messages, and row counts as they stream in.' },
          { label: 'Issues', desc: 'Pipeline-wide validation. Click "Validate pipeline" to check every node.' },
          { label: 'History', desc: 'Past runs with status, mode, duration, total rows, and start time.' },
        ],
      },
    ],
  },
  {
    id: 'nodes',
    title: 'Node catalog',
    icon: 'plus',
    content: [
      {
        type: 'text',
        body: 'Nodes come in seven families, each with its own colour on the canvas.',
      },
      {
        type: 'family',
        families: [
          {
            name: 'Sources', family: 'source', icon: 'database',
            desc: 'Read rows in: a table or view (with optional WHERE), a SELECT query, CSV, JSON / JSONL, Parquet (optional extra), another SQLite / SQLCipher file by path, or a folder of files matched by glob.',
          },
          {
            name: 'Transform', family: 'transform', icon: 'filter',
            desc: 'Filter, select / drop columns, rename, cast, derive, join (inner / left / right / full on L and R inputs), union, group + aggregate, sort, limit, and bulk column mapping.',
          },
          {
            name: 'Cleaning', family: 'clean', icon: 'dedupe',
            desc: 'Deduplicate, fill nulls, trim, normalize case, anonymize (hash / redact / tokenize / fake with a salt or env:VAR), and validate rows with drop / fail / route behaviour.',
          },
          {
            name: 'Schema ops', family: 'schema', icon: 'columns',
            desc: 'Add, drop, or rename columns, change a column type, or add an index on a table in a connected database. Full runs only; rows pass through.',
          },
          {
            name: 'Code', family: 'code', icon: 'terminal',
            desc: 'Inline SQL: a SELECT over _input (and _input2, _input3, … for more inputs). Python and JavaScript scriptlets are listed but not available yet.',
          },
          {
            name: 'Encryption', family: 'encrypt', icon: 'lock',
            desc: 'Encrypt copy writes a SQLCipher copy of a plaintext database; Decrypt copy writes a plaintext copy of an encrypted one; Rekey changes a database\'s passphrase. Full runs only; the source is never modified except by Rekey.',
          },
          {
            name: 'Sinks', family: 'sink', icon: 'table',
            desc: 'Write to a table (append / replace / upsert with key columns and batch size), to a table in another SQLite / SQLCipher file, or to CSV, JSON / JSONL, or Parquet.',
          },
        ],
      },
      {
        type: 'subsection',
        title: 'Validate rows',
        body: 'Rules are either a SQL expression that must be true, or a column check: not_null, unique, numeric, non_empty, or regex:<pattern>. On failure, "drop" discards failing rows and marks the run partial, "fail" stops the run at the first bad row, and "route" sends failing rows out of the "rejected" port so you can land them in their own sink.',
      },
    ],
  },
  {
    id: 'running',
    title: 'Running a pipeline',
    icon: 'play',
    content: [
      {
        type: 'text',
        body: 'The run bar in the top centre controls execution. Pick a mode, set the options, then click Run or press ⌘ Enter. While a run is active the button becomes Stop, which cancels the run between nodes or between sink batches.',
      },
      { type: 'subsection', title: 'Run modes', body: null },
      {
        type: 'concepts',
        items: [
          { icon: 'eye', label: 'Preview', desc: 'Reads a small sample from each source and runs every transform; sinks, schema ops, and encryption steps only log what they would do.' },
          { icon: 'shield', label: 'Dry run', desc: 'Runs the full data path but nothing is written. Confirms connections, expressions, and mappings before touching real data.' },
          { icon: 'play', label: 'Full run', desc: 'Executes everything: sources read all rows, sinks write, schema ops and encryption steps run.' },
        ],
      },
      { type: 'subsection', title: 'Run options', body: null },
      {
        type: 'concepts',
        items: [
          { icon: 'lock', label: 'Transactional', desc: 'All SQLite table sink writes on a connection happen inside one transaction and are rolled back if the run fails.' },
          { icon: 'refresh', label: 'Streaming counters', desc: 'Row counters on nodes and edges update live as progress events stream in.' },
        ],
      },
      {
        type: 'subsection',
        title: 'Run status',
        body: 'A run ends as ok (no warnings), partial (a warning was logged or rows were dropped, for example by Validate rows), failed (an error stopped the run and any transactional writes were rolled back), or cancelled (you pressed Stop). The dock Log shows the events; History keeps the summary.',
      },
      {
        type: 'subsection',
        title: 'Scheduling and the CLI',
        body: 'Use the schedule control in the top bar to attach a 5-field cron expression (minute hour day-of-month month day-of-week) and enable it; the server checks every 30 seconds and runs due pipelines in full mode. You can also run pipelines from a terminal with the sqlcipherui-pipeline command: list, run <id or name> [--mode full|dry|preview], and validate <id or name>.',
      },
    ],
  },
  {
    id: 'connections',
    title: 'Managing connections',
    icon: 'database',
    content: [
      {
        type: 'text',
        body: 'Every database open in the main app is available to nodes automatically. Connections let you register more files so they show up in the database pickers even when they are not open.',
      },
      {
        type: 'steps',
        items: [
          { action: 'Open Connections', desc: 'Click "Connections" in the top bar or on the home page.' },
          { action: 'Add', desc: 'Click "Add connection", enter a name and the file path, tick "Encrypted" for SQLCipher files, and save.' },
          { action: 'Edit', desc: 'Click the pencil on a row to change its name, path, or encrypted flag.' },
          { action: 'Use in a node', desc: 'Database pickers show open and registered databases by filename; hover to see the full path. Table lists are only available for databases that are open; otherwise type the table name.' },
          { action: 'Remove', desc: 'Click the trash icon and confirm. The database file itself is not deleted.' },
        ],
      },
    ],
  },
  {
    id: 'tips',
    title: 'Tips and best practices',
    icon: 'spark',
    content: [
      {
        type: 'tips',
        items: [
          'Run a Preview or Dry run before a Full run on important data.',
          'Use the inspector Preview tab to check each node\'s output as you build, and the Schema tab to see how each step changes the columns.',
          'Star frequently used pipelines so they appear at the top of the home page.',
          'Templates create real pipelines; fill in the database, table, and path placeholders, then run a Dry run.',
          'Pipelines auto-save. The dot next to the name means a save is pending; ⌘ S saves immediately.',
          'Undo (⌘ Z) covers node adds, deletes, moves, wiring, and config edits. ⌘ D duplicates the selection.',
          'Prefer a chain of small nodes over one large Inline SQL step; each node can be previewed and validated on its own.',
          'Route rejected rows from Validate rows to their own sink instead of dropping them.',
          'For anonymization, keep the salt out of the pipeline with env:VAR_NAME so exports stay reproducible but the salt is not saved.',
          'A cross-database badge on an edge means the two nodes use different databases; Transactional only covers writes within one connection.',
        ],
      },
    ],
  },
];

function GuideNav({ activeId, onSelect }) {
  return (
    <nav className="df-guide-nav" aria-label="Guide sections">
      {SECTIONS.map(s => (
        <button
          type="button"
          key={s.id}
          className={cx('df-guide-nav-item', activeId === s.id && 'is-active')}
          aria-current={activeId === s.id ? 'page' : undefined}
          onClick={() => onSelect(s.id)}
        >
          <Icon name={s.icon} size={12} />
          <span>{s.title}</span>
        </button>
      ))}
    </nav>
  );
}

function renderBlock(block, i) {
  switch (block.type) {
    case 'text':
      return <p key={i} className="df-guide-text">{block.body}</p>;

    case 'subsection':
      return (
        <div key={i} className="df-guide-sub">
          <h4>{block.title}</h4>
          {block.body && <p className="df-guide-text">{block.body}</p>}
        </div>
      );

    case 'concepts':
      return (
        <div key={i} className="df-guide-concepts">
          {block.items.map((item, j) => (
            <div key={j} className="df-guide-concept">
              <div className="df-guide-concept-icon"><Icon name={item.icon} size={14} /></div>
              <div>
                <b>{item.label}</b>
                <span className="df-guide-concept-desc">{item.desc}</span>
              </div>
            </div>
          ))}
        </div>
      );

    case 'steps':
      return (
        <ol key={i} className="df-guide-steps">
          {block.items.map((item, j) => (
            <li key={j}>
              <b>{item.action}</b>
              <span>{item.desc}</span>
            </li>
          ))}
        </ol>
      );

    case 'shortcuts':
      return (
        <div key={i} className="df-guide-shortcuts">
          {block.items.map((item, j) => (
            <div key={j} className="df-guide-shortcut">
              <kbd>{item.keys}</kbd>
              <span>{item.action}</span>
            </div>
          ))}
        </div>
      );

    case 'tabs':
      return (
        <div key={i} className="df-guide-tabs-list">
          {block.items.map((item, j) => (
            <div key={j} className="df-guide-tab-item">
              <span className="df-guide-tab-label">{item.label}</span>
              <span>{item.desc}</span>
            </div>
          ))}
        </div>
      );

    case 'family':
      return (
        <div key={i} className="df-guide-families">
          {block.families.map((f, j) => (
            <div key={j} className={cx('df-guide-family', `df-family-${f.family}`)}>
              <div className="df-guide-family-head">
                <Icon name={f.icon} size={13} />
                <b>{f.name}</b>
              </div>
              <span>{f.desc}</span>
            </div>
          ))}
        </div>
      );

    case 'tips':
      return (
        <ul key={i} className="df-guide-tips">
          {block.items.map((tip, j) => (
            <li key={j}>{tip}</li>
          ))}
        </ul>
      );

    default:
      return null;
  }
}

export function DFGuide() {
  const [activeId, setActiveId] = useState(SECTIONS[0].id);
  const setView = useDataFlowStore((s) => s.setView);
  const index = SECTIONS.findIndex(s => s.id === activeId);
  const section = SECTIONS[index];

  return (
    <div className="df-guide">
      <div className="df-guide-layout">
        <GuideNav activeId={activeId} onSelect={setActiveId} />
        <div className="df-guide-content">
          <div className="df-guide-header">
            <Icon name={section.icon} size={18} />
            <h2>{section.title}</h2>
          </div>
          <div className="df-guide-body">
            {section.content.map(renderBlock)}
          </div>
          <div className="df-guide-footer">
            {index > 0 && (
              <button type="button" className="btn small" onClick={() => setActiveId(SECTIONS[index - 1].id)}>
                <Icon name="chevron-left" size={10} /> Previous
              </button>
            )}
            <span style={{ flex: 1 }} />
            {index < SECTIONS.length - 1 ? (
              <button type="button" className="btn small btn-primary" onClick={() => setActiveId(SECTIONS[index + 1].id)}>
                Next <Icon name="chevron-right" size={10} />
              </button>
            ) : (
              <button type="button" className="btn small btn-primary" onClick={() => setView('home')}>
                Get started <Icon name="chevron-right" size={10} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
