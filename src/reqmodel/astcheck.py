"""層0: 宣言性の担保と、AST からのノード集合復元。

定義ファイルは「クラスのインスタンス化を並べただけのもの」に限定する。

- 許可: import 文、ノード型のインスタンス化、変数への代入 (参照用)
- 禁止: for / while / if / 関数定義 / クラス定義 / 内包表記 / 演算 /
  属性アクセス / f-string / ノード型以外の呼び出し

この規約を ``ast`` による静的検査で機械的に担保する。副産物として、定義ファイルは
**実行せずに** AST から直接ノード集合を復元できる。本ツールは定義ファイルを
一切 exec しない。
"""

from __future__ import annotations

import ast
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from .core.metamodel import NODE_TYPES
from .definition import Reference
from .presentation.view import RequirementGroup

DECLARATION_TYPES = {**NODE_TYPES, "RequirementGroup": RequirementGroup}
VALUE_TYPES = {"Reference": Reference}

__all__ = ["RawNode", "ExtractResult", "extract_source", "extract_file", "ALLOWED_IMPORT_ROOTS"]

#: import を許可するモジュールのルート。
ALLOWED_IMPORT_ROOTS = frozenset({"reqmodel", "__future__"})


@dataclass
class RawNode:
    """AST から復元した、まだ検証されていないノード情報。"""

    type_name: str
    kwargs: dict[str, Any]
    lineno: int
    var_name: str | None = None

    @property
    def id(self) -> str | None:
        value = self.kwargs.get("id")
        return value if isinstance(value, str) else None


@dataclass
class Violation:
    """層0 違反。"""

    message: str
    lineno: int

    def __str__(self) -> str:  # pragma: no cover - 表示のみ
        return f"{self.lineno}行目: {self.message}"


@dataclass
class ExtractResult:
    nodes: list[RawNode] = field(default_factory=list)
    violations: list[Violation] = field(default_factory=list)
    path: Path | None = None
    #: 指摘に出す表示名。git の前版なら "HEAD:requirements.py" のような形になる。
    name: str = "<definition>"


_FORBIDDEN_STATEMENTS = {
    ast.For: "for 文",
    ast.AsyncFor: "async for 文",
    ast.While: "while 文",
    ast.If: "if 文",
    ast.With: "with 文",
    ast.AsyncWith: "async with 文",
    ast.Try: "try 文",
    ast.FunctionDef: "関数定義",
    ast.AsyncFunctionDef: "関数定義",
    ast.ClassDef: "クラス定義",
    ast.Return: "return 文",
    ast.Raise: "raise 文",
    ast.Assert: "assert 文",
    ast.Global: "global 宣言",
    ast.Nonlocal: "nonlocal 宣言",
    ast.Delete: "del 文",
    ast.Match: "match 文",
}

_FORBIDDEN_EXPRESSIONS = {
    ast.ListComp: "リスト内包表記",
    ast.SetComp: "集合内包表記",
    ast.DictComp: "辞書内包表記",
    ast.GeneratorExp: "ジェネレータ式",
    ast.Lambda: "lambda 式",
    ast.IfExp: "条件式",
    ast.BinOp: "二項演算",
    ast.UnaryOp: "単項演算",
    ast.BoolOp: "論理演算",
    ast.Compare: "比較演算",
    ast.JoinedStr: "f-string",
    ast.Await: "await 式",
    ast.Yield: "yield 式",
    ast.YieldFrom: "yield from 式",
    ast.Starred: "アンパック",
    ast.Attribute: "属性アクセス",
    ast.Subscript: "添字アクセス",
    ast.NamedExpr: "セイウチ演算子",
}


class _Extractor:
    """モジュールの AST を走査し、層0 検査とノード復元を同時に行う。"""

    def __init__(self) -> None:
        self.result = ExtractResult()
        #: 変数名 → 値。ノード変数は id 文字列に解決される。
        self.env: dict[str, Any] = {}
        self.imported: set[str] = set()

    # -- 入口 ---------------------------------------------------------------

    def run(self, tree: ast.Module) -> ExtractResult:
        for stmt in tree.body:
            self._visit_statement(stmt)
        return self.result

    def _violation(self, message: str, node: ast.AST) -> None:
        self.result.violations.append(
            Violation(message=message, lineno=getattr(node, "lineno", 0))
        )

    # -- 文 -----------------------------------------------------------------

    def _visit_statement(self, stmt: ast.stmt) -> None:
        for stmt_type, label in _FORBIDDEN_STATEMENTS.items():
            if isinstance(stmt, stmt_type):
                self._violation(f"{label}は定義ファイルに書けない (宣言のみ)", stmt)
                return

        if isinstance(stmt, (ast.Import, ast.ImportFrom)):
            self._visit_import(stmt)
            return

        if isinstance(stmt, ast.Assign):
            self._visit_assign(stmt)
            return

        if isinstance(stmt, ast.AnnAssign):
            if stmt.value is None:
                self._violation("値のない注釈だけの宣言は書けない", stmt)
                return
            self._visit_assign_like([stmt.target], stmt.value, stmt)
            return

        if isinstance(stmt, ast.AugAssign):
            self._violation("複合代入は書けない (演算禁止)", stmt)
            return

        if isinstance(stmt, ast.Expr):
            if isinstance(stmt.value, ast.Constant) and isinstance(stmt.value.value, str):
                return  # docstring
            if isinstance(stmt.value, ast.Call):
                if isinstance(stmt.value.func, ast.Name) and stmt.value.func.id in VALUE_TYPES:
                    self._eval(stmt.value)
                    return
                self._visit_instantiation(stmt.value, var_name=None)
                return
            self._violation("式文はノード型のインスタンス化のみ許される", stmt)
            return

        if isinstance(stmt, ast.Pass):
            return

        self._violation(f"{type(stmt).__name__} は定義ファイルに書けない", stmt)

    def _visit_import(self, stmt: ast.Import | ast.ImportFrom) -> None:
        if isinstance(stmt, ast.ImportFrom):
            module = stmt.module or ""
            root = module.split(".")[0]
            if stmt.level != 0 or root not in ALLOWED_IMPORT_ROOTS:
                self._violation(
                    f"import できるのは {sorted(ALLOWED_IMPORT_ROOTS)} のみ (指定: {module or '.'})",
                    stmt,
                )
                return
            for alias in stmt.names:
                self.imported.add(alias.asname or alias.name)
            return

        for alias in stmt.names:
            root = alias.name.split(".")[0]
            if root not in ALLOWED_IMPORT_ROOTS:
                self._violation(
                    f"import できるのは {sorted(ALLOWED_IMPORT_ROOTS)} のみ (指定: {alias.name})",
                    stmt,
                )
                continue
            self._violation(
                "モジュール import ではなく `from reqmodel import ...` を使うこと "
                "(属性アクセスは禁止のため)",
                stmt,
            )

    def _visit_assign(self, stmt: ast.Assign) -> None:
        self._visit_assign_like(stmt.targets, stmt.value, stmt)

    def _visit_assign_like(
        self, targets: list[ast.expr], value: ast.expr, stmt: ast.stmt
    ) -> None:
        names: list[str] = []
        for target in targets:
            if not isinstance(target, ast.Name):
                self._violation("代入先は単純な変数名のみ", stmt)
                return
            names.append(target.id)

        if isinstance(value, ast.Call):
            if isinstance(value.func, ast.Name) and value.func.id in VALUE_TYPES:
                literal = self._eval(value)
                if literal is _INVALID:
                    return
                for name in names:
                    if name in self.env:
                        self._violation(f"変数 {name} が再代入されている", stmt)
                    self.env[name] = literal
                return
            raw = self._visit_instantiation(value, var_name=names[0])
            if raw is None:
                return
            for name in names:
                if name in self.env:
                    self._violation(f"変数 {name} が再代入されている", stmt)
                self.env[name] = raw.id
            return

        literal = self._eval(value)
        if literal is _INVALID:
            return
        for name in names:
            if name in self.env:
                self._violation(f"変数 {name} が再代入されている", stmt)
            self.env[name] = literal

    # -- インスタンス化 -----------------------------------------------------

    def _visit_instantiation(self, call: ast.Call, var_name: str | None) -> RawNode | None:
        if not isinstance(call.func, ast.Name):
            self._violation("呼び出せるのはノード型のみ", call)
            return None

        type_name = call.func.id
        if type_name in VALUE_TYPES:
            self._violation(f"{type_name} は単独の宣言としては書けない", call)
            return None
        if type_name not in DECLARATION_TYPES:
            self._violation(f"未知の型 {type_name} は呼び出せない", call)
            return None
        if type_name not in self.imported:
            self._violation(f"{type_name} が import されていない", call)
            return None
        if call.args:
            self._violation(
                f"{type_name} の生成はキーワード引数のみ (位置引数は不可)", call
            )
            return None

        kwargs: dict[str, Any] = {}
        for keyword in call.keywords:
            if keyword.arg is None:
                self._violation("** による展開は書けない", call)
                return None
            evaluated = self._eval(keyword.value)
            if evaluated is _INVALID:
                return None
            kwargs[keyword.arg] = evaluated

        raw = RawNode(
            type_name=type_name,
            kwargs=kwargs,
            lineno=call.lineno,
            var_name=var_name,
        )
        self.result.nodes.append(raw)
        return raw

    # -- 式の評価 (定数・リスト・タプル・変数参照のみ) -----------------------

    def _eval(self, expr: ast.expr) -> Any:
        for expr_type, label in _FORBIDDEN_EXPRESSIONS.items():
            if isinstance(expr, expr_type):
                self._violation(f"{label}は定義ファイルに書けない", expr)
                return _INVALID

        if isinstance(expr, ast.Constant):
            return expr.value

        if isinstance(expr, (ast.List, ast.Tuple, ast.Set)):
            values = []
            for element in expr.elts:
                evaluated = self._eval(element)
                if evaluated is _INVALID:
                    return _INVALID
                values.append(evaluated)
            return tuple(values) if isinstance(expr, ast.Tuple) else values

        if isinstance(expr, ast.Dict):
            self._violation("辞書リテラルは書けない", expr)
            return _INVALID

        if isinstance(expr, ast.Name):
            if expr.id not in self.env:
                self._violation(f"未定義の名前 {expr.id} を参照している", expr)
                return _INVALID
            return self.env[expr.id]

        if isinstance(expr, ast.Call):
            return self._eval_value_call(expr)

        self._violation(f"{type(expr).__name__} は定義ファイルに書けない", expr)
        return _INVALID

    def _eval_value_call(self, call: ast.Call) -> Any:
        if not isinstance(call.func, ast.Name):
            self._violation("呼び出せるのはノード型または値オブジェクト型のみ", call)
            return _INVALID
        type_name = call.func.id
        value_type = VALUE_TYPES.get(type_name)
        if value_type is None:
            self._violation("ノード型以外の呼び出しは書けない", call)
            return _INVALID
        if type_name not in self.imported:
            self._violation(f"{type_name} が import されていない", call)
            return _INVALID
        if call.args:
            self._violation(
                f"{type_name} の生成はキーワード引数のみ (位置引数は不可)", call
            )
            return _INVALID
        kwargs: dict[str, Any] = {}
        for keyword in call.keywords:
            if keyword.arg is None:
                self._violation("** による展開は書けない", call)
                return _INVALID
            evaluated = self._eval(keyword.value)
            if evaluated is _INVALID:
                return _INVALID
            kwargs[keyword.arg] = evaluated
        try:
            return value_type(**kwargs).model_dump(mode="json")
        except Exception as exc:
            self._violation(f"{type_name} の値が規約に反する: {exc}", call)
            return _INVALID


class _Invalid:
    __slots__ = ()


_INVALID = _Invalid()


def extract_source(source: str, filename: str = "<definition>") -> ExtractResult:
    """定義ファイルのソースから層0 検査とノード復元を行う (実行はしない)。"""
    try:
        tree = ast.parse(source, filename=filename)
    except SyntaxError as exc:
        result = ExtractResult(name=filename)
        result.violations.append(
            Violation(message=f"構文エラー: {exc.msg}", lineno=exc.lineno or 0)
        )
        return result
    result = _Extractor().run(tree)
    result.name = filename
    return result


def extract_file(path: Path) -> ExtractResult:
    result = extract_source(path.read_text(encoding="utf-8"), filename=str(path))
    result.path = path
    return result
