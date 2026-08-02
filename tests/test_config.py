"""プロジェクト設定 (reqmodel.toml / [tool.reqmodel]) の受け入れ確認。"""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from pydantic import ValidationError

from conftest import build, fr, need, source
from reqmodel import Need, load_paths
from reqmodel.cli import main
from reqmodel.config import (
    Config,
    ConfigError,
    find_config_file,
    load_config,
    parse_config,
    use_config,
)
from reqmodel.validate import (
    validate_naming,
    validate_semantics_lexical,
    validate_structure,
)

HEADER = "from reqmodel import FunctionalRequirement, Need\n"


def write(tmp_path: Path, body: str, name: str = "reqmodel.toml") -> Path:
    path = tmp_path / name
    path.write_text(body, encoding="utf-8")
    return path


def severities(findings, code: str) -> list[str]:
    return [f.severity for f in findings if f.code == code]


# ---------------------------------------------------------------------------
# 後方互換: 設定ファイルが無ければ従来と同一
# ---------------------------------------------------------------------------


def test_no_config_file_means_default_behaviour(tmp_path: Path):
    config = load_config(start=tmp_path)
    assert config == Config()
    assert config.source is None
    assert config.high_priority_threshold == 2
    assert config.suffix.need == ("たい",)
    assert config.lexicon_terms() == Config().lexicon_terms()


def test_no_config_flag_skips_discovery(tmp_path: Path):
    write(tmp_path, "high_priority_threshold = 9\n")
    assert load_config(start=tmp_path).high_priority_threshold == 9
    assert load_config(start=tmp_path, enabled=False).high_priority_threshold == 2


# ---------------------------------------------------------------------------
# 探索
# ---------------------------------------------------------------------------


def test_discovery_walks_up_to_parent_directories(tmp_path: Path):
    config_path = write(tmp_path, "high_priority_threshold = 4\n")
    nested = tmp_path / "a" / "b"
    nested.mkdir(parents=True)
    assert find_config_file(nested) == config_path
    assert load_config(start=nested).high_priority_threshold == 4


def test_pyproject_section_is_used(tmp_path: Path):
    write(
        tmp_path,
        "[project]\nname = 'x'\n\n[tool.reqmodel]\nhigh_priority_threshold = 5\n",
        name="pyproject.toml",
    )
    config = load_config(start=tmp_path)
    assert config.high_priority_threshold == 5
    assert config.source is not None and config.source.name == "pyproject.toml"


def test_pyproject_without_section_is_not_a_config(tmp_path: Path):
    write(tmp_path, "[project]\nname = 'x'\n", name="pyproject.toml")
    assert find_config_file(tmp_path) is None


def test_reqmodel_toml_wins_over_pyproject(tmp_path: Path):
    expected = write(tmp_path, "high_priority_threshold = 1\n")
    write(tmp_path, "[tool.reqmodel]\nhigh_priority_threshold = 5\n", "pyproject.toml")
    assert find_config_file(tmp_path) == expected


def test_explicit_path_must_exist(tmp_path: Path):
    with pytest.raises(ConfigError, match="存在しない"):
        load_config(tmp_path / "nope.toml")


# ---------------------------------------------------------------------------
# 曖昧語の追加・除外
# ---------------------------------------------------------------------------


def test_lexicon_extend_and_exclude():
    config = parse_config(
        {
            "lexicon": {
                "exclude": ["適切"],
                "extend": [{"label": "そのうち", "advice": "期限を数値で書くこと"}],
            }
        }
    )
    graph = build(need("N-1", text="適切にそのうち精算したい"))
    findings = validate_semantics_lexical(graph, config)
    messages = [f.message for f in findings]
    assert any("そのうち" in m for m in messages)
    assert not any("適切" in m for m in messages)


def test_lexicon_extend_accepts_a_pattern():
    config = parse_config(
        {
            "lexicon": {
                "extend": [
                    {
                        "label": "等",
                        "advice": "列挙を確定させること",
                        "pattern": "(?<!同)等",
                    }
                ],
                "exclude": ["等"],
            }
        }
    )
    labels = [t.label for t in config.lexicon_terms()]
    assert labels.count("等") == 1
    # 自前の pattern が効き、「同等」では鳴らず「等」単独では鳴る。
    quiet = build(need("N-1", text="同等の条件で精算したい"))
    assert list(validate_semantics_lexical(quiet, config)) == []
    noisy = build(need("N-1", text="領収書等を添付したい"))
    assert [f.code for f in validate_semantics_lexical(noisy, config)] == [
        "semantics.ambiguous_term"
    ]


def test_excluding_an_unknown_term_is_an_error():
    with pytest.raises(ConfigError, match="辞書に無い語"):
        parse_config({"lexicon": {"exclude": ["存在しない語"]}})


def test_broken_pattern_is_an_error():
    with pytest.raises(ConfigError, match="正規表現"):
        parse_config(
            {"lexicon": {"extend": [{"label": "x", "advice": "y", "pattern": "([a"}]}}
        )


# ---------------------------------------------------------------------------
# チェックの重大度上書き・無効化
# ---------------------------------------------------------------------------


def test_severity_override_and_disable():
    graph = build(need("N-1"), source("S-1"))
    default = validate_structure(graph)
    assert severities(default, "structure.orphan_need") == ["warning"]
    assert severities(default, "structure.unused_source") == ["info"]

    config = parse_config(
        {
            "checks": {
                "structure.orphan_need": "error",
                "structure.unused_source": "off",
            }
        }
    )
    overridden = validate_structure(graph, config)
    assert severities(overridden, "structure.orphan_need") == ["error"]
    assert severities(overridden, "structure.unused_source") == []


def test_override_applies_to_lexicon_findings():
    graph = build(need("N-1", text="適切に精算したい"))
    config = parse_config({"checks": {"semantics.ambiguous_term": "off"}})
    assert list(validate_semantics_lexical(graph, config)) == []


def test_override_applies_to_layer0_and_layer1_findings(tmp_path: Path):
    definition = tmp_path / "requirements.py"
    definition.write_text(HEADER + "x = 1 + 1\n", encoding="utf-8")
    config = parse_config({"checks": {"declarative.forbidden": "warning"}})
    with use_config(config):
        result = load_paths([definition])
    assert severities(result.findings, "declarative.forbidden") == ["warning"]


def test_unknown_severity_is_an_error():
    with pytest.raises(ConfigError, match="いずれか"):
        parse_config({"checks": {"structure.orphan_need": "critical"}})


# ---------------------------------------------------------------------------
# 高優先度しきい値
# ---------------------------------------------------------------------------


def test_high_priority_threshold_changes_conflict_severity():
    graph = build(
        fr("FR-1", priority=3, conflicts=["FR-2"]),
        fr("FR-2", priority=3),
    )
    assert severities(validate_structure(graph), "structure.conflict_unresolved") == [
        "warning"
    ]
    config = parse_config({"high_priority_threshold": 3})
    assert severities(
        validate_structure(graph, config), "structure.conflict_unresolved"
    ) == ["severe"]


# ---------------------------------------------------------------------------
# 語尾規則
# ---------------------------------------------------------------------------


def test_strict_suffix_restores_the_specification_wording():
    config = parse_config({"suffix": {"strict": True}})
    with use_config(config):
        Need(id="N-1", text="早く精算したい")
        with pytest.raises(ValidationError, match="「〜したい」"):
            Need(id="N-2", text="承認待ちに気づきたい")


def test_suffix_can_be_listed_explicitly():
    config = parse_config({"suffix": {"need": ["たい", "ほしい"]}})
    with use_config(config):
        Need(id="N-1", text="承認結果を通知してほしい")


def test_empty_suffix_list_disables_the_check():
    config = parse_config({"suffix": {"need": []}})
    with use_config(config):
        Need(id="N-1", text="早く精算する")


def test_suffix_rule_applies_during_load(tmp_path: Path):
    definition = tmp_path / "requirements.py"
    definition.write_text(
        HEADER + 'f = FunctionalRequirement(id="FR-1", text="領収書を読み取ること")\n',
        encoding="utf-8",
    )
    assert load_paths([definition]).ok
    with use_config(parse_config({"suffix": {"strict": True}})):
        result = load_paths([definition])
    assert not result.ok
    assert "「〜すること」" in next(iter(result.findings)).message


# ---------------------------------------------------------------------------
# ID 命名規則
# ---------------------------------------------------------------------------


def test_id_prefix_check_only_runs_when_configured():
    graph = build(need("REQ-1"), fr("FR-1"))
    assert list(validate_naming(graph)) == []

    config = parse_config({"id_prefix": {"Need": "N-", "FR": "FR-"}})
    findings = list(validate_naming(graph, config))
    assert [(f.code, f.node_id) for f in findings] == [("naming.id_prefix", "REQ-1")]


def test_id_prefix_rejects_unknown_type():
    with pytest.raises(ConfigError, match="未知のノード型"):
        parse_config({"id_prefix": {"Requirement": "R-"}})


# ---------------------------------------------------------------------------
# 記述の誤り
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "section",
    [
        {"unknown": 1},
        {"lexicon": {"exclud": []}},
        {"suffix": {"strict": "yes"}},
        {"high_priority_threshold": "2"},
        {"id_prefix": {"Need": ""}},
    ],
)
def test_malformed_settings_are_rejected(section):
    with pytest.raises(ConfigError):
        parse_config(section)


def test_broken_toml_is_reported(tmp_path: Path):
    path = write(tmp_path, "high_priority_threshold = \n")
    with pytest.raises(ConfigError, match="TOML"):
        load_config(path)


# ---------------------------------------------------------------------------
# CLI からの利用
# ---------------------------------------------------------------------------


def _definition(tmp_path: Path) -> Path:
    definition = tmp_path / "requirements.py"
    definition.write_text(
        HEADER + 'n = Need(id="N-1", text="適切に精算したい")\n', encoding="utf-8"
    )
    return definition


def test_cli_discovers_config_from_cwd(tmp_path: Path, capsys, monkeypatch):
    _definition(tmp_path)
    write(tmp_path, '[checks]\n"semantics.ambiguous_term" = "off"\n')
    monkeypatch.chdir(tmp_path)

    assert main(["validate"]) == 0
    out = capsys.readouterr().out
    assert "semantics.ambiguous_term" not in out
    assert "設定: " in out

    assert main(["validate", "--no-config"]) == 0
    assert "semantics.ambiguous_term" in capsys.readouterr().out


def test_cli_config_option_points_at_a_file(tmp_path: Path, capsys):
    definition = _definition(tmp_path)
    config_path = write(
        tmp_path, '[checks]\n"semantics.ambiguous_term" = "error"\n', "custom.toml"
    )
    assert main(["validate", str(definition), "--config", str(config_path)]) == 1
    assert "[ERROR ] L1 semantics.ambiguous_term" in capsys.readouterr().out


def test_cli_reports_config_in_json(tmp_path: Path, capsys):
    definition = _definition(tmp_path)
    config_path = write(tmp_path, "high_priority_threshold = 3\n")
    main(["validate", str(definition), "--config", str(config_path), "--json"])
    payload = json.loads(capsys.readouterr().out)
    assert payload["config"] == str(config_path)


def test_cli_rejects_a_broken_config(tmp_path: Path, capsys):
    definition = _definition(tmp_path)
    config_path = write(tmp_path, "[checks]\nstructure.orphan_need = 'nope'\n")
    assert main(["validate", str(definition), "--config", str(config_path)]) == 2
    assert "いずれか" in capsys.readouterr().err


def test_cli_site_applies_config(tmp_path: Path):
    definition = _definition(tmp_path)
    config_path = write(tmp_path, '[id_prefix]\nNeed = "NEED-"\n')
    out = tmp_path / "site"
    assert (
        main(["site", str(definition), "-o", str(out), "--config", str(config_path)])
        == 0
    )
    html = (out / "index.html").read_text(encoding="utf-8")
    assert "naming.id_prefix" in html
    assert json.loads((out / "model.json").read_text(encoding="utf-8"))["nodes"]
