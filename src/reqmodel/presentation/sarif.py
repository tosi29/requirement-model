"""検証結果を SARIF 2.1.0 に変換する。"""

from __future__ import annotations

from pathlib import Path
from urllib.parse import quote

from ..codes import CHECK_CODES
from ..findings import Finding, FindingList, Severity

__all__ = ["SARIF_SCHEMA", "render_sarif"]

SARIF_SCHEMA = "https://json.schemastore.org/sarif-2.1.0.json"

_LEVELS: dict[Severity, str] = {
    "error": "error",
    "severe": "warning",
    "warning": "warning",
    "info": "note",
}


def _location(value: str) -> tuple[str, int] | None:
    """``file:line`` を SARIF の URI と行番号へ分ける。"""
    path, separator, line = value.rpartition(":")
    if not separator or not path or not line.isdigit() or int(line) < 1:
        return None
    source = Path(path)
    try:
        source = source.resolve().relative_to(Path.cwd().resolve())
        uri = quote(source.as_posix(), safe="/")
    except ValueError:
        uri = source.resolve().as_uri()
    return uri, int(line)


def _result(finding: Finding, rule_index: int) -> dict[str, object]:
    result: dict[str, object] = {
        "ruleId": finding.code,
        "ruleIndex": rule_index,
        "level": _LEVELS[finding.severity],
        "message": {"text": finding.message},
        "properties": {"layer": finding.layer},
    }
    if finding.node_id is not None:
        result["properties"] = {
            "layer": finding.layer,
            "nodeId": finding.node_id,
        }
    if finding.location is not None and (location := _location(finding.location)):
        uri, line = location
        result["locations"] = [
            {
                "physicalLocation": {
                    "artifactLocation": {"uri": uri},
                    "region": {"startLine": line},
                }
            }
        ]
    return result


def render_sarif(findings: FindingList) -> dict[str, object]:
    """指摘を GitHub Code Scanning が受理する SARIF log にする。"""
    ordered = findings.sorted()
    codes = sorted({finding.code for finding in ordered})
    rule_indices = {code: index for index, code in enumerate(codes)}
    rules = [
        {
            "id": code,
            "shortDescription": {"text": CHECK_CODES[code].summary},
        }
        for code in codes
    ]
    return {
        "$schema": SARIF_SCHEMA,
        "version": "2.1.0",
        "runs": [
            {
                "tool": {
                    "driver": {
                        "name": "reqmodel",
                        "informationUri": "https://github.com/tosi29/requirement-model",
                        "rules": rules,
                    }
                },
                "results": [
                    _result(finding, rule_indices[finding.code]) for finding in ordered
                ],
            }
        ],
    }
