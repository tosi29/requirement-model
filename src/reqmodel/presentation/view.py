"""Presentation-only view definitions for requirement diagrams."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, field_validator

from ..definition import Constraint, FunctionalRequirement, QualityRequirement, Ref

__all__ = ["RequirementGroup"]


class RequirementGroup(BaseModel):
    """表示用の要求グループ。

    要求ノード本体に表示都合の field を足さず、Requirements 段の枠だけをここで
    宣言する。members は主所属を表し、同じノードが複数グループに現れても最初の
    グループだけに描く。
    """

    model_config = ConfigDict(extra="forbid", validate_assignment=True)

    id: str
    label: str
    members: list[Ref[FunctionalRequirement | QualityRequirement | Constraint]] = []
    order: int = 0

    @field_validator("id")
    @classmethod
    def _check_id(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("id は空にできない")
        if any(c.isspace() for c in value):
            raise ValueError("id に空白を含めることはできない")
        return value

    @field_validator("label")
    @classmethod
    def _check_label(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("label は空にできない")
        return value
