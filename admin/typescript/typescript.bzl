"""
Macros for building TypeScript projects in the style of our codebase. Along
with any related tests for the project.
"""

load("@aspect_rules_swc//swc:defs.bzl", "swc_transpiler")
load("@aspect_rules_ts//ts:defs.bzl", _ts_project = "ts_project")
load("@aspect_rules_js//js:providers.bzl", "JsInfo")
load("@npm//:prettier/package_json.bzl", prettier_bin = "bin")
load("@npm//:eslint/package_json.bzl", eslint_bin = "bin")

def ts_project(
        name,
        srcs = None,
        lint_and_format_srcs = None,
        deps = None,
        **kwargs):
    """
    Macro for creating a TypeScript project that implements some codebase conventions.

    Also creates rules for testing the TypeScript project.

    Args:
        name: The name of the project.
        srcs: Any sources for the project. Defaults to `ts_glob(["**/*"])`.
        lint_and_format_srcs: Sources to run lint and format tests for. Defaults to all
        JavaScript, TypeScript, JSON, and Markdown files.
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
        deps = deps,
        tsconfig = "//:tsconfig",
        transpiler = _swc_transpiler,
        declaration = True,
        resolve_json_module = True,
        allow_js = True,
        **kwargs
    )

    ts_lint_and_format_test(
        name = name,
        srcs = lint_and_format_srcs,
        deps = deps,
    )

def ts_glob(include, exclude = []):
    """
    `glob()` but with all the supported TypeScript file extensions.

    Also excludes test files.

    Args:
        include: Globs paths to include. Don't add a file extension, file
        extensions will be added by the macro.
        exclude: Glob paths to exclude. This list will not be modified,
        include file extensions.

    Returns:
        A list of files matching the glob.
    """

    actual_include = []
    actual_exclude = [path for path in exclude]

    for path in include:
        actual_include.append("{}.ts".format(path))
        actual_include.append("{}.tsx".format(path))

        actual_exclude.append("{}.test.ts".format(path))
        actual_exclude.append("{}.test.tsx".format(path))

    return native.glob(actual_include, exclude = actual_exclude)

def _swc_transpiler(**kwargs):
    return swc_transpiler(
        swcrc = "//admin/typescript:typescript_swc_config",
        **kwargs
    )

def ts_lint_and_format_test(
        name,
        srcs = None,
        deps = []):
    """
    Macro that creates tests that will lint and format the provided sources.

    Args:
        name: The name to derive our test names from.
        srcs: The files to lint and check formatting of.
        deps: Any dependencies of these source files. Needed since linting also
        performs type checking.
    """

    if not srcs:
        srcs = native.glob([
            "**/*.js",
            "**/*.jsx",
            "**/*.ts",
            "**/*.tsx",
            "**/*.mjs",
            "**/*.json",
            "**/*.md",
        ])

    prettier_bin.prettier_test(
        name = "{}_format_test".format(name),
        args = ["--check"] + [src.replace("$", "$$") for src in srcs],
        chdir = native.package_name(),
        copy_data_to_bin = False,
        data = _dedupe_labels(srcs + [
            "//:prettier.config.js",
            "//:.prettierignore",
        ]),
    )

    _ts_typings(
        name = "{}_deps_typings".format(name),
        srcs = deps,
    )

    eslint_bin.eslint_test(
        name = "{}_lint_test".format(name),
        args = [
            "--rulesdir",
            "{}/admin/eslint/rules".format("." if native.package_name() == "" else "/".join([".." for segment in native.package_name().split("/")])),
            "--max-warnings",
            "0",
            # Bazel will strip color if necessary.
            "--color",
        ] + [src.replace("$", "$$") for src in srcs if src.endswith(".js") or src.endswith(".jsx") or src.endswith(".ts") or src.endswith(".tsx") or src.endswith(".mjs")],
        chdir = native.package_name(),
        copy_data_to_bin = False,
        data = _dedupe_labels(srcs + [
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
        ]),
    )

def _dedupe_labels(labels):
    return {_normalize_label(label): None for label in labels}.keys()

def _normalize_label(label):
    if label.startswith("//") or label.startswith("@"):
        return label

    if label.startswith(":"):
        return "//{}{}".format(native.package_name(), label)

    return "//{}:{}".format(native.package_name(), label)

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
