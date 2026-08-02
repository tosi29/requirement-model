"""指摘の抑制 (waiver)。

ノード属性 ``suppress=[("structure.missing_source", "理由")]`` で、そのノードに
出る特定コードの指摘を黙らせる。抑制は「全か無か」の ``--strict`` を実用に
するための仕組みであり、次の 2 点で形骸化を防ぐ。

- 抑制された件数はサマリに残る (消えて無かったことにはならない)
- 対象の指摘が出ていない抑制は ``waiver.stale`` として警告する (陳腐化の検出)

宣言そのものの妥当性 (コードが実在するか・抑制可能か・理由があるか) は
``model.Node._check_suppress`` が層1 で検査する。ここは、出てきた指摘に
抑制を突き合わせるだけを行う。
"""

from __future__ import annotations

from dataclasses import dataclass, field

from .codes import WAIVER_STALE
from .findings import Finding, FindingList
from .graph import RequirementGraph
from .validate import attach_locations

__all__ = ["Suppressed", "WaiverResult", "apply_waivers"]


@dataclass(frozen=True)
class Suppressed:
    """抑制された指摘 1 件と、その理由。"""

    finding: Finding
    reason: str

    def format(self) -> str:
        return f"{self.finding.format()} [抑制: {self.reason}]"


@dataclass
class WaiverResult:
    """抑制を適用した結果。"""

    #: 抑制後に残った指摘 (``waiver.stale`` を含む)。
    findings: FindingList = field(default_factory=FindingList)
    #: 抑制された指摘。
    suppressed: list[Suppressed] = field(default_factory=list)

    @property
    def count(self) -> int:
        return len(self.suppressed)

    def summary(self) -> str:
        """``FindingList.summary()`` に抑制件数を添えたもの。"""
        base = self.findings.summary()
        return f"{base} (抑制 {self.count} 件)" if self.count else base


def apply_waivers(graph: RequirementGraph, findings: FindingList) -> WaiverResult:
    """ノードの ``suppress`` 宣言を指摘に突き合わせる。

    エラーは抑制しない。宣言側でもエラーのコードは書けないようにしてあるが、
    同じコードが将来エラーを出すようになっても素通りしないよう、ここでも見る。
    """
    waivers: dict[tuple[str, str], str] = {
        (node.id, code): reason
        for node in graph.ordered_nodes()
        for code, reason in node.suppress
    }

    result = WaiverResult()
    used: set[tuple[str, str]] = set()

    for finding in findings:
        key = (finding.node_id or "", finding.code)
        reason = waivers.get(key)
        if reason is None:
            result.findings.add(finding)
            continue
        # 対象の指摘は出ている (陳腐化ではない) が、エラーは黙らせない。
        used.add(key)
        if finding.severity == "error":
            result.findings.add(finding)
            continue
        result.suppressed.append(Suppressed(finding=finding, reason=reason))

    for (node_id, code), reason in waivers.items():
        if (node_id, code) in used:
            continue
        result.findings.add(
            Finding(
                severity="warning",
                code=WAIVER_STALE,
                layer=2,
                message=f"{code} の抑制が残っているが、その指摘は出ていない (理由: {reason})",
                node_id=node_id,
            )
        )

    result.findings = attach_locations(graph, result.findings)
    return result
