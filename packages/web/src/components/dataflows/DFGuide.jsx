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
        body: 'Data Flows is a visual ETL (Extract, Transform, Load) pipeline builder. It lets you move, reshape, and clean data across your local SQLite and SQLCipher databases without writing scripts.',
      },
      {
        type: 'text',
        body: 'Each pipeline is a directed graph of nodes connected by edges. Data flows from source nodes through transforms and cleaning steps, then lands in sink nodes. You build pipelines by dragging nodes onto a canvas and wiring them together.',
      },
      {
        type: 'concepts',
        items: [
          { icon: 'play-circle', label: 'Pipeline', desc: 'A saved DAG of nodes and edges that moves data from sources to sinks.' },
          { icon: 'dot', label: 'Node', desc: 'A single operation — reading a table, filtering rows, writing output, etc.' },
          { icon: 'merge', label: 'Edge', desc: 'A connection between two nodes. Data flows along edges from output ports to input ports.' },
          { icon: 'database', label: 'Connection', desc: 'A registered database or file that nodes can read from or write to.' },
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
        body: 'The home page shows all your saved pipelines as cards. Starred pipelines appear in their own section at the top.',
      },
      {
        type: 'steps',
        items: [
          { action: 'New pipeline', desc: 'Click the "New pipeline" button in the top-right, or the primary call-to-action card. Give it a name and you\'ll land on a blank canvas.' },
          { action: 'From a template', desc: 'Click "From a template" to start with a pre-built pipeline pattern like dev-to-prod copy, encryption, or deduplication.' },
          { action: 'Connections', desc: 'Click "Connections" to register databases and files that your pipelines will read from and write to.' },
          { action: 'Open a pipeline', desc: 'Click any pipeline card to open it in the canvas editor.' },
          { action: 'Delete a pipeline', desc: 'Hover over a pipeline card and click the X button to delete it.' },
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
        body: 'The canvas editor is where you build and run pipelines. It has three panels: the node library on the left, the canvas in the center, and the inspector on the right.',
      },
      {
        type: 'subsection',
        title: 'Adding nodes',
        body: 'Open the node library on the left (toggle it with the sidebar button). Browse or search for the node type you want, then drag it onto the canvas. The node appears where you drop it.',
      },
      {
        type: 'subsection',
        title: 'Wiring nodes',
        body: 'Each node has input and output ports (the small circles on its left and right edges). Click and drag from an output port to an input port on another node to create an edge. Data will flow along that edge when you run the pipeline.',
      },
      {
        type: 'subsection',
        title: 'Moving and selecting',
        body: 'Drag a node\'s header to reposition it. Click a node to select it — the inspector panel on the right will show its configuration. Click the canvas background to deselect.',
      },
      {
        type: 'subsection',
        title: 'Removing nodes and edges',
        body: 'Select a node and press Delete or Backspace to remove it (and all its edges). Click on an edge line to remove just that connection.',
      },
      {
        type: 'subsection',
        title: 'Pan and zoom',
        body: 'Scroll to zoom in and out. Click and drag on an empty area of the canvas to pan. The minimap in the bottom-right corner shows your viewport position.',
      },
      {
        type: 'shortcuts',
        items: [
          { keys: '⌘ Enter', action: 'Run pipeline' },
          { keys: '⌘ S', action: 'Force save' },
          { keys: '⌘ Z', action: 'Undo' },
          { keys: '⌘ ⇧ Z', action: 'Redo' },
          { keys: 'Delete', action: 'Remove selected node' },
          { keys: 'Escape', action: 'Deselect node' },
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
        body: 'When you select a node, the inspector panel opens on the right with tabs for different aspects of that node.',
      },
      {
        type: 'tabs',
        items: [
          { label: 'Config', desc: 'The main configuration form for the node. Every node type has its own fields — for example, a source table node shows a database picker and table selector; a filter node shows a predicate expression field.' },
          { label: 'Mapping', desc: 'For nodes that transform columns (like Map Columns), shows a two-pane view linking source columns to target columns with SVG connection lines.' },
          { label: 'Schema', desc: 'Shows the column schema going in and coming out of the node, highlighting any changes (added, removed, or modified columns).' },
          { label: 'Preview', desc: 'Executes the pipeline up to this node and shows a sample of the rows it would produce. Use this to verify your transforms are working correctly.' },
          { label: 'Issues', desc: 'Shows any validation warnings specific to this node, such as missing configuration or type mismatches.' },
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
        body: 'The dock panel at the bottom of the editor provides pipeline-wide information. Drag its top edge to resize it, or click the minimize button to collapse it.',
      },
      {
        type: 'tabs',
        items: [
          { label: 'Preview', desc: 'Shows a data preview for the selected node — similar to the inspector preview tab but displayed inline below the canvas.' },
          { label: 'Log', desc: 'The live run log. When you execute a pipeline, events stream here in real time: node start/finish, row counts, errors, and timing.' },
          { label: 'Issues', desc: 'Pipeline-wide validation. Click "Refresh" to run all validators and see warnings across every node.' },
          { label: 'History', desc: 'A table of past runs with status, duration, row counts, and timestamps.' },
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
        body: 'Nodes are grouped into seven families. Each family has a distinct color on the canvas so you can visually identify the role of each step.',
      },
      {
        type: 'family',
        families: [
          {
            name: 'Sources', family: 'source', icon: 'database',
            desc: 'Read data into the pipeline. Connect to SQLite/SQLCipher tables, views, SQL queries, CSV, JSON, Parquet files, or entire folders.',
          },
          {
            name: 'Transform', family: 'transform', icon: 'filter',
            desc: 'Reshape data: filter rows, select/rename/derive columns, join or union multiple streams, group and aggregate, sort, or limit row counts.',
          },
          {
            name: 'Cleaning', family: 'clean', icon: 'dedupe',
            desc: 'Improve data quality: deduplicate, fill nulls, trim whitespace, normalize case, anonymize PII, or validate rows against rules.',
          },
          {
            name: 'Schema ops', family: 'schema', icon: 'columns',
            desc: 'Modify the target table\'s schema: add, drop, or rename columns, change types, or create indexes.',
          },
          {
            name: 'Code', family: 'code', icon: 'terminal',
            desc: 'Custom logic via inline SQL, Python, or JavaScript scriptlets for transforms that don\'t fit a built-in node.',
          },
          {
            name: 'Encryption', family: 'encrypt', icon: 'lock',
            desc: 'Manage database encryption: convert between plaintext SQLite and SQLCipher, or rekey an encrypted database.',
          },
          {
            name: 'Sinks', family: 'sink', icon: 'table',
            desc: 'Write data out: insert into SQLite/SQLCipher tables (append, replace, or upsert), or export to CSV, JSON, or Parquet files.',
          },
        ],
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
        body: 'The run bar in the top center of the editor controls execution. Choose a run mode, toggle options, then click Run (or press ⌘ Enter).',
      },
      {
        type: 'subsection',
        title: 'Run modes',
        body: null,
      },
      {
        type: 'concepts',
        items: [
          { icon: 'eye', label: 'Preview', desc: 'Executes sources with a small row sample and runs all transforms, but skips sink writes. Use this to verify your pipeline logic without touching any data.' },
          { icon: 'shield', label: 'Dry run', desc: 'Runs the full pipeline but sinks validate without writing. Confirms that connections work, schemas match, and the pipeline would succeed.' },
          { icon: 'play', label: 'Full run', desc: 'Executes everything for real. Sources read all rows, transforms process them, and sinks write to their targets.' },
        ],
      },
      {
        type: 'subsection',
        title: 'Run options',
        body: null,
      },
      {
        type: 'concepts',
        items: [
          { icon: 'lock', label: 'Transactional', desc: 'When enabled, all sink writes happen inside a transaction. If any node fails, everything rolls back.' },
          { icon: 'refresh', label: 'Streaming counters', desc: 'When enabled, node and edge row counters update live on the canvas as the pipeline runs.' },
        ],
      },
      {
        type: 'subsection',
        title: 'During a run',
        body: 'The dock\'s Log tab shows events as they stream in. Nodes display live row counters on the canvas, and edges show how many rows have passed through. When the run completes, check the History tab for a summary.',
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
        body: 'Connections register the databases and files your pipelines work with. Any database you have open in the main application is automatically available. You can also register additional databases through the Connections panel.',
      },
      {
        type: 'steps',
        items: [
          { action: 'Open Connections', desc: 'Click "Connections" in the top bar or on the home page.' },
          { action: 'Add a connection', desc: 'Click "+ Add connection", give it a name, select its type (SQLite, SQLCipher, CSV folder), and provide the file path.' },
          { action: 'Use in a node', desc: 'When configuring a source or sink node, the database dropdown shows all connected databases by filename. Hover to see the full path.' },
          { action: 'Remove a connection', desc: 'Click the delete button next to a connection to unregister it. This does not delete the database file.' },
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
          'Always run a Preview or Dry run before doing a Full run on important data.',
          'Use the Preview tab in the inspector to verify each node\'s output as you build.',
          'Star frequently-used pipelines so they appear at the top of the home page.',
          'Templates are a great starting point — create a pipeline from a template, then customize it.',
          'The pipeline auto-saves as you make changes. The dot next to the pipeline name indicates unsaved changes.',
          'Use Undo (⌘Z) freely — every node add, delete, edge change, and config edit can be reversed.',
          'For complex transforms, chain multiple simple nodes rather than writing one large SQL query.',
          'The Validate Rows node can route bad rows to a dead-letter table, keeping your sink data clean.',
          'When moving data between an encrypted and unencrypted database, the edge will show a cross-database badge.',
        ],
      },
    ],
  },
];

function GuideNav({ activeId, onSelect }) {
  return (
    <nav className="df-guide-nav">
      {SECTIONS.map(s => (
        <button
          key={s.id}
          className={cx('df-guide-nav-item', activeId === s.id && 'is-active')}
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
  const section = SECTIONS.find(s => s.id === activeId);

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
            {activeId !== SECTIONS[0].id && (
              <button className="btn small" onClick={() => setActiveId(SECTIONS[SECTIONS.findIndex(s => s.id === activeId) - 1].id)}>
                <Icon name="chevron-left" size={10} /> Previous
              </button>
            )}
            <span style={{ flex: 1 }} />
            {activeId !== SECTIONS[SECTIONS.length - 1].id ? (
              <button className="btn small btn-primary" onClick={() => setActiveId(SECTIONS[SECTIONS.findIndex(s => s.id === activeId) + 1].id)}>
                Next <Icon name="chevron-right" size={10} />
              </button>
            ) : (
              <button className="btn small btn-primary" onClick={() => setView('home')}>
                Get started <Icon name="chevron-right" size={10} />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
