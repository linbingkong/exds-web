#!/usr/bin/env python3
"""后端鉴权检查：所有写接口必须挂 require_permission/require_any_permission。"""

from __future__ import annotations

import ast
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable


WRITE_METHODS = {"post", "put", "patch", "delete"}

# 白名单：允许仅认证（无动作级权限）的写接口。
# 目前仅保留“当前用户主动登出”这一项。
AUTH_ONLY_WRITE_ENDPOINTS = {
    ("POST", "/logout"),
    ("POST", "/password/forgot/send-code"),
    ("POST", "/password/forgot/reset"),
    ("POST", "/security/status"),
    ("POST", "/security/change-password"),
    ("POST", "/security/bind-email"),
    ("POST", "/security/verify-email"),
    ("POST", "/security/send-login-email-code"),
    ("POST", "/security/complete"),
}


@dataclass
class Violation:
    file: Path
    line: int
    method: str
    path: str
    reason: str

    def key(self, root: Path) -> str:
        rel = self.file.relative_to(root).as_posix()
        return f"{rel}|{self.method}|{self.path}"


def _call_name(node: ast.AST) -> str:
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        return node.attr
    return ""


def _is_depends_auth_call(expr: ast.AST) -> bool:
    if not isinstance(expr, ast.Call):
        return False
    if _call_name(expr.func) != "Depends":
        return False
    if not expr.args:
        return False
    first = expr.args[0]
    if isinstance(first, ast.Call):
        return _call_name(first.func) in {"require_permission", "require_any_permission"}
    return _call_name(first) in {"require_permission", "require_any_permission"}


def _decorator_write_route(decorator: ast.AST) -> tuple[str, str] | None:
    if not isinstance(decorator, ast.Call):
        return None
    if not isinstance(decorator.func, ast.Attribute):
        return None
    method = decorator.func.attr
    if method not in WRITE_METHODS:
        return None
    route_path = ""
    if decorator.args and isinstance(decorator.args[0], ast.Constant) and isinstance(decorator.args[0].value, str):
        route_path = decorator.args[0].value
    return method, route_path


def _decorator_has_auth_dependency(decorator: ast.AST) -> bool:
    if not isinstance(decorator, ast.Call):
        return False
    for kw in decorator.keywords:
        if kw.arg != "dependencies":
            continue
        if isinstance(kw.value, (ast.List, ast.Tuple)):
            if any(_is_depends_auth_call(item) for item in kw.value.elts):
                return True
    return False


def _function_has_auth_dependency(fn: ast.FunctionDef | ast.AsyncFunctionDef) -> bool:
    defaults: list[ast.AST] = []
    defaults.extend(fn.args.defaults)
    defaults.extend(fn.args.kw_defaults)
    for d in defaults:
        if d is not None and _is_depends_auth_call(d):
            return True
    return False


def _scan_file(path: Path) -> Iterable[Violation]:
    source = path.read_text(encoding="utf-8-sig")
    tree = ast.parse(source, filename=str(path))

    for node in ast.walk(tree):
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        write_decorators: list[tuple[str, str, bool]] = []
        for dec in node.decorator_list:
            result = _decorator_write_route(dec)
            if result:
                method, route_path = result
                write_decorators.append((method, route_path, _decorator_has_auth_dependency(dec)))
        if not write_decorators:
            continue

        fn_has_auth = _function_has_auth_dependency(node)
        for method, route_path, dec_has_auth in write_decorators:
            if (method.upper(), route_path or "<unknown>") in AUTH_ONLY_WRITE_ENDPOINTS:
                continue
            if fn_has_auth or dec_has_auth:
                continue
            yield Violation(
                file=path,
                line=node.lineno,
                method=method.upper(),
                path=route_path or "<unknown>",
                reason="写接口缺少 Depends(require_permission/require_any_permission)",
            )


def main() -> int:
    root = Path(__file__).resolve().parents[1]
    api_dir = root / "webapp" / "api"
    baseline_file = root / "scripts" / "auth_baseline_backend.txt"
    files = sorted(api_dir.glob("v1*.py"))
    baseline = set()
    if baseline_file.exists():
        for line in baseline_file.read_text(encoding="utf-8-sig").splitlines():
            line = line.strip()
            if line and not line.startswith("#"):
                baseline.add(line)

    violations: list[Violation] = []
    for f in files:
        violations.extend(_scan_file(f))

    new_violations = [v for v in violations if v.key(root) not in baseline]
    if new_violations:
        print("后端鉴权检查失败：")
        for v in new_violations:
            rel = v.file.relative_to(root)
            print(f"- {rel}:{v.line} [{v.method} {v.path}] {v.reason}")
        print("\n提示：若为历史存量问题，可评审后加入 scripts/auth_baseline_backend.txt。")
        return 1

    if violations:
        print(f"后端鉴权检查通过（已忽略基线存量 {len(violations) - len(new_violations)} 条）。")
    else:
        print("后端鉴权检查通过：所有写接口均已挂权限依赖。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
