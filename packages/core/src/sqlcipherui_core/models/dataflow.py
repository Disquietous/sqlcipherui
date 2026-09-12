"""Data flow pipeline models."""

from __future__ import annotations

from enum import StrEnum
from typing import Any

from pydantic import BaseModel, Field


class RunMode(StrEnum):
    preview = "preview"
    dry = "dry"
    full = "full"


class RunStatus(StrEnum):
    pending = "pending"
    running = "running"
    ok = "ok"
    failed = "failed"
    partial = "partial"
    cancelled = "cancelled"


class NodeConfig(BaseModel):
    id: str
    kind: str
    x: float
    y: float
    summary: str = ""
    config: dict[str, Any] = Field(default_factory=dict)
    in_rows: int | None = None
    out_rows: int | None = None
    warn: bool = False
    encrypted: bool = False


class EdgeConfig(BaseModel):
    model_config = {"populate_by_name": True}

    from_node: str = Field(alias="from")
    to_node: str = Field(alias="to")
    port: str | None = None
    from_port: str = Field(default="out", alias="fromPort")
    cross_db: bool = Field(default=False, alias="crossDb")
    rows: int = 0


class PipelineDefinition(BaseModel):
    nodes: list[NodeConfig] = Field(default_factory=list)
    edges: list[EdgeConfig] = Field(default_factory=list)

    def model_dump(self, **kw):
        kw.setdefault("by_alias", True)
        return super().model_dump(**kw)


class Pipeline(BaseModel):
    id: int | None = None
    name: str
    description: str = ""
    starred: bool = False
    tags: list[str] = Field(default_factory=list)
    definition: PipelineDefinition = Field(default_factory=PipelineDefinition)
    schedule: str = ""
    schedule_enabled: bool = False
    last_scheduled_at: str | None = None
    created_at: str | None = None
    updated_at: str | None = None


class PipelineCreate(BaseModel):
    name: str
    description: str = ""
    tags: list[str] = Field(default_factory=list)
    definition: PipelineDefinition = Field(default_factory=PipelineDefinition)


class PipelineUpdate(BaseModel):
    name: str | None = None
    description: str | None = None
    starred: bool | None = None
    tags: list[str] | None = None
    definition: PipelineDefinition | None = None
    schedule: str | None = None
    schedule_enabled: bool | None = None


class RunSummary(BaseModel):
    id: int
    pipeline_id: int
    mode: RunMode
    status: RunStatus
    started_at: str
    finished_at: str | None = None
    duration_ms: float = 0
    total_rows: int = 0
    error: str | None = None
    initiated_by: str = "user"


class RunResult(BaseModel):
    """Return value of ``PipelineExecutor.run``."""

    run_id: int
    status: RunStatus
    mode: RunMode
    duration_ms: float = 0
    total_rows: int = 0
    error: str | None = None
    node_rows: dict[str, dict[str, int]] = Field(default_factory=dict)


class PipelineSummary(BaseModel):
    id: int
    name: str
    description: str
    starred: bool
    tags: list[str]
    node_count: int
    encrypted: bool
    last_run: RunSummary | None = None
    created_at: str
    updated_at: str


class DataFlowConnection(BaseModel):
    id: int | None = None
    name: str
    kind: str
    encrypted: bool = False
    path: str
    status: str = "closed"


class DataFlowConnectionCreate(BaseModel):
    name: str
    kind: str = "sqlite"
    encrypted: bool = False
    path: str


class DataFlowConnectionUpdate(BaseModel):
    name: str | None = None
    kind: str | None = None
    encrypted: bool | None = None
    path: str | None = None


class RunEvent(BaseModel):
    id: int | None = None
    run_id: int
    timestamp: str
    level: str
    node_id: str | None = None
    message: str


class RunRequest(BaseModel):
    mode: RunMode = RunMode.preview
    transactional: bool = True
    streaming_counters: bool = True


class NodePreviewRequest(BaseModel):
    pipeline_id: int | None = None
    node_id: str
    sample_size: int = 5


class SchemaInferRequest(BaseModel):
    sample_size: int = 20


class ColumnInfo(BaseModel):
    name: str
    type: str = "TEXT"


class NodePreview(BaseModel):
    columns: list[ColumnInfo] = Field(default_factory=list)
    rows: list[dict[str, Any]] = Field(default_factory=list)
    error: str | None = None


class ValidationIssue(BaseModel):
    node_id: str | None = None
    level: str = "warn"
    message: str
