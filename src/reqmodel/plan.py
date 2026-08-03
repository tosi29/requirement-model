"""構造 diff と変更影響分析 (req plan)。

git 上の前版と現在版を、それぞれ正規化 JSON に落としてから比較する。
Python ファイルの diff ではなくグラフの diff を見るのが目的。
"""

from __future__ import annotations

import subprocess
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Iterable, Sequence

from .core.graph import RequirementGraph, node_to_json_obj
from .loader import LoadResult, load_sources

__all__ = ["GraphDiff", "diff_graphs", "load_revision", "format_plan"]


@dataclass
class FieldChange:
    field: str
    before: Any
    after: Any


@dataclass
class GraphDiff:
    added: list[str] = field(default_factory=list)
    removed: list[str] = field(default_factory=list)
    changed: dict[str, list[FieldChange]] = field(default_factory=dict)
    retyped: dict[str, tuple[str, str]] = field(default_factory=dict)

    @property
    def touched(self) -> list[str]:
        return sorted({*self.added, *self.removed, *self.changed, *self.retyped})

    @property
    def empty(self) -> bool:
        return not self.touched


def diff_graphs(before: RequirementGraph, after: RequirementGraph) -> GraphDiff:
    """ノード単位・フィールド単位の構造 diff。"""
    before_map = {n.id: node_to_json_obj(n) for n in before.ordered_nodes()}
    after_map = {n.id: node_to_json_obj(n) for n in after.ordered_nodes()}

    diff = GraphDiff()
    diff.added = sorted(set(after_map) - set(before_map))
    diff.removed = sorted(set(before_map) - set(after_map))

    for node_id in sorted(set(before_map) & set(after_map)):
        old, new = before_map[node_id], after_map[node_id]
        if old["type"] != new["type"]:
            diff.retyped[node_id] = (old["type"], new["type"])
        changes = [
            FieldChange(field=key, before=old.get(key), after=new.get(key))
            for key in sorted(set(old) | set(new))
            if key != "type" and old.get(key) != new.get(key)
        ]
        if changes:
            diff.changed[node_id] = changes
    return diff


def load_revision(paths: Sequence[Path], rev: str, repo: Path | None = None) -> LoadResult:
    """git の指定リビジョンにある定義ファイルを読み込む (実行はしない)。"""
    root = repo or Path.cwd()
    sources: list[tuple[str, str]] = []
    for path in paths:
        try:
            relative = path.resolve().relative_to(root.resolve())
        except ValueError:
            relative = path
        try:
            text = subprocess.run(
                ["git", "show", f"{rev}:{relative.as_posix()}"],
                cwd=root,
                check=True,
                capture_output=True,
            ).stdout.decode("utf-8")
        except subprocess.CalledProcessError:
            continue  # 前版に存在しないファイル (新規追加) は空扱い
        sources.append((f"{rev}:{relative.as_posix()}", text))
    return load_sources(sources)


def _impact_of(
    graph: RequirementGraph, node_ids: Iterable[str], edge_names: Sequence[str] | None
) -> set[str]:
    impacted: set[str] = set()
    for node_id in node_ids:
        if node_id in graph.nodes:
            impacted |= graph.impact(node_id, edge_names)
    return impacted


def _fmt_value(value: Any) -> str:
    if isinstance(value, list):
        return "[" + ", ".join(_fmt_value(v) for v in value) + "]"
    if isinstance(value, (tuple,)):
        return "(" + ", ".join(_fmt_value(v) for v in value) + ")"
    if value is None:
        return "なし"
    return str(value)


def _label(graph: RequirementGraph, node_id: str) -> str:
    node = graph.nodes.get(node_id)
    if node is None:
        return node_id
    return f"[{type(node).__name__}] {node_id} {node.text}"


def format_plan(
    before: RequirementGraph,
    after: RequirementGraph,
    diff: GraphDiff,
    rev: str,
    edge_names: Sequence[str] | None = None,
) -> str:
    lines = [f"# 構造 diff ({rev} → 作業ツリー)"]
    if diff.empty:
        lines.append("")
        lines.append("グラフに構造上の変更はない。")
        return "\n".join(lines) + "\n"

    lines.append("")
    lines.append(
        f"追加 {len(diff.added)} / 削除 {len(diff.removed)} / "
        f"変更 {len(diff.changed)} / 型変更 {len(diff.retyped)}"
    )
    lines.append("")

    for node_id in diff.added:
        lines.append(f"+ {_label(after, node_id)}")
    for node_id in diff.removed:
        lines.append(f"- {_label(before, node_id)}")
    for node_id, (old_type, new_type) in diff.retyped.items():
        lines.append(f"! {node_id}: 型が {old_type} → {new_type} に変わった")
    for node_id, changes in diff.changed.items():
        lines.append(f"~ {_label(after, node_id)}")
        for change in changes:
            lines.append(
                f"    {change.field}: {_fmt_value(change.before)}"
                f" → {_fmt_value(change.after)}"
            )

    impacted = _impact_of(after, diff.added + list(diff.changed) + list(diff.retyped), edge_names)
    impacted |= _impact_of(before, diff.removed, edge_names)
    impacted -= set(diff.touched)

    lines.append("")
    lines.append(f"## 影響範囲 ({len(impacted)} 件)")
    if edge_names:
        lines.append("エッジ種別フィルタ: " + ", ".join(edge_names))
    if not impacted:
        lines.append("影響を受ける他ノードは無い。")
    else:
        order = {n.id: i for i, n in enumerate(after.ordered_nodes())}
        for node_id in sorted(impacted, key=lambda i: order.get(i, 10**6)):
            graph = after if node_id in after.nodes else before
            lines.append(f"  {_label(graph, node_id)}")

    lines.append("")
    lines.append(
        "詳細な文脈は `req explain " + " ".join(diff.touched[:5]) + "` で出力できる。"
    )
    return "\n".join(lines) + "\n"
