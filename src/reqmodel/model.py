"""メタモデル: ノード型・エッジ型の定義。

設計方針:
- 意味内容 (text) は自然言語のまま保持し、形式化しない。
- 構造 (型・エッジ) だけを Pydantic のフィールド型として形式化する。
- エッジは ``list[Ref[T]]`` の形で宣言し、型規則をフィールド型そのもので表現する。
  これにより mypy と IDE 補完が記述時点から効く。
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import (
    Annotated,
    Any,
    Literal,
    TypeVar,
    Union,
    get_args,
    get_origin,
    get_type_hints,
)

from pydantic import BaseModel, BeforeValidator, ConfigDict, field_validator

from .codes import CHECK_CODES, SUPPRESSIBLE_CODES

__all__ = [
    "Node",
    "Sourced",
    "Requirement",
    "Goal",
    "Need",
    "FunctionalRequirement",
    "QualityRequirement",
    "Constraint",
    "Source",
    "System",
    "FR",
    "QR",
    "Ref",
    "Status",
    "EdgeSpec",
    "Waiver",
    "NODE_TYPES",
    "TYPE_ORDER",
    "SOURCE_EDGES",
    "GRAPH_EDGE_NAMES",
    "edge_specs_for",
    "STATUS_RANK",
    "HIGH_PRIORITY_THRESHOLD",
]


# ---------------------------------------------------------------------------
# 基本語彙
# ---------------------------------------------------------------------------

Status = Literal["proposed", "approved", "implemented", "verified"]

#: 状態の成熟度。上流ノードは下流ノード以上に成熟しているべき、という検査に使う。
STATUS_RANK: dict[str, int] = {
    "proposed": 0,
    "approved": 1,
    "implemented": 2,
    "verified": 3,
}

#: priority は「小さいほど高優先」。この値以下を高優先度として扱う。
HIGH_PRIORITY_THRESHOLD = 2

#: 指摘の抑制 1 件。(チェックコード, 理由)。理由は必須 (下の validator を参照)。
Waiver = tuple[str, str]


class RefMarker:
    """``Ref[...]`` であることを実行時に識別するためのマーカ。"""

    __slots__ = ()

    def __repr__(self) -> str:  # pragma: no cover - デバッグ表示のみ
        return "RefMarker()"


def _to_id(value: Any) -> Any:
    """ノードインスタンスを受け取ったら id 文字列に正規化する。"""
    if isinstance(value, Node):
        return value.id
    return value


T = TypeVar("T")

#: 他ノードへの参照。定義ファイルではノード変数そのものを書け、内部では id 文字列になる。
Ref = Annotated[Union[T, str], BeforeValidator(_to_id), RefMarker()]


def _strip_terminator(text: str) -> str:
    return text.strip().rstrip("。.")


# ---------------------------------------------------------------------------
# ノード型
# ---------------------------------------------------------------------------


class Node(BaseModel):
    """全ノード共通の属性。"""

    model_config = ConfigDict(extra="forbid", validate_assignment=True)

    id: str
    text: str
    status: Status = "proposed"
    priority: int | None = None
    #: 既知・意図的な指摘を黙らせる waiver。``[("structure.missing_source", "理由")]``
    #: の形で、コードと理由の組を並べる。理由の無い抑制は書けない。
    suppress: list[Waiver] = []

    @field_validator("id")
    @classmethod
    def _check_id(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("id は空にできない")
        if any(c.isspace() for c in value):
            raise ValueError("id に空白を含めることはできない")
        return value

    @field_validator("text")
    @classmethod
    def _check_text(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("text は空にできない")
        return value

    @field_validator("suppress", mode="before")
    @classmethod
    def _check_suppress(cls, value: Any) -> Any:
        """抑制の宣言を、書いた時点 (層1) で検査する。

        抑制は「既知だと分かっている」という主張なので、対象コードが実在し、
        抑制可能で、理由が書かれていることをここで担保する。
        """
        if isinstance(value, (str, bytes)) or not isinstance(value, (list, tuple)):
            raise ValueError("suppress は (コード, 理由) の組のリストで書くこと")

        seen: set[str] = set()
        waivers: list[Waiver] = []
        for entry in value:
            if isinstance(entry, str):
                raise ValueError(
                    f"抑制 {entry!r} に理由が無い。(\"{entry}\", \"理由\") の組で書くこと"
                )
            if not isinstance(entry, (list, tuple)) or len(entry) != 2:
                raise ValueError("suppress の要素は (コード, 理由) の 2 要素の組で書くこと")
            code, reason = entry
            if not isinstance(code, str) or not isinstance(reason, str):
                raise ValueError("suppress のコードと理由はどちらも文字列で書くこと")
            known = CHECK_CODES.get(code)
            if known is None:
                raise ValueError(
                    f"未知のチェックコード {code!r} を抑制しようとしている "
                    f"(抑制できるコード: {', '.join(SUPPRESSIBLE_CODES)})"
                )
            if not known.suppressible:
                raise ValueError(
                    f"{code} は抑制できない ({known.summary}: エラーは既知として"
                    "飼い慣らす対象ではない)"
                )
            if not reason.strip():
                raise ValueError(f"{code} の抑制には理由が要る")
            if code in seen:
                raise ValueError(f"{code} の抑制が重複している")
            seen.add(code)
            waivers.append((code, reason.strip()))
        return waivers


class Sourced(Node):
    """源泉トレースを持つノード (Goal / Need / FR / QR / Constraint)。"""

    has_source: list[Ref["Source"]] = []


class Requirement(Sourced):
    """FR と QR の共通部分。受け入れ基準を持つ。"""

    acceptance_criteria: list[str] = []


class Goal(Sourced):
    """事業・ステークホルダーの意図 (なぜ)。

    主語は世界・組織の側で、文には書かない。解決策が存在しなくても成り立つ文で
    あることが条件で、システムを主語にした文 (「機械が〜する」) は Goal ではなく
    要求である。願いの主を一つの役割として名指せるなら Goal ではなく Need。

    Goal には text の規則が無く、この境界は機械が検査していない (README の
    「どの型に書くか」を参照)。
    """

    #: この Goal を分解した子 Goal 群の結合方法。
    decomposition: Literal["AND", "OR"] = "AND"
    #: 自分がどの親 Goal を詳細化しているか (子 → 親)。
    refines: list[Ref["Goal"]] = []
    motivates: list[Ref["Need"]] = []


class Need(Sourced):
    """何が満たされたいか。語尾は願望形「〜たい」。

    主語となる役割を必ず書く (「申請者は、」)。主語を書くノード型はこれだけで、
    Goal (主語は世界) と要求系 (主語はシステム) との境界はこの非対称にある。
    ただし検査しているのは語尾だけで、主語は検査していない。

    指示書の例示は「〜したい」だが、「気づきたい」「知りたい」のように
    サ変以外の願望形も同じ語尾規則の対象とみなし、「〜たい」で判定する。
    """

    @field_validator("text")
    @classmethod
    def _check_suffix(cls, value: str) -> str:
        if not _strip_terminator(value).endswith("たい"):
            raise ValueError("Need の text は願望形「〜したい」/「〜たい」で終わること")
        return value


class FunctionalRequirement(Requirement):
    """システムが提供すべき機能。語尾は「〜すること」。

    主語はシステムなので書かない。Need (主語は役割) との境界はこの非対称にある。
    QR / Constraint とは主語では分かれず、そちらは構造 (qualifies / constrains) で
    決まる。

    指示書の例示は「〜すること」だが、「読み取ること」「送ること」のように
    サ変以外の動詞も同じ語尾規則の対象とみなし、「〜こと」で判定する。
    """

    satisfies: list[Ref[Need]] = []
    refines: list[Ref["FunctionalRequirement"]] = []

    @field_validator("text")
    @classmethod
    def _check_suffix(cls, value: str) -> str:
        if not _strip_terminator(value).endswith("こと"):
            raise ValueError(
                "FunctionalRequirement の text は「〜すること」/「〜こと」で終わること"
            )
        return value


class QualityRequirement(Requirement):
    """品質要求。qualifies を出せるのは QR だけ。"""

    qualifies: list[Ref[Union["FunctionalRequirement", "System"]]] = []


class Constraint(Sourced):
    """解決策の自由度を制限する条件。要求ではない。"""

    constrains: list[Ref[Union["FunctionalRequirement", "QualityRequirement"]]] = []


class Source(Node):
    """要求の源泉。構造的振る舞いが同一なので単一型とし kind で分類する。

    引用 (規程の条文、ヒアリングでの発言) も Source として書き、``part_of`` で
    親の源泉にぶら下げる。引用は「要求から参照される」「要求を持たない」という点で
    源泉と構造的振る舞いが同じなので、型は分けない (Goal の refines と同じ同一型内
    階層)。引用がノードになることで id を持ち、複数の要求が同じ引用を根拠にできる。
    """

    kind: Literal["stakeholder", "document", "existing_system"]
    #: 自分がどの源泉の一部か (子 → 親)。引用・抜粋を親の文書や人にぶら下げる。
    part_of: list[Ref["Source"]] = []
    #: 出典の位置 (「第12条第3項」「2026-03-12 第3回ヒアリング」)。
    #: text は引用文そのものを書き、どこから引いたかはこちらに分ける。
    locator: str | None = None

    @field_validator("locator")
    @classmethod
    def _check_locator(cls, value: str | None) -> str | None:
        if value is not None and not value.strip():
            raise ValueError("locator は空文字にできない (書かないなら省略する)")
        return value


class System(Node):
    """全体品質の張り先となるノード。"""


#: 短縮名 (指示書中の FR / QR 表記に対応)。
FR = FunctionalRequirement
QR = QualityRequirement


#: 出力順序を安定させるための型の並び。
TYPE_ORDER: tuple[type[Node], ...] = (
    Goal,
    Need,
    FunctionalRequirement,
    QualityRequirement,
    Constraint,
    System,
    Source,
)

NODE_TYPES: dict[str, type[Node]] = {t.__name__: t for t in TYPE_ORDER}
NODE_TYPES["FR"] = FunctionalRequirement
NODE_TYPES["QR"] = QualityRequirement

TYPE_INDEX: dict[str, int] = {t.__name__: i for i, t in enumerate(TYPE_ORDER)}


# ---------------------------------------------------------------------------
# エッジ仕様 (フィールド型注釈から機械的に導出する)
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class EdgeSpec:
    """1 つのエッジ型の仕様。ノード型のフィールド注釈から導出される。"""

    name: str
    owner: type[Node]
    targets: tuple[type[Node], ...]

    def target_names(self) -> str:
        return " | ".join(t.__name__ for t in self.targets)


def _analyze(annotation: Any) -> tuple[type, ...]:
    """注釈を辿り参照先の型を返す。参照でなければ空タプル。"""
    origin = get_origin(annotation)

    if origin is Annotated:
        args = get_args(annotation)
        if any(isinstance(meta, RefMarker) for meta in args[1:]):
            return tuple(
                arg
                for arg in (get_args(args[0]) or (args[0],))
                if isinstance(arg, type) and arg is not str
            )
        return _analyze(args[0])

    if origin in (list, set, frozenset) or origin is Union:
        collected: list[type] = []
        for arg in get_args(annotation):
            for target in _analyze(arg):
                if target not in collected:
                    collected.append(target)
        return tuple(collected)

    return ()


def _build_edge_specs() -> dict[type[Node], dict[str, EdgeSpec]]:
    specs: dict[type[Node], dict[str, EdgeSpec]] = {}
    for node_type in TYPE_ORDER:
        hints = get_type_hints(node_type, include_extras=True)
        found: dict[str, EdgeSpec] = {}
        for field_name in node_type.model_fields:
            targets = _analyze(hints.get(field_name))
            if not targets:
                continue
            found[field_name] = EdgeSpec(
                name=field_name,
                owner=node_type,
                targets=targets,
            )
        specs[node_type] = found
    return specs


_EDGE_SPECS: dict[type[Node], dict[str, EdgeSpec]] = _build_edge_specs()


def edge_specs_for(node_type: type[Node]) -> dict[str, EdgeSpec]:
    """ノード型が持つエッジ仕様を返す。"""
    return _EDGE_SPECS[node_type]


#: エッジ名の一覧 (CLI のフィルタ指定などに使う)。
EDGE_NAMES: tuple[str, ...] = tuple(
    dict.fromkeys(
        name for specs in _EDGE_SPECS.values() for name in specs
    )
)

#: 源泉トレースのエッジ。**図には既定で描かない。**
#:
#: Source は数十件の要求から参照されるハブなので、ノードとして置くと近傍が一気に
#: 広がり、レイアウトが源泉に引っ張られる。源泉は「どの要求がどこから来たか」を
#: ノードの属性として読む情報であって、要求どうしの関係を辿るための経路ではない。
#: そのため図では描かず、参照元ノードの属性として出す (``req doc`` が最初から
#: そうしている)。集約して見たいとき (この条文がどの要求に効いているか) は
#: 源泉節・``Source × 要求`` 表・テーブルビューを使う。
#:
#: 型としての Source と検査 (``structure.missing_source`` 等) は無関係で、
#: ここで決まるのは描画だけである。
SOURCE_EDGES: frozenset[str] = frozenset({"has_source", "part_of"})

#: 図に既定で描くエッジ名。並びは EDGE_NAMES のまま。
GRAPH_EDGE_NAMES: tuple[str, ...] = tuple(
    name for name in EDGE_NAMES if name not in SOURCE_EDGES
)
