"""プロジェクト設定 (``reqmodel.toml`` / ``pyproject.toml`` の ``[tool.reqmodel]``)。

ruff や mypy と同じく、リポジトリルートに置いた設定ファイルで挙動を変える層。
設定ファイル自体が Git 管理されるので、「テキストで diff が取れる」という
本ツールの設計思想と整合する。

設定できるのは次の 5 つ。**設定ファイルが無ければ従来と完全に同一の挙動**になる。

- ``[checks]``      : チェックコード単位の重大度上書き / 無効化
- ``[lexicon]``     : 曖昧語の追加・除外
- ``[suffix]``      : Need / FR の語尾規則
- ``[id_prefix]``   : 型ごとの ID 接頭辞
- ``high_priority_threshold`` : 高優先度とみなす priority のしきい値

設定は「読み込み中・検証中に有効な 1 つの設定」として ContextVar で持ち回る。
Pydantic の field_validator (語尾規則) からも参照する必要があり、引数で
配れないため。ライブラリとして使う場合は ``use_config()`` で囲む。
"""

from __future__ import annotations

import tomllib
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass, field, replace
from pathlib import Path
from typing import Any, Iterator, Mapping

from .findings import SEVERITY_ORDER, FindingList, Severity
from .lexicon import AMBIGUOUS_TERMS, AmbiguousTerm

__all__ = [
    "Config",
    "ConfigError",
    "LexiconConfig",
    "SuffixConfig",
    "CONFIG_FILENAME",
    "PYPROJECT_FILENAME",
    "DEFAULT_HIGH_PRIORITY_THRESHOLD",
    "DEFAULT_NEED_SUFFIXES",
    "DEFAULT_FR_SUFFIXES",
    "OFF",
    "find_config_file",
    "load_config",
    "parse_config",
    "active_config",
    "use_config",
]

CONFIG_FILENAME = "reqmodel.toml"
PYPROJECT_FILENAME = "pyproject.toml"

#: priority は「小さいほど高優先」。この値以下を高優先度として扱う。
DEFAULT_HIGH_PRIORITY_THRESHOLD = 2

#: Need の語尾。指示書の「〜したい」を、サ変以外の願望形も拾えるよう緩めたもの。
DEFAULT_NEED_SUFFIXES: tuple[str, ...] = ("たい",)
#: FR の語尾。同様に「〜すること」を緩めたもの。
DEFAULT_FR_SUFFIXES: tuple[str, ...] = ("こと",)

#: 指示書どおりに厳格化したときの語尾 (``[suffix] strict = true``)。
STRICT_NEED_SUFFIXES: tuple[str, ...] = ("したい",)
STRICT_FR_SUFFIXES: tuple[str, ...] = ("すること",)

#: ``[checks]`` でチェックを無効にするときの値。
OFF = "off"


class ConfigError(ValueError):
    """設定ファイルの記述が不正。CLI では使い方の誤り (終了コード 2) として扱う。"""


# ---------------------------------------------------------------------------
# 設定の構造
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class LexiconConfig:
    """曖昧語辞書の上書き。"""

    #: 追加する曖昧語。
    extend: tuple[AmbiguousTerm, ...] = ()
    #: 組み込み辞書から外す語の label。
    exclude: frozenset[str] = frozenset()

    def terms(self) -> tuple[AmbiguousTerm, ...]:
        """実際に検出に使う曖昧語の並び (組み込み − 除外 + 追加)。

        exclude が効くのは組み込みの語だけなので、同じ label を exclude と
        extend の両方に書けば「組み込みの語を自前の定義で置き換える」になる。
        """
        kept = tuple(t for t in AMBIGUOUS_TERMS if t.label not in self.exclude)
        return kept + self.extend


@dataclass(frozen=True)
class SuffixConfig:
    """語尾規則。空タプルにするとその型の語尾検査を行わない。"""

    need: tuple[str, ...] = DEFAULT_NEED_SUFFIXES
    functional_requirement: tuple[str, ...] = DEFAULT_FR_SUFFIXES


@dataclass(frozen=True)
class Config:
    """1 プロジェクト分の設定。既定値は「設定ファイル無し」と同じ挙動。"""

    checks: Mapping[str, str | None] = field(default_factory=dict)
    lexicon: LexiconConfig = LexiconConfig()
    suffix: SuffixConfig = SuffixConfig()
    id_prefix: Mapping[str, str] = field(default_factory=dict)
    high_priority_threshold: int = DEFAULT_HIGH_PRIORITY_THRESHOLD
    #: 読み込み元。設定ファイルが無ければ None。
    source: Path | None = None

    # -- チェックの有効/無効・重大度 ---------------------------------------

    def severity_for(self, code: str, default: Severity) -> Severity | None:
        """そのコードの実効重大度。None なら報告しない。"""
        if code not in self.checks:
            return default
        override = self.checks[code]
        if override is None:
            return None
        return override  # type: ignore[return-value]

    def apply(self, findings: FindingList) -> FindingList:
        """指摘の列に ``[checks]`` の上書きを適用する。

        すべての指摘はここを通す。層0/層1 の指摘も対象だが、重大度を下げても
        「読めなかったノードが読めるようになる」わけではない (語尾規則を
        緩めたいなら ``[suffix]`` を使う)。
        """
        if not self.checks:
            return findings
        kept = FindingList()
        for finding in findings:
            severity = self.severity_for(finding.code, finding.severity)
            if severity is None:
                continue
            kept.add(
                finding
                if severity == finding.severity
                else replace(finding, severity=severity)
            )
        return kept

    # -- 曖昧語 -------------------------------------------------------------

    def lexicon_terms(self) -> tuple[AmbiguousTerm, ...]:
        return self.lexicon.terms()


DEFAULT_CONFIG = Config()


# ---------------------------------------------------------------------------
# 有効な設定の持ち回り
# ---------------------------------------------------------------------------

_active: ContextVar[Config] = ContextVar("reqmodel_config", default=DEFAULT_CONFIG)


def active_config() -> Config:
    """いま有効な設定。``use_config()`` の外では既定値。"""
    return _active.get()


@contextmanager
def use_config(config: Config) -> Iterator[Config]:
    """設定を有効にする。読み込み (語尾規則) と検証の両方を囲むこと。"""
    token = _active.set(config)
    try:
        yield config
    finally:
        _active.reset(token)


# ---------------------------------------------------------------------------
# 探索と読み込み
# ---------------------------------------------------------------------------


def _read_toml(path: Path) -> dict[str, Any]:
    try:
        with path.open("rb") as stream:
            return tomllib.load(stream)
    except OSError as exc:
        raise ConfigError(f"設定ファイルを読めない: {path} ({exc})") from exc
    except tomllib.TOMLDecodeError as exc:
        raise ConfigError(f"TOML として読めない: {path} ({exc})") from exc


def _section_of(path: Path, data: dict[str, Any]) -> dict[str, Any] | None:
    """設定本体の取り出し。pyproject.toml なら [tool.reqmodel] を見る。"""
    if path.name != PYPROJECT_FILENAME:
        return data
    tool = data.get("tool")
    if not isinstance(tool, dict):
        return None
    section = tool.get("reqmodel")
    if section is None:
        return None
    if not isinstance(section, dict):
        raise ConfigError(f"{path}: [tool.reqmodel] はテーブルであること")
    return section


def find_config_file(start: Path | str | None = None) -> Path | None:
    """start (既定: カレント) から上に辿って最初に見つかった設定ファイル。

    同じディレクトリに両方あれば ``reqmodel.toml`` を優先する。
    ``pyproject.toml`` は ``[tool.reqmodel]`` を持つものだけを設定ファイルとみなす。
    """
    base = Path(start) if start is not None else Path.cwd()
    base = base.resolve()
    for directory in (base, *base.parents):
        candidate = directory / CONFIG_FILENAME
        if candidate.is_file():
            return candidate
        pyproject = directory / PYPROJECT_FILENAME
        if pyproject.is_file():
            try:
                if _section_of(pyproject, _read_toml(pyproject)) is not None:
                    return pyproject
            except ConfigError:
                # 自分向けの設定を持たない壊れた pyproject.toml で探索を
                # 止めない (無関係なプロジェクトのファイルかもしれない)。
                continue
    return None


def load_config(
    path: Path | str | None = None,
    start: Path | str | None = None,
    enabled: bool = True,
) -> Config:
    """設定を読む。

    - ``path`` を渡せばそのファイルだけを読む (存在しなければエラー)。
    - 渡さなければ ``start`` から上に辿って探す。見つからなければ既定値。
    - ``enabled=False`` なら探索も読み込みもせず既定値 (``--no-config``)。
    """
    if not enabled:
        return DEFAULT_CONFIG

    if path is not None:
        found = Path(path)
        if not found.is_file():
            raise ConfigError(f"設定ファイルが存在しない: {found}")
    else:
        discovered = find_config_file(start)
        if discovered is None:
            return DEFAULT_CONFIG
        found = discovered

    section = _section_of(found, _read_toml(found))
    if section is None:
        if path is not None:
            raise ConfigError(f"{found}: [tool.reqmodel] が無い")
        return DEFAULT_CONFIG
    return parse_config(section, source=found)


# ---------------------------------------------------------------------------
# 解析 (未知のキーはエラーにする。設定の綴り間違いを黙って無視しない)
# ---------------------------------------------------------------------------

_TOP_KEYS = frozenset(
    {"checks", "lexicon", "suffix", "id_prefix", "high_priority_threshold"}
)
_LEXICON_KEYS = frozenset({"extend", "exclude"})
_SUFFIX_KEYS = frozenset({"strict", "need", "functional_requirement"})
_TERM_KEYS = frozenset({"label", "advice", "pattern"})

_VALID_SEVERITIES = tuple(SEVERITY_ORDER) + (OFF,)


def _where(source: Path | None, key: str) -> str:
    return f"{source}: {key}" if source else key


def _check_keys(
    section: Mapping[str, Any], allowed: frozenset[str], source: Path | None, at: str
) -> None:
    unknown = sorted(k for k in section if k not in allowed)
    if unknown:
        raise ConfigError(
            f"{_where(source, at)}: 未知のキー {', '.join(unknown)} "
            f"(指定可能: {', '.join(sorted(allowed))})"
        )


def _as_table(value: Any, source: Path | None, at: str) -> Mapping[str, Any]:
    if not isinstance(value, dict):
        raise ConfigError(f"{_where(source, at)}: テーブルであること")
    return value


def _as_str_list(value: Any, source: Path | None, at: str) -> tuple[str, ...]:
    if not isinstance(value, list) or not all(isinstance(v, str) for v in value):
        raise ConfigError(f"{_where(source, at)}: 文字列の配列であること")
    return tuple(value)


def parse_config(section: Mapping[str, Any], source: Path | None = None) -> Config:
    """設定テーブル (TOML を dict にしたもの) を Config にする。"""
    _check_keys(section, _TOP_KEYS, source, "[reqmodel]")

    return Config(
        checks=_parse_checks(section.get("checks"), source),
        lexicon=_parse_lexicon(section.get("lexicon"), source),
        suffix=_parse_suffix(section.get("suffix"), source),
        id_prefix=_parse_id_prefix(section.get("id_prefix"), source),
        high_priority_threshold=_parse_threshold(
            section.get("high_priority_threshold"), source
        ),
        source=source,
    )


def _parse_checks(value: Any, source: Path | None) -> dict[str, str | None]:
    if value is None:
        return {}
    table = _as_table(value, source, "[checks]")
    parsed: dict[str, str | None] = {}
    for code, severity in table.items():
        at = f"[checks] {code}"
        if not isinstance(severity, str) or severity not in _VALID_SEVERITIES:
            raise ConfigError(
                f"{_where(source, at)}: {', '.join(_VALID_SEVERITIES)} のいずれかであること"
            )
        parsed[code] = None if severity == OFF else severity
    return parsed


def _parse_lexicon(value: Any, source: Path | None) -> LexiconConfig:
    if value is None:
        return LexiconConfig()
    table = _as_table(value, source, "[lexicon]")
    _check_keys(table, _LEXICON_KEYS, source, "[lexicon]")

    extend: list[AmbiguousTerm] = []
    raw_extend = table.get("extend", [])
    if not isinstance(raw_extend, list):
        raise ConfigError(f"{_where(source, '[lexicon] extend')}: テーブルの配列であること")
    for index, raw in enumerate(raw_extend):
        at = f"[[lexicon.extend]] #{index + 1}"
        entry = _as_table(raw, source, at)
        _check_keys(entry, _TERM_KEYS, source, at)
        label = entry.get("label")
        advice = entry.get("advice")
        pattern = entry.get("pattern", "")
        if not isinstance(label, str) or not label:
            raise ConfigError(f"{_where(source, at)}: label は空でない文字列であること")
        if not isinstance(advice, str) or not advice:
            raise ConfigError(f"{_where(source, at)}: advice は空でない文字列であること")
        if not isinstance(pattern, str):
            raise ConfigError(f"{_where(source, at)}: pattern は文字列であること")
        term = AmbiguousTerm(label=label, advice=advice, pattern=pattern)
        try:
            term.regex()
        except Exception as exc:  # re.error
            raise ConfigError(
                f"{_where(source, at)}: pattern が正規表現として不正 ({exc})"
            ) from exc
        extend.append(term)

    exclude = _as_str_list(table.get("exclude", []), source, "[lexicon] exclude")
    known = {term.label for term in AMBIGUOUS_TERMS}
    unknown = sorted(label for label in exclude if label not in known)
    if unknown:
        raise ConfigError(
            f"{_where(source, '[lexicon] exclude')}: 組み込み辞書に無い語 "
            f"{', '.join(unknown)} (label の綴りを合わせること)"
        )

    return LexiconConfig(extend=tuple(extend), exclude=frozenset(exclude))


def _parse_suffix(value: Any, source: Path | None) -> SuffixConfig:
    if value is None:
        return SuffixConfig()
    table = _as_table(value, source, "[suffix]")
    _check_keys(table, _SUFFIX_KEYS, source, "[suffix]")

    strict = table.get("strict", False)
    if not isinstance(strict, bool):
        raise ConfigError(f"{_where(source, '[suffix] strict')}: 真偽値であること")

    need = STRICT_NEED_SUFFIXES if strict else DEFAULT_NEED_SUFFIXES
    fr = STRICT_FR_SUFFIXES if strict else DEFAULT_FR_SUFFIXES
    if "need" in table:
        need = _as_str_list(table["need"], source, "[suffix] need")
    if "functional_requirement" in table:
        fr = _as_str_list(
            table["functional_requirement"], source, "[suffix] functional_requirement"
        )
    return SuffixConfig(need=need, functional_requirement=fr)


def _parse_id_prefix(value: Any, source: Path | None) -> dict[str, str]:
    if value is None:
        return {}
    from .model import NODE_TYPES  # 循環 import を避けるため遅延させる

    table = _as_table(value, source, "[id_prefix]")
    parsed: dict[str, str] = {}
    for type_name, prefix in table.items():
        at = f"[id_prefix] {type_name}"
        node_type = NODE_TYPES.get(type_name)
        if node_type is None:
            raise ConfigError(
                f"{_where(source, at)}: 未知のノード型 "
                f"(指定可能: {', '.join(sorted(NODE_TYPES))})"
            )
        if not isinstance(prefix, str) or not prefix:
            raise ConfigError(f"{_where(source, at)}: 空でない文字列であること")
        # FR / QR のような別名は正式名に寄せる (指摘の重複を防ぐ)。
        parsed[node_type.__name__] = prefix
    return parsed


def _parse_threshold(value: Any, source: Path | None) -> int:
    if value is None:
        return DEFAULT_HIGH_PRIORITY_THRESHOLD
    if isinstance(value, bool) or not isinstance(value, int):
        raise ConfigError(
            f"{_where(source, 'high_priority_threshold')}: 整数であること"
        )
    return value


