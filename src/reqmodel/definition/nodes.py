"""メタモデル: ノード型・外部参照型・エッジ型の定義。

設計方針:
- 意味内容 (text) は自然言語のまま保持し、形式化しない。
- 構造 (型・エッジ) だけを Pydantic のフィールド型として形式化する。
- 外部情報へのトレースは ``Reference`` 値としてノードに直接保持する。
- 要求間のエッジは ``list[Ref[T]]`` の形で宣言し、型規則をフィールド型そのもので表現する。
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
    "Reference",
    "Node",
    "Requirement",
    "Goal",
    "Need",
    "FunctionalRequirement",
    "QualityRequirement",
    "Constraint",
    "FR",
    "QR",
    "Ref",
    "DecisionStatus",
    "RequirementStatus",
    "Waiver",
    "STATUS_RANK",
]

# ---------------------------------------------------------------------------
# 基本語彙
# ---------------------------------------------------------------------------

DecisionStatus = Literal["proposed", "approved"]
RequirementStatus = Literal["proposed", "approved", "implemented", "verified"]

#: status の順序。合意済みかを判定し、表示・集計を安定させるために使う。
STATUS_RANK: dict[str, int] = {
    "proposed": 0,
    "approved": 1,
    "implemented": 2,
    "verified": 3,
}

#: 指摘の抑制 1 件。(チェックコード, 理由)。理由は必須 (下の validator を参照)。
Waiver = tuple[str, str]


class Reference(BaseModel):
    """要求の外側にある情報への参照。

    ``source`` / ``realized_by`` / ``evidence`` の意味は、Reference 自身の種別ではなく、
    それを保持するフィールド名で表す。``note`` は引用・要約・コメント・設計者の見解を
    細分化せず、参照先を開かずに文脈を把握するための自由記述欄である。
    """

    model_config = ConfigDict(extra="forbid", validate_assignment=True)

    title: str
    #: URL が存在しない一次情報もあるため任意。無関係なダミー URL は割り当てない。
    url: str | None = None
    note: str | None = None

    @field_validator("title")
    @classmethod
    def _check_required_text(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Reference.title は空にできない")
        return value

    @field_validator("url")
    @classmethod
    def _check_url_text(cls, value: str | None) -> str | None:
        if value is not None and not value.strip():
            raise ValueError("Reference.url は空文字にできない (URL が無ければ省略する)")
        return value

    @field_validator("note")
    @classmethod
    def _check_note(cls, value: str | None) -> str | None:
        if value is not None and not value.strip():
            raise ValueError("Reference.note は空文字にできない (書かないなら省略する)")
        return value


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
    status: RequirementStatus = "proposed"
    #: なぜこのノードが存在するのかを示す外部参照。
    source: list[Reference] = []
    #: 既知・意図的な指摘を黙らせる waiver。``[("structure.orphan_fr", "理由")]``
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
        """抑制の宣言を、書いた時点 (層1) で検査する。"""
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


class Requirement(Node):
    """FR と QR の共通部分。検証に関わる欄を持つ。"""

    #: どこで・何によってこの要求が実現されているのか。
    realized_by: list[Reference] = []
    #: 何をもって満たしたと判断したか。``status="verified"`` の根拠になる
    #: (``structure.unverified_claim``)。事後の事実を書く欄なので、テスト・計測・
    #: レビューのいずれでもよい。
    evidence: list[Reference] = []
    #: text が測定可能に書けないときだけ、事前の基準としてその操作化を書く。
    #: 書かなくても指摘は出ない。
    acceptance_criteria: list[str] = []


class Goal(Node):
    """事業・ステークホルダーの意図 (なぜ)。"""

    #: Goal は合意の状態だけを持つ。実現・検証される対象ではない。
    status: DecisionStatus = "proposed"
    #: 自分がどの親 Goal を詳細化しているか (子 → 親)。
    refines: list[Ref["Goal"]] = []
    motivates: list[Ref["Need"]] = []


class Need(Node):
    """何が満たされたいか。語尾は願望形「〜たい」。"""

    #: Need は合意の状態だけを持つ。実現・検証される対象ではない。
    status: DecisionStatus = "proposed"
    @field_validator("text")
    @classmethod
    def _check_suffix(cls, value: str) -> str:
        if not _strip_terminator(value).endswith("たい"):
            raise ValueError("Need の text は願望形「〜したい」/「〜たい」で終わること")
        return value


class FunctionalRequirement(Requirement):
    """システムが提供すべき機能。語尾は「〜すること」。"""

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

    qualifies: list[Ref["FunctionalRequirement"]] = []


class Constraint(Node):
    """解決策の自由度を制限する条件。要求ではない。"""

    #: Constraint は合意の状態だけを持つ。実現・検証される対象ではない。
    status: DecisionStatus = "proposed"
    constrains: list[Ref[Union["FunctionalRequirement", "QualityRequirement"]]] = []


#: 短縮名 (指示書中の FR / QR 表記に対応)。
FR = FunctionalRequirement
QR = QualityRequirement
