"""テスト用の共通ヘルパ。"""

from __future__ import annotations

from reqmodel import (
    Constraint,
    FunctionalRequirement,
    Goal,
    Need,
    QualityRequirement,
    RequirementGraph,
    Source,
    System,
)


def source(node_id: str = "S-1", **kwargs) -> Source:
    #: 他の helper と同じく、呼び手が上書きできるようにする。
    kwargs.setdefault("text", "経理部長")
    kwargs.setdefault("kind", "stakeholder")
    return Source(id=node_id, **kwargs)


def need(node_id: str = "N-1", **kwargs) -> Need:
    kwargs.setdefault("text", "早く精算したい")
    return Need(id=node_id, **kwargs)


def goal(node_id: str = "G-1", **kwargs) -> Goal:
    kwargs.setdefault("text", "精算工数を半減する")
    return Goal(id=node_id, **kwargs)


def fr(node_id: str = "FR-1", **kwargs) -> FunctionalRequirement:
    kwargs.setdefault("text", "領収書を読み取ること")
    kwargs.setdefault("acceptance_criteria", ["読み取り率 95% 以上"])
    return FunctionalRequirement(id=node_id, **kwargs)


def qr(node_id: str = "QR-1", **kwargs) -> QualityRequirement:
    kwargs.setdefault("text", "応答を 5 秒以内とすること")
    kwargs.setdefault("acceptance_criteria", ["95 パーセンタイルで 5.0 秒以下"])
    return QualityRequirement(id=node_id, **kwargs)


def constraint(node_id: str = "C-1", **kwargs) -> Constraint:
    kwargs.setdefault("text", "国内リージョンにのみ保存すること")
    return Constraint(id=node_id, **kwargs)


def system(node_id: str = "SYS", **kwargs) -> System:
    kwargs.setdefault("text", "経費精算システム")
    return System(id=node_id, **kwargs)


def build(*nodes) -> RequirementGraph:
    return RequirementGraph(nodes)


def codes(findings) -> set[str]:
    return {f.code for f in findings}


def codes_for(findings, node_id: str) -> set[str]:
    return {f.code for f in findings if f.node_id == node_id}
