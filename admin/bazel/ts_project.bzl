"""
A macro for creating `ts_project()`s in the style of our codebase. Along with
any related tests for the project.
"""

load("@aspect_rules_swc//swc:defs.bzl", "swc_transpiler")
load("@aspect_rules_ts//ts:defs.bzl", _ts_project = "ts_project")
load("@aspect_rules_js//js:providers.bzl", "JsInfo")
load("@npm//:prettier/package_json.bzl", prettier_bin = "bin")
load("@npm//:eslint/package_json.bzl", eslint_bin = "bin")
load("//admin/bazel:ts_glob.bzl", "ts_glob")

def ts_project(name, srcs = None, deps = None, **kwargs):
    """
    Macro for creating a TypeScript project that implements some codebase conventions.

    Also creates rules for testing the TypeScript project.

    Args:
        name: The name of the project.
        srcs: Any sources for the project. Defaults to `ts_glob(["**/*"])`.
        deps: Any code this project needs to run.
        **kwargs: Arguments that will be forwarded to `ts_project()` from `aspect_rules_ts`.
    """

    if not srcs:
        srcs = ts_glob(["**/*"])

    if not deps:
        deps = []

    _ts_project(
        name = name,
        srcs = srcs,
        declaration = True,
        resolve_json_module = True,
        transpiler = swc_transpiler,
        tsconfig = "//:tsconfig",
        deps = deps,
        **kwargs
    )

    prettier_bin.prettier_test(
        name = "{}_format_test".format(name),
        args = ["--check"] + [src.replace("$", "$$") for src in srcs],
        chdir = native.package_name(),
        copy_data_to_bin = False,
        data = srcs + [
            "//:prettier.config.js",
            "//:.prettierignore",
        ],
    )

    _ts_typings(
        name = "{}_deps_typings".format(name),
        srcs = deps,
    )

    eslint_bin.eslint_test(
        name = "{}_lint_test".format(name),
        args = [
            "--rulesdir",
            "{}/admin/eslint/rules".format("/".join([".." for segment in native.package_name().split("/")])),
            "--max-warnings",
            "0",
            # Bazel will strip color if necessary.
            "--color",
        ] + [src.replace("$", "$$") for src in srcs],
        chdir = native.package_name(),
        copy_data_to_bin = False,
        data = ts_glob(["**/*"]) + [
            "//:node_modules/@remix-run/eslint-config",
            "//:node_modules/@typescript-eslint/eslint-plugin",
            "//:node_modules/eslint-plugin-jest",
            "//:node_modules/eslint-plugin-jest-dom",
            "//:node_modules/eslint-plugin-testing-library",
            "//:node_modules/react",
            "//:node_modules/typescript",
            "//:.eslintrc.js",
            "//:.eslintignore",
            "//:package.json",
            "//:tsconfig.json",
            "//admin:eslint_custom_rules",
            # Include the type information of our dependencies since we use type-aware
            # lint rules.
            ":{}_deps_typings".format(name),
        ],
    )

def _ts_typings_impl(ctx):
    typings = []

    for src in ctx.attr.srcs:
        if JsInfo in src:
            typings.append(src[JsInfo].declarations)

    return DefaultInfo(files = depset(transitive = typings))

_ts_typings = rule(
    _ts_typings_impl,
    attrs = {
        "srcs": attr.label_list(),
    },
)
