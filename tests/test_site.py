"""静的サイトの生成。"""

from __future__ import annotations

import json
import re
from pathlib import Path

from conftest import build, fr, goal, need, qr, source
from reqmodel.cli import main
from reqmodel.findings import FindingList
from reqmodel.site import SITE_ASSETS, asset_srcs, build_site, site_data
from reqmodel.validate import validate_structure

SAMPLE = str(Path(__file__).resolve().parents[1] / "examples" / "sample.py")


def chain():
    s = source("S-1")
    n = need("N-1", has_source=[s])
    g = goal("G-1", motivates=[n], has_source=[s])
    f = fr("FR-1", satisfies=[n], has_source=[s])
    return build(s, n, g, f)


def embedded_data(html: str) -> dict:
    match = re.search(
        r'<script type="application/json" id="model-data">(.*?)</script>', html, re.S
    )
    assert match, "埋め込みデータが見つからない"
    return json.loads(match.group(1))


def test_site_data_contains_graph_findings_and_render_meta():
    graph = chain()
    data = site_data(graph, validate_structure(graph), "題名", ["a.py"])

    assert data["title"] == "題名"
    assert data["generated_from"] == ["a.py"]
    assert {n["id"] for n in data["nodes"]} == {"S-1", "N-1", "G-1", "FR-1"}
    assert {"source": "FR-1", "name": "satisfies", "target": "N-1"} in data["edges"]
    assert data["stats"]["nodes"] == 4
    assert data["meta"]["types"]["Goal"]["shape"] == "hexagon"
    assert data["meta"]["types"]["Goal"]["fill"].startswith("#")
    assert "has_source" in data["meta"]["dashed_edges"]
    assert set(data["meta"]["impact_colors"]) == {"selected", "upstream", "downstream"}
    assert "satisfies" in data["edge_names"]


def test_build_site_writes_page_and_raw_outputs(tmp_path: Path):
    graph = chain()
    index = build_site(graph, FindingList(), tmp_path, title="要求グラフ")

    assert index == tmp_path / "index.html"
    for name in ("index.html", "model.json", "graph.mmd", "graph.dot"):
        assert (tmp_path / name).exists()

    html = index.read_text(encoding="utf-8")
    assert "<title>要求グラフ</title>" in html
    for placeholder in ("__TITLE__", "__SCRIPTS__", "__DATA__"):
        assert placeholder not in html
    for asset in SITE_ASSETS:
        assert f'<script src="{asset.url}"></script>' in html
    assert embedded_data(html)["stats"]["nodes"] == 4
    assert json.loads((tmp_path / "model.json").read_text(encoding="utf-8"))["nodes"]


def test_embedded_json_cannot_break_out_of_the_script_tag(tmp_path: Path):
    graph = build(fr("FR-1", text="</script><script>alert(1)</script> を出すこと"))
    index = build_site(graph, FindingList(), tmp_path)
    html = index.read_text(encoding="utf-8")

    assert "</script><script>alert(1)" not in html
    assert embedded_data(html)["nodes"][0]["text"].startswith("</script>")


def test_findings_are_embedded(tmp_path: Path):
    graph = build(qr("QR-1"))  # qualifies の張り先が無い
    index = build_site(graph, validate_structure(graph), tmp_path)
    data = embedded_data(index.read_text(encoding="utf-8"))

    codes = {finding["code"] for finding in data["findings"]}
    assert "structure.orphan_qr" in codes
    assert data["stats"]["findings"]["warning"] >= 1


def test_libraries_can_be_pointed_at_local_copies(tmp_path: Path):
    index = build_site(chain(), FindingList(), tmp_path, scripts=asset_srcs(local=True))
    html = index.read_text(encoding="utf-8")

    assert "cdn.jsdelivr.net" not in html
    for asset in SITE_ASSETS:
        assert f'<script src="{asset.file}"></script>' in html


def test_site_command_can_bundle_libraries_locally(tmp_path: Path):
    output = tmp_path / "site"
    assert main(["site", SAMPLE, "-o", str(output), "--assets", "local"]) == 0

    html = (output / "index.html").read_text(encoding="utf-8")
    assert "cdn.jsdelivr.net" not in html
    assert f'<script src="{SITE_ASSETS[0].file}"></script>' in html


def test_site_command(tmp_path: Path, capsys):
    output = tmp_path / "site"
    assert main(["site", SAMPLE, "-o", str(output), "--title", "サンプル"]) == 0
    assert "生成した" in capsys.readouterr().err

    html = (output / "index.html").read_text(encoding="utf-8")
    data = embedded_data(html)
    assert data["stats"]["nodes"] == 20
    assert data["generated_from"] == [SAMPLE]
    assert data["findings"] == []

    model = json.loads((output / "model.json").read_text(encoding="utf-8"))
    assert all(re.fullmatch(rf"{re.escape(SAMPLE)}:\d+", n["location"]) for n in model["nodes"])
    assert [n["location"] for n in data["nodes"]] == [
        n["location"] for n in model["nodes"]
    ]


def test_site_command_refuses_broken_definitions(tmp_path: Path):
    definition = tmp_path / "requirements.py"
    definition.write_text("from reqmodel import Need\nx = 1 + 1\n", encoding="utf-8")
    assert main(["site", str(definition), "-o", str(tmp_path / "site")]) == 1
    assert not (tmp_path / "site").exists()
