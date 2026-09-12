"""Execution engine for visual ETL/data pipelines.

Topologically sorts a DAG of nodes and executes each in order, routing
data (``list[dict]``) between them via named output ports.  Three run
modes are supported:

- **preview** -- uses sample data with LIMIT, no writes
- **dry**     -- validates sinks but skips actual writes
- **full**    -- real execution with writes

Node executors live in :mod:`sqlcipherui_core.services.pipeline_nodes`;
SQL helpers in :mod:`sqlcipherui_core.services.pipeline_sql`.
"""

from __future__ import annotations

import asyncio
import logging
import threading
import time
from collections import defaultdict, deque
from collections.abc import Callable

from sqlcipherui_core.services.app_db import AppDatabase
from sqlcipherui_core.services.connection_manager import ConnectionManager
from sqlcipherui_core.services.pipeline_nodes import (
    EXECUTORS,
    ExecutionContext,
    NodeExecutor,
    NodeInputs,
    RunCancelled,
    utc_now_sql,
)
from sqlcipherui_core.services.pipeline_sql import (
    infer_column_types,
    json_safe,
    quote_ident,
)

__all__ = [
    "EXECUTORS",
    "ExecutionContext",
    "NodeExecutor",
    "NodeInputs",
    "PipelineExecutor",
    "RunCancelled",
    "active_runs",
    "cancel_run",
    "infer_column_types",
    "quote_ident",
]

logger = logging.getLogger(__name__)

# Node kinds that may legitimately have no incoming edge besides sources.
_STANDALONE_PREFIXES = ("src-", "sc-", "en-", "snk-")
_STANDALONE_KINDS = {"co-sql"}


# ------------------------------------------------------------------ #
# Cancellation registry                                                #
# ------------------------------------------------------------------ #

_ACTIVE: dict[int, threading.Event] = {}
_ACTIVE_LOCK = threading.Lock()


def _register_run(run_id: int) -> threading.Event:
    event = threading.Event()
    with _ACTIVE_LOCK:
        _ACTIVE[run_id] = event
    return event


def _unregister_run(run_id: int) -> None:
    with _ACTIVE_LOCK:
        _ACTIVE.pop(run_id, None)


def cancel_run(run_id: int) -> bool:
    """Set the cancel flag for an active run.  Returns False if it is not running."""
    with _ACTIVE_LOCK:
        event = _ACTIVE.get(run_id)
    if event is None:
        return False
    event.set()
    return True


def active_runs() -> list[int]:
    with _ACTIVE_LOCK:
        return sorted(_ACTIVE)


# ------------------------------------------------------------------ #
# DAG utilities                                                        #
# ------------------------------------------------------------------ #


def _topo_sort(nodes: list[dict], edges: list[dict]) -> list[str]:
    """Kahn's algorithm.  Returns node IDs in execution order or raises on a cycle."""
    node_ids = [n["id"] for n in nodes]
    id_set = set(node_ids)
    in_degree: dict[str, int] = dict.fromkeys(node_ids, 0)
    adjacency: dict[str, list[str]] = defaultdict(list)

    for edge in edges:
        src, dst = edge.get("from"), edge.get("to")
        if src in id_set and dst in id_set:
            adjacency[src].append(dst)
            in_degree[dst] += 1

    queue: deque[str] = deque(nid for nid in node_ids if in_degree[nid] == 0)
    order: list[str] = []
    while queue:
        nid = queue.popleft()
        order.append(nid)
        for neighbor in adjacency[nid]:
            in_degree[neighbor] -= 1
            if in_degree[neighbor] == 0:
                queue.append(neighbor)

    if len(order) != len(id_set):
        raise ValueError("Pipeline contains a cycle -- topological sort is impossible")
    return order


def _incoming(node_id: str, edges: list[dict]) -> list[dict]:
    return [e for e in edges if e.get("to") == node_id]


def _from_port(edge: dict) -> str:
    return edge.get("fromPort") or edge.get("from_port") or "out"


def _normalize_output(result) -> dict[str, list[dict]]:
    if result is None:
        return {"out": []}
    if isinstance(result, dict):
        ports = {str(k): list(v or []) for k, v in result.items()}
        ports.setdefault("out", [])
        return ports
    return {"out": list(result)}


class NodeFailure(Exception):
    """A node raised during a full run; carries the node id and kind."""

    def __init__(self, node_id: str, kind: str, exc: Exception):
        super().__init__(f"Node {node_id} ({kind}): {exc}")
        self.node_id = node_id
        self.kind = kind
        self.cause = exc


# ------------------------------------------------------------------ #
# Pipeline executor                                                    #
# ------------------------------------------------------------------ #


class PipelineExecutor:
    """Orchestrates runs, single-node previews, schema inference and validation."""

    def __init__(self, conn_mgr: ConnectionManager, app_db: AppDatabase):
        self._conn_manager = conn_mgr
        self._app_db = app_db

    # ------------------------------------------------------------------ #
    #  Shared DAG walk                                                     #
    # ------------------------------------------------------------------ #

    async def _execute_dag(
        self,
        ctx: ExecutionContext,
        nodes: list[dict],
        edges: list[dict],
        order: list[str],
        *,
        stop_on_error: bool,
    ) -> tuple[dict[str, dict[str, list[dict]]], dict[str, dict], dict[str, str]]:
        """Run *order*; return ``(outputs, node_rows, errors)``.

        With ``stop_on_error`` a failing node raises :class:`NodeFailure`.
        Otherwise the error is recorded and every downstream node is marked
        as blocked so independent branches still produce output.
        """
        node_map = {n["id"]: n for n in nodes}
        outputs: dict[str, dict[str, list[dict]]] = {}
        node_rows: dict[str, dict] = {}
        errors: dict[str, str] = {}
        failed: set[str] = set()

        for nid in order:
            ctx.check_cancelled()
            node = node_map[nid]
            kind = node.get("kind", "")
            incoming = _incoming(nid, edges)

            blocked = [e["from"] for e in incoming if e.get("from") in failed]
            if blocked:
                errors[nid] = f"Upstream node {blocked[0]} failed"
                failed.add(nid)
                outputs[nid] = {"out": []}
                continue

            executor = EXECUTORS.get(kind)
            if executor is None:
                message = f"Unknown node kind '{kind}'; skipped"
                outputs[nid] = {"out": []}
                node_rows[nid] = {"in": 0, "out": 0}
                if stop_on_error:
                    await ctx.log("warn", nid, message)
                    ctx.skipped = True
                else:
                    errors[nid] = message
                    failed.add(nid)
                continue

            inputs = NodeInputs()
            for edge in incoming:
                src_ports = outputs.get(edge.get("from"), {})
                port = _from_port(edge)
                if port not in src_ports and src_ports:
                    await ctx.log(
                        "warn", nid, f"Upstream node {edge['from']} has no output port '{port}'"
                    )
                inputs.add(src_ports.get(port, []), edge.get("port"))
            in_rows = sum(len(rows) for rows in inputs)

            try:
                result = await executor.execute(ctx, node, inputs)
            except (RunCancelled, asyncio.CancelledError):
                raise
            except Exception as exc:
                if stop_on_error:
                    await ctx.log("error", nid, str(exc))
                    raise NodeFailure(nid, kind, exc) from exc
                errors[nid] = str(exc)
                failed.add(nid)
                outputs[nid] = {"out": []}
                node_rows[nid] = {"in": in_rows, "out": 0}
                continue

            ports = _normalize_output(result)
            outputs[nid] = ports
            out_rows = len(ports["out"])
            node_rows[nid] = {"in": in_rows, "out": out_rows}
            if kind.startswith("snk-"):
                ctx.sink_rows += in_rows
            ctx.progress(nid, in_rows, out_rows)
            for edge in edges:
                if edge.get("from") == nid:
                    port = _from_port(edge)
                    ctx.edge_progress(nid, edge["to"], port, len(ports.get(port, [])))
            await ctx.log("info", nid, f"{kind}: {in_rows} rows in, {out_rows} rows out")

        return outputs, node_rows, errors

    # ------------------------------------------------------------------ #
    #  Full / dry / preview run                                            #
    # ------------------------------------------------------------------ #

    async def run(
        self,
        pipeline_id: int,
        definition: dict,
        mode: str = "full",
        on_event: Callable[[dict], None] | None = None,
        sample_size: int = 5,
        transactional: bool = True,
        initiated_by: str = "user",
    ) -> dict:
        """Execute the pipeline, persisting a ``df_runs`` row, and return a summary."""
        if mode not in ("preview", "dry", "full"):
            raise ValueError(f"Unknown run mode: {mode}")
        nodes = list(definition.get("nodes") or [])
        edges = list(definition.get("edges") or [])

        run_id = await asyncio.to_thread(self._app_db.create_run, pipeline_id, mode, initiated_by)
        await asyncio.to_thread(self._app_db.update_run, run_id, status="running")
        cancel_event = _register_run(run_id)
        ctx = ExecutionContext(
            conn_manager=self._conn_manager,
            app_db=self._app_db,
            run_id=run_id,
            mode=mode,
            sample_size=sample_size,
            on_event=on_event,
            transactional=transactional,
            cancel_event=cancel_event,
        )
        start = time.monotonic()
        ctx.status("running")

        status = "failed"
        error: str | None = None
        outputs: dict[str, dict[str, list[dict]]] = {}
        node_rows: dict[str, dict] = {}
        try:
            try:
                await ctx.log("info", None, f"Run started (mode={mode})")
                order = _topo_sort(nodes, edges)
                outputs, node_rows, _ = await self._execute_dag(
                    ctx, nodes, edges, order, stop_on_error=True
                )
                ctx.check_cancelled()
                await ctx.commit_all()
                status = "partial" if (ctx.has_warn or ctx.skipped) else "ok"
            except RunCancelled:
                status, error = "cancelled", "Run cancelled"
            except asyncio.CancelledError:
                status, error = "cancelled", "Run cancelled"
                raise
            except NodeFailure as exc:
                status, error = "failed", str(exc)
            except Exception as exc:
                status, error = "failed", str(exc)
                await ctx.log("error", None, error)
                logger.exception("Pipeline run %s failed", run_id)
        finally:
            result = await self._finish(
                ctx, run_id, mode, start, status, error, nodes, edges, outputs, node_rows
            )
        return result

    async def _finish(
        self,
        ctx: ExecutionContext,
        run_id: int,
        mode: str,
        start: float,
        status: str,
        error: str | None,
        nodes: list[dict],
        edges: list[dict],
        outputs: dict[str, dict[str, list[dict]]],
        node_rows: dict[str, dict],
    ) -> dict:
        try:
            if status != "ok" and status != "partial":
                await ctx.rollback_all()
            await ctx.close_opened()
        finally:
            _unregister_run(run_id)

        total_rows = self._total_rows(ctx, nodes, edges, outputs)
        duration_ms = round((time.monotonic() - start) * 1000, 2)
        try:
            await asyncio.to_thread(
                self._app_db.update_run,
                run_id,
                status=status,
                finished_at=utc_now_sql(),
                duration_ms=duration_ms,
                total_rows=total_rows,
                error=error,
            )
        except Exception:
            logger.exception("Failed to finalize run %s", run_id)
        level = "error" if status == "failed" else "info"
        summary = f"Run {status} in {duration_ms:.0f} ms ({total_rows} rows)"
        if error:
            summary += f": {error}"
        await ctx.log(level, None, summary)
        ctx.status(status)
        return {
            "run_id": run_id,
            "status": status,
            "mode": mode,
            "duration_ms": duration_ms,
            "total_rows": total_rows,
            "error": error,
            "node_rows": node_rows,
        }

    @staticmethod
    def _total_rows(ctx, nodes, edges, outputs) -> int:
        if any(str(n.get("kind", "")).startswith("snk-") for n in nodes):
            return ctx.sink_rows
        has_outgoing = {e.get("from") for e in edges}
        return sum(
            len(outputs[n["id"]].get("out", []))
            for n in nodes
            if n["id"] in outputs and n["id"] not in has_outgoing
        )

    # ------------------------------------------------------------------ #
    #  Preview / schema (no df_runs rows, no writes)                        #
    # ------------------------------------------------------------------ #

    def _preview_ctx(self, sample_size: int) -> ExecutionContext:
        return ExecutionContext(
            conn_manager=self._conn_manager,
            app_db=self._app_db,
            run_id=None,
            mode="preview",
            sample_size=sample_size,
        )

    async def preview_node(
        self, pipeline_id: int, definition: dict, node_id: str, sample_size: int = 5
    ) -> dict:
        """Run the ancestors of *node_id* in preview mode and return its sample output."""
        nodes = list(definition.get("nodes") or [])
        edges = list(definition.get("edges") or [])
        node_map = {n["id"]: n for n in nodes}
        if node_id not in node_map:
            return {"columns": [], "rows": [], "error": f"Node {node_id} not found"}

        needed: set[str] = set()
        queue: deque[str] = deque([node_id])
        while queue:
            nid = queue.popleft()
            if nid in needed:
                continue
            needed.add(nid)
            queue.extend(e["from"] for e in _incoming(nid, edges) if e.get("from") in node_map)
        sub_nodes = [n for n in nodes if n["id"] in needed]
        sub_edges = [e for e in edges if e.get("from") in needed and e.get("to") in needed]

        ctx = self._preview_ctx(sample_size)
        try:
            order = _topo_sort(sub_nodes, sub_edges)
            outputs, _, errors = await self._execute_dag(
                ctx, sub_nodes, sub_edges, order, stop_on_error=False
            )
        except Exception as exc:
            return {"columns": [], "rows": [], "error": str(exc)}
        finally:
            await ctx.close_opened()

        rows = outputs.get(node_id, {}).get("out", [])[:sample_size]
        return {
            "columns": infer_column_types(rows),
            "rows": [{k: json_safe(v) for k, v in r.items()} for r in rows],
            "error": errors.get(node_id),
        }

    async def infer_schema(self, pipeline_id: int, definition: dict, sample_size: int = 20) -> dict:
        """Run the whole DAG once in preview mode and report each node's columns."""
        nodes = list(definition.get("nodes") or [])
        edges = list(definition.get("edges") or [])
        ctx = self._preview_ctx(sample_size)
        try:
            order = _topo_sort(nodes, edges)
            outputs, _, errors = await self._execute_dag(
                ctx, nodes, edges, order, stop_on_error=False
            )
        except Exception as exc:
            return {n["id"]: {"columns": [], "error": str(exc)} for n in nodes}
        finally:
            await ctx.close_opened()

        return {
            n["id"]: {
                "columns": infer_column_types(outputs.get(n["id"], {}).get("out", [])),
                "error": errors.get(n["id"]),
            }
            for n in nodes
        }

    # ------------------------------------------------------------------ #
    #  Validation                                                          #
    # ------------------------------------------------------------------ #

    async def validate(self, definition: dict) -> list[dict]:
        """Return ``[{node_id, level, message}]`` for structural and config problems."""
        nodes = list(definition.get("nodes") or [])
        edges = list(definition.get("edges") or [])
        issues: list[dict] = []

        def add(node_id, level, message):
            issues.append({"node_id": node_id, "level": level, "message": message})

        node_ids = {n["id"] for n in nodes}
        for edge in edges:
            for end in ("from", "to"):
                if edge.get(end) not in node_ids:
                    add(None, "error", f"Edge references unknown node '{edge.get(end)}'")

        try:
            _topo_sort(nodes, edges)
        except ValueError as exc:
            add(None, "error", str(exc))

        incoming = defaultdict(int)
        outgoing = defaultdict(int)
        for edge in edges:
            outgoing[edge.get("from")] += 1
            incoming[edge.get("to")] += 1

        for node in nodes:
            nid = node["id"]
            kind = str(node.get("kind", ""))
            executor = EXECUTORS.get(kind)
            if executor is None:
                add(nid, "error", f"Unknown node kind: {kind}")
                continue
            for level, message in executor.validate(node):
                add(nid, level, message)

            if kind.startswith("src-") and outgoing[nid] == 0:
                add(nid, "warn", "Source node has no outgoing edge")
            if kind.startswith("snk-") and incoming[nid] == 0:
                add(nid, "warn", "Sink node has no incoming edge")
            if kind == "tf-join":
                if incoming[nid] < 2:
                    add(nid, "error", "tf-join requires two inputs (ports L and R)")
            elif (
                incoming[nid] == 0
                and not kind.startswith(_STANDALONE_PREFIXES)
                and kind not in _STANDALONE_KINDS
            ):
                add(nid, "warn", "Node has no incoming edge")

        return issues
