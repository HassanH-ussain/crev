"""Tests for crev.static_analyzer — each rule-based checker."""

from crev.models import Language, Severity
from crev.parser import parse_source
from crev.static_analyzer import run_static_analysis


def analyze(code: str, filename: str = "test.py") -> list:
    return run_static_analysis(parse_source(code, filename=filename))


def messages(issues) -> str:
    return " | ".join(i.message for i in issues)


class TestMutableDefaults:
    def test_list_default_flagged_critical(self):
        issues = analyze("def f(items=[]):\n    pass\n")
        critical = [i for i in issues if i.severity == Severity.CRITICAL]
        assert any("items" in i.message for i in critical)

    def test_dict_default_flagged(self):
        issues = analyze("def f(opts={}):\n    pass\n")
        assert any("opts" in i.message for i in issues)

    def test_none_default_not_flagged(self):
        issues = analyze("def f(items=None):\n    pass\n")
        assert not any("Mutable default" in i.message for i in issues)


class TestBareExcept:
    def test_bare_except_flagged(self):
        code = "try:\n    x()\nexcept:\n    pass\n"
        issues = analyze(code)
        assert any("except" in i.message for i in issues)

    def test_typed_except_not_flagged(self):
        code = "try:\n    x()\nexcept ValueError:\n    pass\n"
        issues = analyze(code)
        assert not any("Bare" in i.message for i in issues)

    def test_only_runs_on_python(self):
        code = "try {\n  x();\n} catch (e) {}\n"
        issues = analyze(code, filename="test.js")
        assert not any("Bare" in i.message for i in issues)


class TestHardcodedSecrets:
    def test_password_assignment_flagged(self):
        issues = analyze('password = "supersecret123"\n')
        secrets = [i for i in issues if i.category == "security"]
        assert secrets and secrets[0].severity == Severity.CRITICAL

    def test_api_key_prefix_flagged(self):
        issues = analyze('key = "sk-ant-abcdef1234567890"\n')
        assert any(i.category == "security" for i in issues)

    def test_clean_code_not_flagged(self):
        issues = analyze('name = "hello"\n')
        assert not any(i.category == "security" for i in issues)


class TestTodoFixme:
    def test_todo_is_info(self):
        issues = analyze("# TODO: refactor this\nx = 1\n")
        todo = [i for i in issues if "TODO" in i.message]
        assert todo and todo[0].severity == Severity.INFO

    def test_fixme_is_warning(self):
        issues = analyze("# FIXME: broken\nx = 1\n")
        fixme = [i for i in issues if "FIXME" in i.message]
        assert fixme and fixme[0].severity == Severity.WARNING


class TestLineLength:
    def test_long_line_flagged(self):
        issues = analyze("x = '" + "a" * 150 + "'\n")
        assert any(i.category == "style" and "characters" in i.message for i in issues)

    def test_capped_at_five(self):
        code = "\n".join("y = '" + "b" * 150 + "'" for _ in range(20))
        issues = analyze(code)
        long_lines = [i for i in issues if "characters" in i.message]
        assert len(long_lines) == 5


class TestPrintStatements:
    def test_print_flagged_as_info(self):
        issues = analyze('print("debug")\n')
        prints = [i for i in issues if "print()" in i.message]
        assert prints and prints[0].severity == Severity.INFO


class TestLargeFunctions:
    def test_function_over_50_lines_flagged(self):
        body = "\n".join(f"    x{i} = {i}" for i in range(60))
        code = f"def huge():\n{body}\n"
        issues = analyze(code)
        assert any(i.category == "complexity" for i in issues)


class TestOrdering:
    def test_issues_sorted_by_severity_then_line(self):
        code = (
            "# TODO: minor thing\n"
            "def f(items=[]):\n"
            "    pass\n"
        )
        issues = analyze(code)
        ranks = [i.severity.rank for i in issues]
        assert ranks == sorted(ranks)
