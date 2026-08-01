"""検証結果の共通表現。"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Iterable, Literal

__all__ = ["Severity", "Finding", "FindingList", "SEVERITY_ORDER"]

#: error: 構造が壊れている / severe: 重大警告 / warning: 要確認 / info: 参考情報
Severity = Literal["error", "severe", "warning", "info"]

SEVERITY_ORDER: dict[str, int] = {"error": 0, "severe": 1, "warning": 2, "info": 3}

_LABEL = {
    "error": "ERROR ",
    "severe": "SEVERE",
    "warning": "WARN  ",
    "info": "INFO  ",
}


@dataclass(frozen=True)
class Finding:
    """検証で見つかった 1 件の指摘。"""

    severity: Severity
    #: 機械可読なコード。例: "structure.edge_type", "syntax.suffix"
    code: str
    message: str
    #: 検証の層 (0: 宣言性 / 1: 構文 / 2: 構造)
    layer: int
    node_id: str | None = None
    location: str | None = None

    def format(self) -> str:
        where = " ".join(part for part in (self.location, self.node_id) if part)
        prefix = f"[{_LABEL[self.severity]}] L{self.layer} {self.code}"
        if where:
            return f"{prefix} ({where}): {self.message}"
        return f"{prefix}: {self.message}"

    def to_dict(self) -> dict[str, Any]:
        return {
            "severity": self.severity,
            "code": self.code,
            "layer": self.layer,
            "message": self.message,
            "node_id": self.node_id,
            "location": self.location,
        }


@dataclass
class FindingList:
    """指摘の集合。重大度ごとの集計と判定を提供する。"""

    items: list[Finding] = field(default_factory=list)

    def add(self, finding: Finding) -> None:
        self.items.append(finding)

    def extend(self, findings: Iterable[Finding]) -> None:
        self.items.extend(findings)

    def sorted(self) -> list[Finding]:
        return sorted(
            self.items,
            key=lambda f: (SEVERITY_ORDER[f.severity], f.code, f.node_id or ""),
        )

    def count(self, severity: Severity) -> int:
        return sum(1 for f in self.items if f.severity == severity)

    @property
    def has_error(self) -> bool:
        return self.count("error") > 0

    @property
    def has_warning(self) -> bool:
        return any(f.severity in ("severe", "warning") for f in self.items)

    def summary(self) -> str:
        return (
            f"error={self.count('error')} "
            f"severe={self.count('severe')} "
            f"warning={self.count('warning')} "
            f"info={self.count('info')}"
        )

    def __len__(self) -> int:
        return len(self.items)

    def __iter__(self):
        return iter(self.items)
