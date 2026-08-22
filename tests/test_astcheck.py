"""層0: 宣言性の担保。"""

from __future__ import annotations

import pytest

from reqmodel.astcheck import extract_source

HEADER = "from reqmodel import Goal, Need, FunctionalRequirement, Reference\n"


def violations(source: str) -> list[str]:
    return [v.message for v in extract_source(HEADER + source).violations]


def test_declaration_only_is_accepted():
    result = extract_source(
        HEADER
        + """
src = Reference(title="経理部長", url="about:blank#S-1")
need = Need(id="Need-1", text="早く精算したい", source=[src])
"""
    )
    assert result.violations == []
    assert [n.type_name for n in result.nodes] == ["Need"]
    assert result.nodes[0].kwargs["source"][0]["title"] == "経理部長"
    assert result.nodes[0].var_name == "need"


@pytest.mark.parametrize(
    "snippet, expected",
    [
        ("for i in [1, 2]:\n    pass\n", "for 文"),
        ("if True:\n    pass\n", "if 文"),
        ("while True:\n    pass\n", "while 文"),
        ("def f():\n    pass\n", "関数定義"),
        ("class C:\n    pass\n", "クラス定義"),
        ("with open('x') as f:\n    pass\n", "with 文"),
        ("try:\n    pass\nexcept Exception:\n    pass\n", "try 文"),
        ('x = [i for i in [1]]\n', "リスト内包表記"),
        ("x = 1 + 1\n", "二項演算"),
        ("x = -1\n", "単項演算"),
        ("x = True and False\n", "論理演算"),
        ("x = 1 == 1\n", "比較演算"),
        ("x = f'{1}'\n", "f-string"),
        ("x = lambda: 1\n", "lambda 式"),
        ("x = 1 if True else 2\n", "条件式"),
        ("x = os.environ\n", "属性アクセス"),
        ("x = [1][0]\n", "添字アクセス"),
        ("x += 1\n", "複合代入"),
        ("del x\n", "del 文"),
        ("assert True\n", "assert 文"),
    ],
)
def test_forbidden_constructs(snippet, expected):
    assert any(expected in message for message in violations(snippet))


def test_import_is_restricted_to_the_model_package():
    messages = [v.message for v in extract_source("import os\n").violations]
    assert messages and "import できるのは" in messages[0]

    messages = [
        v.message for v in extract_source("from datetime import datetime\n").violations
    ]
    assert messages and "import できるのは" in messages[0]


def test_module_import_is_rejected_in_favour_of_from_import():
    messages = [v.message for v in extract_source("import reqmodel\n").violations]
    assert messages and "from reqmodel import" in messages[0]


def test_calls_other_than_node_types_are_rejected():
    assert any("未知の型" in m for m in violations('x = len("abc")\n'))
    assert any(
        "ノード型以外の呼び出し" in m
        for m in violations('n = Need(id=str(1), text="したい")\n')
    )


def test_node_type_must_be_imported():
    messages = [
        v.message
        for v in extract_source('n = Need(id="Need-1", text="したい")\n').violations
    ]
    assert messages and "import されていない" in messages[0]


def test_positional_arguments_are_rejected():
    assert any("キーワード引数のみ" in m for m in violations('n = Need("Need-1")\n'))


def test_unknown_name_reference_is_rejected():
    assert any(
        "未定義の名前" in m
        for m in violations('n = Need(id="Need-1", text="したい", source=[nope])\n')
    )


def test_reassignment_is_rejected():
    source = """
a = Need(id="Need-1", text="したい")
a = Need(id="Need-2", text="したい")
"""
    assert any("再代入" in m for m in violations(source))


def test_syntax_error_is_reported_as_violation():
    result = extract_source("n = Need(\n")
    assert result.violations and "構文エラー" in result.violations[0].message


def test_docstring_and_pass_are_allowed():
    result = extract_source('"""説明."""\npass\n')
    assert result.violations == []
