"""メタモデル: ノード型・エッジ型の定義。

設計方針:
- 意味内容 (text) は自然言語のまま保持し、形式化しない。
- 構造 (型・エッジ) だけを Pydantic のフィールド型として形式化する。
- エッジは ``list[Ref[T]]`` の形で宣言し、型規則をフィールド型そのもので表現する。
  これにより mypy と IDE 補完が記述時点から効く。
"""

from __future__ import annotations

from typing import (
    Annotated,
    Any,
    Literal,
    TypeVar,
    Union,
)

from pydantic import BaseModel, BeforeValidator, ConfigDict, field_validator

from ..codes import CHECK_CODES, SUPPRESSIBLE_CODES

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
    "Waiver",
    "STATUS_RANK",
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
    """FR と QR の共通部分。検証に関わる 2 つの欄を持つ。

    ``evidence`` が主で、``acceptance_criteria`` が従である。要求文が測定可能に
    書けていれば「何をもって満たしたとするか」は text に入りきるので、事前の基準は
    任意とし、検査は「``verified`` と主張したなら根拠を出せ」の側にだけ置いた
    (docs/design/model.md の「検証可能性を evidence 側に置く」を参照)。
    """

    #: 何をもって満たしたと判断したか。``status="verified"`` の根拠になる
    #: (``structure.unverified_claim``)。事後の事実を書く欄なので、テスト・計測・
    #: レビューのいずれでもよい。
    evidence: list[str] = []
    #: text が測定可能に書けないときだけ、事前の基準としてその操作化を書く。
    #: 書かなくても指摘は出ない。
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
