"""
Macros for building TypeScript projects in the style of our codebase. Along
with any related tests for the project.
"""

load("@aspect_rules_swc//swc:defs.bzl", _swc_compile = "swc_compile")
load("@aspect_rules_ts//ts:defs.bzl", _ts_project = "ts_project")
load("@aspect_rules_js//js:providers.bzl", "JsInfo")
load("@npm//:prettier/package_json.bzl", prettier_bin = "bin")
load("@npm//:eslint/package_json.bzl", eslint_bin = "bin")
load("@npm//:typescript/package_json.bzl", typescript_bin = "bin")
load("@npm//:jest/package_json.bzl", jest_bin = "bin")

def ts_project(
        name,
        srcs = None,
        test_srcs = None,
        lint_and_format_srcs = None,
        deps = [],
        test_deps = [],
        test_data = [],
        **kwargs):
    """
    Macro for creating a TypeScript project that implements some codebase conventions.

    Also creates rules for testing the TypeScript project.

    Args:
        name: The name of the project.
        srcs: Any sources for the project. Defaults to `**/*.{ts,tsx}`
        excluding `**/*.test.{ts,tsx}`.
        test_srcs: Any source files to generate test rules for. Defaults to `**/*.test.{ts,tsx}`.
        lint_and_format_srcs: Sources to run lint and format tests for. Defaults to all
        JavaScript, TypeScript, JSON, and Markdown files.
        deps: Any dependencies this project needs to run.
        test_deps: Any dependencies this project needs to run tests.
        test_data: Any data for this project that is only available in tests.
        **kwargs: Arguments that will be forwarded to `ts_project()` from `aspect_rules_ts`.
    """

    if srcs == None:
        srcs = native.glob(
            ["**/*.ts", "**/*.tsx"],
            exclude = ["**/*.test.ts", "**/*.test.tsx"],
        )

    if test_srcs == None:
        test_srcs = native.glob(["**/*.test.ts", "**/*.test.tsx"])

    _ts_project(
        name = name,
        srcs = srcs,
        deps = deps,
        tsconfig = "//:tsconfig",
        transpiler = swc_compile,
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

    if len(test_srcs) > 0:
        ts_typecheck_test(
            name = "{}_tests_typecheck_test".format(name),
            srcs = test_srcs,
            deps = [
                name,
                "//:node_modules/@types/jest",
                "//:node_modules/@types/testing-library__jest-dom",
                "//:node_modules/@testing-library/jest-dom",
            ] + test_deps,
        )

        for test_src in test_srcs:
            if not test_src.endswith(".test.ts") and not test_src.endswith(".test.tsx"):
                fail("test source must end in `.test.{ts,tsx}`")

            test_src_js = "{}.js".format(test_src[:len(test_src) - 4] if test_src.endswith(".test.tsx") else test_src[:len(test_src) - 3])
            test_name = "{}_test".format(test_src_js[:len(test_src_js) - 8])

            swc_compile(
                name = "{}_src".format(test_name),
                srcs = [test_src],
                js_outs = [test_src_js],
            )

            jest_bin.jest_test(
                name = test_name,
                args = [
                    # https://jestjs.io/docs/cli#--cache: Whether to use the cache. Defaults to
                    # true. Disable the cache using `--no-cache`. Caching is Bazel's job, we don't
                    # want non-hermeticity.
                    "--no-cache",
                    # https://jestjs.io/docs/cli#--watchman: Whether to use watchman for file
                    # crawling. Defaults to true. Disable using `--no-watchman`. Watching is
                    # `ibazel`'s job
                    "--no-watchman",
                    # https://jestjs.io/docs/cli#--ci: When this option is provided, Jest will
                    # assume it is running in a CI environment. This changes the behavior when a new
                    # snapshot is encountered. Instead of the regular behavior of storing a new
                    # snapshot automatically, it will fail the test and require Jest to be run with
                    # `--updateSnapshot`.
                    "--ci",
                    # https://jestjs.io/docs/cli#--runinband: We only run a single test with this
                    # command so run all tests serially in the current process instead of creating a
                    # worker pool to simplify things.
                    "--runInBand",
                    # Always use colors. Bazel will clear colors when necessary.
                    "--colors",
                    # Use our custom Jest config.
                    "--config",
                    "jest.config.js",
                    # Each test run is only for a single file.
                    "{}/{}".format(native.package_name(), test_src_js),
                ],
                data = _dedupe_labels(deps + test_deps + test_data + [
                                          "//:node_modules/@juggle/resize-observer",
                                          "//:node_modules/@testing-library/jest-dom",
                                          "//:node_modules/@types/jest",
                                          "//:node_modules/@types/testing-library__jest-dom",
                                          "//:node_modules/jest-environment-jsdom",
                                          "//:node_modules/node-fetch",
                                          "//:jest_config_file",
                                          "//admin/jest:jest_config_files",
                                          "{}_src".format(test_name),
                                          "{}_transpile".format(name),
                                      ] +
                                      # Will include a snapshot file if it exists.
                                      native.glob(["{}.snap".format(test_src_js[:len(test_src_js) - 3])])),
                size = "small",
            )

def swc_compile(**kwargs):
    kwargs["map_outs"] = ["{}.map".format(js_out) for js_out in kwargs["js_outs"]]
    kwargs["source_maps"] = "true"
    return _swc_compile(
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

    if srcs == None:
        srcs = native.glob([
            "**/*.js",
            "**/*.jsx",
            "**/*.ts",
            "**/*.tsx",
            "**/*.mjs",
            "**/*.json",
            "**/*.md",
        ])

    if len(srcs) == 0:
        return

    prettier_bin.prettier_test(
        name = "{}_format_test".format(name),
        args = ["--check", native.package_name()],
        copy_data_to_bin = False,
        data = _dedupe_labels(srcs + [
            "//:prettier.config.js",
            "//:.prettierignore",
        ]),
        size = "small",
        tags = ["format"],
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
            "//:node_modules/eslint-plugin-playwright",
            "//:node_modules/eslint-plugin-testing-library",
            "//:node_modules/react",
            "//:node_modules/typescript",
            "//:.eslintrc.js",
            "//:.eslintignore",
            "//:package.json",
            "//:tsconfig.json",
            "//admin/eslint:eslint_custom_rules",
            # Include the type information of our dependencies since we use type-aware
            # lint rules.
            ":{}_deps_typings".format(name),
        ]),
        size = "small",
        tags = ["lint"],
    )

def ts_typecheck_test(
        name,
        srcs,
        deps):
    """
    A test that runs type checking for the provided sources.

    Args:
        name: The name of the test. Should end with `_test`.
        srcs: The TypeScript source files we're type checking.
        deps: Dependencies of the TypeScript files we're type checking.
    """

    if not name.endswith("_test"):
        fail("test rule name must end with `_test`")

    workspace_relative_path = "." if native.package_name() == "" else "/".join([".." for segment in native.package_name().split("/")])

    native.genrule(
        name = "{}_tsconfig".format(name),
        outs = ["{}_tsconfig.json".format(name)],
        srcs = ["//:tsconfig.bazel.json"] + srcs,
        cmd = """\
cat <<EOF >> $@
{{
    "extends": "{base_tsconfig_path}",
    "compilerOptions": {{"noEmit": true}},
    "include": [{include_paths}]
}}
EOF
""".format(
            base_tsconfig_path = "{}/tsconfig.bazel.json".format(workspace_relative_path),
            include_paths = ", ".join(["\"{}\"".format(src) for src in srcs]),
        ),
    )

    _ts_typings(
        name = "{}_deps_typings".format(name),
        srcs = deps,
    )

    typescript_bin.tsc_test(
        name = name,
        args = ["--project", "$(location :{}_tsconfig)".format(name)],
        data = srcs + deps + [
            "//:tsconfig_files",
            ":{}_tsconfig".format(name),
            ":{}_deps_typings".format(name),
        ],
        size = "small",
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
            typings.append(src[JsInfo].transitive_declarations)

    return DefaultInfo(files = depset(transitive = typings))

_ts_typings = rule(
    _ts_typings_impl,
    attrs = {
        "srcs": attr.label_list(),
    },
)
