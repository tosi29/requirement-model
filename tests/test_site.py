"""静的サイトの生成。"""

from __future__ import annotations

import json
import re
from pathlib import Path

from conftest import build, fr, goal, need, qr, source
from reqmodel.cli import main
from reqmodel.findings import FindingList
from reqmodel.definition.nodes import STATUS_RANK
from reqmodel.presentation.render import render_meta
from reqmodel.presentation.site import (
    DEFAULT_REF,
    SITE_ASSETS,
    SITE_SCRIPTS,
    RepoLink,
    app_js,
    asset_srcs,
    build_site,
    site_data,
)
from reqmodel.application.validate import validate_structure
from reqmodel.application.waivers import apply_waivers

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
    assert set(data["meta"]["impact_colors"]) == {
        "selected",
        "upstream",
        "downstream",
        # 無向で辿ったとき (--undirected 相当) の色。上流/下流の区別が付かない。
        "related",
    }
    # 検索ヒットは枠線・輪と衝突しない暈しで示すので、その色も meta から渡す。
    assert data["meta"]["search"]["hit"].startswith("#")
    assert "satisfies" in data["edge_names"]
    # テーブルビューの status 列は辞書順ではなく成熟度で並べる。
    assert data["status_rank"] == {
        "proposed": 0,
        "approved": 1,
        "implemented": 2,
        "verified": 3,
    }
    # ページ側が「このグラフに現れうるエッジ」を CLI と同じ手順で数えるための材料。
    assert data["edge_names_by_type"]["Goal"] == ["has_source", "refines", "motivates"]
    assert data["edge_names_by_type"]["Source"] == ["part_of"]


def test_render_meta_maps_status_to_a_line_style():
    """status は線種だけで区別できること。太さは影響範囲のハイライトに奪われる。"""
    statuses = render_meta()["statuses"]

    # 並びは辞書順ではなく成熟度 (STATUS_RANK)。凡例もこの順に出る。
    assert list(statuses) == ["proposed", "approved", "implemented", "verified"]
    assert set(statuses) == set(STATUS_RANK)

    lines = [entry["border_style"] for entry in statuses.values()]
    assert len(set(lines)) == len(lines)
    # 成熟するほど太くなる (線種の補強)。
    widths = [entry["border_width"] for entry in statuses.values()]
    assert widths == sorted(widths)


#: Cytoscape.js が持つノード形状の多角形 (外形の矩形に内接するよう正規化された座標)。
#: 係数の検算をこの実物と突き合わせるための写しで、出典は cytoscape の
#: ``nodeShapes`` (v3.34.0)。ellipse だけは多角形ではないので別に見る。
_SHAPE_POINTS: dict[str, list[tuple[float, float]]] = {
    "hexagon": [(-0.5, -1), (-1, 0), (-0.5, 1), (0.5, 1), (1, 0), (0.5, -1)],
    "rhomboid": [(-1, -1), (0.333, -1), (1, 1), (-0.333, 1)],
    "tag": [(-1, -1), (0.25, -1), (1, 0), (0.25, 1), (-1, 1)],
    "diamond": [(0, 1), (1, 0), (0, -1), (-1, 0)],
}


def _inside(polygon: list[tuple[float, float]], point: tuple[float, float]) -> bool:
    """凸多角形の内側 (辺の上を含む) か。頂点は反時計回り・時計回りのどちらでもよい。"""
    signs = []
    for index, (x1, y1) in enumerate(polygon):
        x2, y2 = polygon[(index + 1) % len(polygon)]
        cross = (x2 - x1) * (point[1] - y1) - (y2 - y1) * (point[0] - x1)
        if abs(cross) > 1e-9:
            signs.append(cross > 0)
    return len(set(signs)) == 1


def test_shape_fit_keeps_the_label_inside_every_shape():
    """外形の係数は、ラベルが図形からはみ出さないことを幾何で保証する。

    ``width: "label"`` (ラベルの外接矩形) のままだと、六角形・菱形・平行四辺形では
    文字が図形の外に出る。係数は「中央に置いたテキスト矩形の、外形に対する比」の
    上限を決めるもの。余白 (pad) は比を更に小さくするだけなので、余白 0 の極限
    (= 比の上限そのもの) で内側に入るなら、どんな長さのラベルでも内側に入る。
    """
    for type_meta in render_meta()["types"].values():
        shape, fit = type_meta["shape"], type_meta["fit"]
        assert fit["wpad"] > 0 and fit["hpad"] > 0, shape
        # テキスト幅 → ∞ の極限での比。実際はこれより必ず小さい。
        half_w, half_h = 1 / fit["wmul"], 1 / fit["hmul"]

        if shape in _SHAPE_POINTS:
            corners = [
                (sx * half_w, sy * half_h) for sx in (-1, 1) for sy in (-1, 1)
            ]
            for corner in corners:
                assert _inside(_SHAPE_POINTS[shape], corner), (shape, corner)
        elif shape == "ellipse":
            assert half_w**2 + half_h**2 <= 1, shape
        else:
            # 矩形系 (round-rectangle / cut-rectangle / barrel)。隅の落ちや丸みは
            # 比ではなく実寸 (8px / 高さの 5%) なので、余白で吸収する。
            assert shape in ("round-rectangle", "cut-rectangle", "barrel"), shape
            assert (half_w, half_h) == (1.0, 1.0), shape
            assert fit["wpad"] >= 20 and fit["hpad"] >= 14, shape


def test_render_meta_lists_goal_and_need_bands():
    """帯 (枠) にする型は Python 側が唯一の出典。並びは上からの帯の順。"""
    bands = render_meta()["bands"]

    assert [band["type"] for band in bands] == ["Goal", "Need"]
    assert all(band["label"] for band in bands)


def test_site_data_carries_status_of_every_node():
    """status フィルタの材料はノードにそのまま入っている。"""
    graph = build(
        source("S-1"),
        need("N-1", status="approved", has_source=[source("S-1")]),
        fr("FR-1", status="verified", has_source=[source("S-1")]),
    )
    data = site_data(graph, FindingList(), "題名", ["a.py"])
    by_id = {node["id"]: node for node in data["nodes"]}

    assert by_id["N-1"]["status"] == "approved"
    assert by_id["FR-1"]["status"] == "verified"
    assert data["meta"]["statuses"]["verified"]["border_style"] == "double"


def test_page_has_status_filters(tmp_path: Path):
    """status の絞り込みは、既存の種別・エッジと同じ左サイドバーに並ぶ。"""
    index = build_site(chain(), FindingList(), tmp_path)
    html = index.read_text(encoding="utf-8")

    for element_id in ("type-filters", "status-filters", "edge-filters"):
        assert f'id="{element_id}"' in html
    # 表示層が状態を持ち、ロジック層が選択肢を作る。
    assert "statusFilters(DATA)" in html


def test_page_has_impact_depth_and_undirected_controls(tmp_path: Path):
    """影響範囲の深さ・向きは `req explain --depth / --undirected` と同じ操作。"""
    index = build_site(chain(), FindingList(), tmp_path)
    html = index.read_text(encoding="utf-8")

    for element_id in ("depth", "depth-value", "undirected"):
        assert f'id="{element_id}"' in html
    # 色分けもコピー本文も同じ関数から範囲を貰う (片方だけが設定を見ない)。
    assert "impactSets(view, state.selected)" in html


def test_page_links_the_search_box_to_the_graph(tmp_path: Path):
    """検索ヒットは図の上でも見え、↑↓ と Enter で選べる。"""
    index = build_site(chain(), FindingList(), tmp_path)
    html = index.read_text(encoding="utf-8")

    assert 'id="search"' in html
    assert '"ArrowDown"' in html
    # ヒットの印は枠線ではなく暈し (影響範囲の色分けと衝突させない)。
    assert '"underlay-color"' in html


def test_build_site_writes_page_and_raw_outputs(tmp_path: Path):
    graph = chain()
    index = build_site(graph, FindingList(), tmp_path, title="要求グラフ")

    assert index == tmp_path / "index.html"
    for name in ("index.html", "model.json", "graph.mmd", "graph.dot"):
        assert (tmp_path / name).exists()

    html = index.read_text(encoding="utf-8")
    assert "<title>要求グラフ</title>" in html
    for placeholder in ("__TITLE__", "__SCRIPTS__", "__DATA__", "__APP_JS__"):
        assert placeholder not in html
    for asset in SITE_ASSETS:
        assert f'<script src="{asset.url}"></script>' in html
    assert embedded_data(html)["stats"]["nodes"] == 4
    assert json.loads((tmp_path / "model.json").read_text(encoding="utf-8"))["nodes"]


def test_app_js_is_the_concatenation_of_the_source_modules():
    """配布は 1 ファイルのまま、開発は分割したファイルで行う。"""
    js = app_js()

    for name in SITE_SCRIPTS:
        assert f"// --- {name}" in js
    # 連結して 1 つのモジュールにするので、ファイル間の import / export は残らない。
    assert 'from "./site_logic.js"' not in js
    assert not re.search(r"^\s*export\s", js, re.M)
    assert not re.search(r"^\s*import\s", js, re.M)
    # 中身そのものは落とさない。
    assert "function nodeContext(" in js
    assert "function initGraph(" in js
    # site_logic.js が先。site_app.js がその定義を参照するため。
    assert js.index("function nodeContext(") < js.index("function initGraph(")


def test_page_carries_the_app_js_inline(tmp_path: Path):
    index = build_site(chain(), FindingList(), tmp_path)
    html = index.read_text(encoding="utf-8")

    assert '<script type="module">' in html
    assert app_js() in html
    # 外部 JS ファイルは書き出さない (単一ファイルで自己完結する)。
    assert not list(tmp_path.glob("*.js"))


def test_page_has_both_the_graph_and_the_table_view(tmp_path: Path):
    """棚卸し用のテーブルビューは、グラフと同じページのタブとして載る。"""
    index = build_site(chain(), FindingList(), tmp_path)
    html = index.read_text(encoding="utf-8")

    for element_id in ("tab-graph", "tab-table", "graph-frame", "table-frame", "node-table"):
        assert f'id="{element_id}"' in html


def test_page_puts_the_view_state_in_the_url(tmp_path: Path):
    """選択・絞り込みは URL に載る。URL を渡せば相手にも同じ画面が出る。"""
    index = build_site(chain(), FindingList(), tmp_path)
    html = index.read_text(encoding="utf-8")

    # 戻る/進む (popstate) と、URL を手で書き換えたとき (hashchange) の両方から戻す。
    assert '"popstate", applyHash' in html
    assert '"hashchange", applyHash' in html
    assert 'id="copy-link"' in html


def test_definition_text_is_never_treated_as_a_placeholder(tmp_path: Path):
    """定義ファイル由来の文字列がテンプレートの穴として解釈されないこと。"""
    graph = build(fr("FR-1", text="__APP_JS__ と __SCRIPTS__ を出すこと"))
    index = build_site(graph, FindingList(), tmp_path)

    assert embedded_data(index.read_text(encoding="utf-8"))["nodes"][0]["text"] == (
        "__APP_JS__ と __SCRIPTS__ を出すこと"
    )


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


def test_suppressed_findings_are_dropped_but_counted(tmp_path: Path):
    s = source("S-1")
    graph = build(
        s,
        qr(
            "QR-1",
            has_source=[s],
            suppress=[("structure.orphan_qr", "この版では張らない")],
        ),
    )
    waived = apply_waivers(graph, validate_structure(graph))
    index = build_site(graph, waived.findings, tmp_path, suppressed=waived.count)
    data = embedded_data(index.read_text(encoding="utf-8"))

    assert [finding["code"] for finding in data["findings"]] == []
    assert data["stats"]["suppressed"] == 1
    # 抑制した理由はノードに残るので、ページ側で読める。
    assert data["nodes"][0]["suppress"] == [["structure.orphan_qr", "この版では張らない"]]


def test_site_command_applies_waivers(tmp_path: Path, capsys):
    definition = tmp_path / "requirements.py"
    definition.write_text(
        "from reqmodel import QualityRequirement\n"
        'QualityRequirement(id="QR-1", text="5 秒以内とすること",\n'
        '                   acceptance_criteria=["5.0 秒以下"],\n'
        '                   suppress=[("structure.orphan_qr", "この版では張らない"),\n'
        '                             ("structure.missing_source", "源泉は次版で書く")])\n',
        encoding="utf-8",
    )
    output = tmp_path / "site"
    assert main(["site", str(definition), "-o", str(output)]) == 0
    assert "(抑制 2 件)" in capsys.readouterr().err

    data = embedded_data((output / "index.html").read_text(encoding="utf-8"))
    assert data["findings"] == []
    assert data["stats"]["suppressed"] == 2


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
    assert data["stats"]["nodes"] == 21
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


def test_render_meta_carries_the_mermaid_shape_of_every_type():
    """画面から Mermaid を書き出すときの形状も Python 側が唯一の出典。"""
    types = render_meta()["types"]

    assert types["Goal"]["mermaid"] == {"open": "{{", "close": "}}"}
    assert types["Source"]["mermaid"] == {"open": "[(", "close": ")]"}
    assert all(entry["mermaid"]["open"] and entry["mermaid"]["close"] for entry in types.values())


def test_site_data_has_no_repo_link_by_default():
    """`--repo-url` を渡さなければ出所はただの文字列のまま。"""
    assert site_data(chain(), FindingList(), "題名", ["a.py"])["repo"] is None


def test_site_data_carries_the_repo_link():
    """出所 (file:line) から定義ファイルへ飛ぶための情報を渡す。"""
    repo = RepoLink("https://github.com/owner/repo/", ref="abc123")
    data = site_data(chain(), FindingList(), "題名", ["a.py"], repo=repo)

    # URL の末尾の / は落とす (組み立てはページ側の sourceUrl())。
    assert data["repo"] == {"url": "https://github.com/owner/repo", "ref": "abc123"}


def test_site_command_takes_a_repo_url(tmp_path: Path):
    output = tmp_path / "site"
    assert (
        main(
            [
                "site",
                SAMPLE,
                "-o",
                str(output),
                "--repo-url",
                "https://github.com/owner/repo",
                "--repo-ref",
                "v1",
            ]
        )
        == 0
    )

    data = embedded_data((output / "index.html").read_text(encoding="utf-8"))
    assert data["repo"] == {"url": "https://github.com/owner/repo", "ref": "v1"}
    # リンクの組み立てはページ側。出所そのものは今まで通り file:line のまま。
    assert data["nodes"][0]["location"].startswith(SAMPLE + ":")


def test_site_command_defaults_the_repo_ref(tmp_path: Path):
    output = tmp_path / "site"
    assert main(["site", SAMPLE, "-o", str(output), "--repo-url", "https://example.com/r"]) == 0

    data = embedded_data((output / "index.html").read_text(encoding="utf-8"))
    assert data["repo"] == {"url": "https://example.com/r", "ref": DEFAULT_REF}


def test_page_has_the_export_buttons(tmp_path: Path):
    """絞り込んだ図を持ち出す口がテンプレートにある。

    書き出す中身そのものは `mermaidText()` / `graphSvg()` のテスト
    (tests/js/logic.test.mjs) と `test_site_js.py` の CLI 突き合わせが見る。
    """
    index = build_site(chain(), FindingList(), tmp_path)
    html = index.read_text(encoding="utf-8")

    for element_id in ("export-svg", "export-mmd"):
        assert f'id="{element_id}"' in html


def test_page_has_a_theme_toggle(tmp_path: Path):
    """テーマは手で固定できる (次回訪問時の復元は storableHash() のテストが見る)。"""
    index = build_site(chain(), FindingList(), tmp_path)
    html = index.read_text(encoding="utf-8")

    assert 'id="theme"' in html
    # OS 追従 (media query) と手動指定 (data-theme) の両方を CSS が持つ。
    assert "@media (prefers-color-scheme: dark)" in html
    assert ':root[data-theme="dark"]' in html


def test_page_has_a_finding_tab_bar(tmp_path: Path):
    """まとめ方そのものは groupFindings() のテスト (tests/js/logic.test.mjs) が見る。"""
    index = build_site(chain(), FindingList(), tmp_path)
    html = index.read_text(encoding="utf-8")

    assert 'id="finding-tabs"' in html


def test_page_is_operable_from_the_keyboard(tmp_path: Path):
    """図 (canvas) 以外はキーボードで辿れ、フォーカス位置が見える。"""
    index = build_site(chain(), FindingList(), tmp_path)
    html = index.read_text(encoding="utf-8")

    assert ":focus-visible" in html
    # 指摘は div ではなく button なので、キーボードから押せる。
    assert "button.finding" in html
