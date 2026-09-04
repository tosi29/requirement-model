"""PR レビュー向けの構造 diff 表示。"""

from __future__ import annotations

from typing import Any, Sequence

from ..application.plan import GraphDiff, impacted_nodes
from ..core.graph import RequirementGraph

__all__ = ["render_plan_markdown"]


def _cell(value: Any) -> str:
    if value is None:
        return "なし"
    if isinstance(value, (list, tuple)):
        return ", ".join(str(item) for item in value) or "なし"
    return str(value).replace("|", "\\|").replace("\n", " ")


def _node_label(before: RequirementGraph, after: RequirementGraph, node_id: str) -> str:
    node = after.nodes.get(node_id) or before.nodes[node_id]
    return f"{node.id}<br/>{node.text}".replace('"', "#quot;")


def _mermaid(
    before: RequirementGraph,
    after: RequirementGraph,
    diff: GraphDiff,
    impacted: set[str],
) -> str:
    shown = set(diff.touched) | impacted
    ordered = [
        node.id
        for graph in (after, before)
        for node in graph.ordered_nodes()
        if node.id in shown
    ]
    ordered = list(dict.fromkeys(ordered))
    ids = {node_id: f"n{index}" for index, node_id in enumerate(ordered, 1)}
    lines = ["flowchart TD"]
    for node_id in ordered:
        lines.append(f'    {ids[node_id]}["{_node_label(before, after, node_id)}"]')
    seen_edges: set[tuple[str, str, str]] = set()
    for graph in (after, before):
        for edge in graph.edges:
            key = (edge.source, edge.name, edge.target)
            if edge.source in shown and edge.target in shown and key not in seen_edges:
                seen_edges.add(key)
                lines.append(
                    f"    {ids[edge.source]} -->|{edge.name}| {ids[edge.target]}"
                )
    lines.extend(
        [
            "    classDef added fill:#dafbe1,stroke:#1a7f37,color:#24292f",
            "    classDef removed fill:#ffebe9,stroke:#cf222e,color:#24292f",
            "    classDef impacted fill:#fff8c5,stroke:#9a6700,color:#24292f",
            "    classDef changed fill:#ddf4ff,stroke:#0969da,color:#24292f",
        ]
    )
    classes = {
        "added": set(diff.added),
        "removed": set(diff.removed),
        "changed": set(diff.changed) | set(diff.retyped),
        "impacted": impacted,
    }
    for name, node_ids in classes.items():
        selected = [ids[node_id] for node_id in ordered if node_id in node_ids]
        if selected:
            lines.append(f"    class {','.join(selected)} {name}")
    return "\n".join(lines)


def render_plan_markdown(
    before: RequirementGraph,
    after: RequirementGraph,
    diff: GraphDiff,
    rev: str,
    edge_names: Sequence[str] | None = None,
) -> str:
    """構造 diff と影響範囲を GitHub Markdown として描画する。"""
    if diff.empty:
        return f"## 要求変更プラン ({rev} → 作業ツリー)\n\n構造上の変更はありません。\n"

    impacted = impacted_nodes(before, after, diff, edge_names)
    lines = [
        f"## 要求変更プラン ({rev} → 作業ツリー)",
        "",
        f"> 追加 **{len(diff.added)}** / 削除 **{len(diff.removed)}** / "
        f"変更 **{len(diff.changed)}** / 型変更 **{len(diff.retyped)}** / "
        f"影響 **{len(impacted)}**",
        "",
        "```mermaid",
        _mermaid(before, after, diff, impacted),
        "```",
        "",
        "| 種別 | ノード | フィールド | 変更前 | 変更後 |",
        "|---|---|---|---|---|",
    ]
    for node_id in diff.added:
        lines.append(f"| 🟢 追加 | `{node_id}` | — | — | {_cell(after.nodes[node_id].text)} |")
    for node_id in diff.removed:
        lines.append(f"| 🔴 削除 | `{node_id}` | — | {_cell(before.nodes[node_id].text)} | — |")
    for node_id, (old, new) in diff.retyped.items():
        lines.append(f"| 🔵 型変更 | `{node_id}` | type | {old} | {new} |")
    for node_id, changes in diff.changed.items():
        for change in changes:
            lines.append(
                f"| 🔵 変更 | `{node_id}` | `{change.field}` | "
                f"{_cell(change.before)} | {_cell(change.after)} |"
            )
    lines.extend(["", "### 影響範囲"])
    if edge_names:
        lines.append(f"\n対象エッジ: `{', '.join(edge_names)}`")
    if impacted:
        for node_id in sorted(impacted):
            node = after.nodes.get(node_id) or before.nodes[node_id]
            lines.append(f"- 🟡 `{node_id}` — {node.text} (`{node.status}`)")
    else:
        lines.append("\n影響を受ける他ノードはありません。")
    return "\n".join(lines) + "\n"
