"""
Macros for building TypeScript projects in the style of our codebase. Along
with any related tests for the project.
"""

load("@aspect_rules_swc//swc:defs.bzl", _swc = "swc", _swc_compile = "swc_compile")
load("@aspect_rules_ts//ts:defs.bzl", _ts_project = "ts_project")
load("@aspect_rules_js//js:defs.bzl", "js_test")
load("@aspect_rules_js//js:providers.bzl", "JsInfo")
load("@aspect_rules_js//npm:providers.bzl", "NpmPackageStoreInfo")
load("@bazel_skylib//lib:partial.bzl", "partial")
load("@npm//:prettier/package_json.bzl", prettier_bin = "bin")
load("@npm//:typescript/package_json.bzl", typescript_bin = "bin")
load("@npm//:jest/package_json.bzl", jest_bin = "bin")

def ts_project(
        name,
        srcs = None,
        test_srcs = None,
        lint_and_format_srcs = None,
        deps = [],
        data = [],
        test_deps = [],
        test_data = [],
        tests = {},
        visibility = [],
        module = "es6",
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
        data: Any data this project needs at runtime in its runfiles.
        test_deps: Any dependencies this project needs to run tests.
        test_data: Any data for this project that is only available in tests.
        tests: Provide extra arguments to individual tests. Keyed by test label.
        visibility: Controls who may depend on your target.
        module: Do the built JavaScript files use the ES6 or CommonJS module system?
        **kwargs: Arguments that will be forwarded to `ts_project()` from `aspect_rules_ts`.
    """

    if srcs == None:
        srcs = native.glob(
            ["**/*.ts", "**/*.tsx"],
            exclude = ["**/*.test.ts", "**/*.test.tsx"],
            allow_empty = True,
        )

    if test_srcs == None:
        test_srcs = native.glob(
            ["**/*.test.ts", "**/*.test.tsx"],
            allow_empty = True,
        )

    tags = kwargs.pop("tags", default = [])

    if module != "es6" and module != "commonjs":
        fail("unrecognized module format `{}`".format(module))

    _ts_project(
        name = name,
        # Our global type definition files need to be available to all `ts_project()`s so type checking
        # works across all our typescript files.
        srcs = ["//:global_types_files"] + srcs,
        deps = deps,
        # All `ts_project()`s take `package_light.json` as a runtime dependency (which
        # is `package.json` in the build tree). We need this runtime dependency since
        # it has `{"type": "module"}` which is necessary for Node.js to interpret
        # transpiled `.js` files as ES Modules.
        data = ["//:package_light_json_file"] + data,
        tsconfig = "//:tsconfig",
        transpiler = partial.make(swc, module = module),
        declaration = True,
        resolve_json_module = True,
        allow_js = True,
        # Bazel Workers are currently incompatible with TypeScript v5. We should
        # re-enable this once `rules_ts` is fixed. It's fine to not use workers for
        # type checking since it's out of the critical dev path.
        # https://github.com/aspect-build/rules_ts/issues/361
        supports_workers = 0,
        tags = ["typescript", "dev-check"] + tags,
        # `ts_project()`s are all visible to the `//admin/typescript/workspace` package
        # which runs tests against all TypeScript files in the repository.
        visibility =
            (["//admin/typescript/workspace:__pkg__"] if not ("//visibility:public" in visibility) else []) +
            visibility,
        **kwargs
    )

    ts_lint_and_format_test(
        name = name,
        srcs = lint_and_format_srcs,
        deps = deps,
        tags = tags,
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
            tags = tags,
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

            extra_kwargs = tests[test_name] if test_name in tests else {}
            extra_tags = extra_kwargs.pop("tags", default = [])
            extra_node_options = extra_kwargs.pop("node_options", default = [])
            extra_data = extra_kwargs.pop("data", default = [])

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
                    "jest.config.cjs",
                    # Each test run is only for a single file.
                    "{}/{}".format(native.package_name(), test_src_js),
                ],
                node_options = [
                    # Enable Node.js and Jest's experimental ES Modules support.
                    # https://jestjs.io/docs/ecmascript-modules
                    "--experimental-vm-modules",
                ] + extra_node_options,
                data = _dedupe_labels(
                    deps + data + test_deps + test_data + extra_data + [
                        "//:node_modules/@juggle/resize-observer",
                        "//:node_modules/@testing-library/jest-dom",
                        "//:node_modules/@types/jest",
                        "//:node_modules/@types/testing-library__jest-dom",
                        "//:node_modules/chalk",
                        "//:node_modules/jest-environment-jsdom",
                        "//:jest_config_file",
                        "//:package_light_json_file",
                        "//admin/jest:jest_config_files",
                        "{}_src".format(test_name),
                        "{}_transpile".format(name),
                    ] +
                    # Will include a snapshot file if it exists.
                    native.glob(["{}.snap".format(test_src_js[:len(test_src_js) - 3])], allow_empty = True),
                ),
                # Don't copy `test_data` to bin. Otherwise we'll have multiple actions
                # generating conflicting `test_data` copies.
                no_copy_to_bin = test_data,
                size = extra_kwargs.pop("size", default = "small"),
                tags = ["jest", "dev-test"] + extra_tags + tags,
                **extra_kwargs
            )

_SWC_ES6_KWARGS = {
    "swcrc": "//admin/typescript:typescript_swc_es6_config",
    "source_maps": True,
}

_SWC_COMMONJS_KWARGS = {
    "swcrc": "//admin/typescript:typescript_swc_commonjs_config",
    "source_maps": True,
}

def swc(module = "es6", **kwargs):
    """
    Macro that compiles TypeScript source files using SWC.

    Args:
        module: The module system to use for the compiled JavaScript files.
        **kwargs: Arguments to forward to the underlying `swc()` macro.

    Returns:
        The result of the underlying `swc()` macro.
    """

    if module == "commonjs":
        kwargs.update(**_SWC_COMMONJS_KWARGS)
    else:
        kwargs.update(**_SWC_ES6_KWARGS)

    # Always generate source maps
    kwargs["source_maps"] = True

    # Make sure the base directory is available to `swc_compile()`
    kwargs["build_srcs"] = ["//admin/typescript:base"] + kwargs.get("build_srcs", [])

    return _swc(**kwargs)

def swc_compile(**kwargs):
    """
    Macro that compiles TypeScript source files using SWC.

    Args:
        **kwargs: Arguments to forward to the underlying `swc_compile()` macro.

    Returns:
        The result of the underlying `swc_compile()` macro.
    """

    kwargs.update(**_SWC_ES6_KWARGS)

    # Needs to be a string before passing into `swc_compile()`
    kwargs["source_maps"] = "true"

    # Make sure the base directory is available to `swc_compile()`
    kwargs["build_srcs"] = ["//admin/typescript:base"] + kwargs.get("build_srcs", [])

    # Make sure the outputs use the extension `.js`
    kwargs["default_ext"] = ".js"

    # We need to define `map_outs` manually when setting `source_maps` to `True`
    kwargs["map_outs"] = ["{}.map".format(js_out) for js_out in kwargs["js_outs"]]

    return _swc_compile(**kwargs)

def ts_lint_and_format_test(
        name,
        srcs = None,
        deps = [],
        tags = []):
    """
    Macro that creates tests that will lint and format the provided sources.

    Args:
        name: The name to derive our test names from.
        srcs: The files to lint and check formatting of.
        deps: Any dependencies of these source files. Needed since linting also
        performs type checking.
        tags: Additional tags to add to the tests.
    """

    if srcs == None:
        srcs = native.glob([
            "**/*.js",
            "**/*.jsx",
            "**/*.ts",
            "**/*.tsx",
            "**/*.cts",
            "**/*.mts",
            "**/*.mjs",
            "**/*.cjs",
            "**/*.json",
            "**/*.md",
            "**/*.html",
            "**/*.hbs",
        ], allow_empty = True)

    if len(srcs) == 0:
        return

    prettier_bin.prettier_test(
        name = "{}_format_test".format(name),
        args = ["--check", native.package_name()],
        copy_data_to_bin = False,
        data = _dedupe_labels(srcs + [
            "//:prettier_config_files",
        ]),
        size = "small",
        tags = ["prettier", "dev-check"] + tags,
    )

    _ts_typings(
        name = "{}_deps_typings".format(name),
        srcs = deps,
        testonly = True,
    )

    lint_srcs = [
        src
        for src in srcs
        if src.endswith(".js") or src.endswith(".jsx") or
           src.endswith(".ts") or src.endswith(".tsx") or
           src.endswith(".cts") or src.endswith(".mts") or
           src.endswith(".mjs") or src.endswith(".cjs")
    ]

    if len(lint_srcs) > 0:
        js_test(
            name = "{}_lint_test".format(name),
            args = [
                "{}{}".format(
                    "{}/".format(native.package_name()) if native.package_name() != "" else "",
                    src.replace("$", "$$"),
                )
                for src in lint_srcs
            ],
            env = {
                "NODE_ENV": "test",
                # Make sure `chalk` (used by ESLint) always renders colors. Bazel will strip
                # Ansi codes when appropriate.
                "FORCE_COLOR": "1",
            },
            node_options = ["--no-deprecation"],
            entry_point = "//admin/eslint:eslint_test_file",
            data = _dedupe_labels(lint_srcs + [
                "//:node_modules/@remix-run/eslint-config",
                "//:node_modules/@typescript-eslint/eslint-plugin",
                "//:node_modules/eslint",
                "//:node_modules/eslint-plugin-cyberworlds",
                "//:node_modules/eslint-plugin-jest",
                "//:node_modules/eslint-plugin-jest-dom",
                "//:node_modules/eslint-plugin-playwright",
                "//:node_modules/eslint-plugin-react-compiler",
                "//:node_modules/eslint-plugin-react-refresh",
                "//:node_modules/eslint-plugin-testing-library",
                "//:node_modules/react",
                "//:node_modules/typescript",
                "//:package_light_json_file",
                "//:tsconfig_files",
                "//:eslint_config_files",
            ]),
            size = "small",
            tags = ["eslint", "dev-check"] + tags,
        )

def ts_typecheck_test(
        name,
        srcs,
        deps,
        tags = []):
    """
    A test that runs type checking for the provided sources.

    Args:
        name: The name of the test. Should end with `_test`.
        srcs: The TypeScript source files we're type checking.
        deps: Dependencies of the TypeScript files we're type checking.
        tags: Additional tags to add to the test
    """

    if not name.endswith("_test"):
        fail("test rule name must end with `_test`")

    workspace_relative_path = "." if native.package_name() == "" else "/".join([".." for segment in native.package_name().split("/")])

    native.genrule(
        name = "{}_tsconfig".format(name),
        outs = ["{}_tsconfig.json".format(name)],
        srcs = ["//:tsconfig.bazel.json"] + srcs,
        testonly = True,
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
        tags = ["typescript"],
    )

    _ts_typings(
        name = "{}_deps_typings".format(name),
        srcs = deps,
        testonly = True,
        tags = ["typescript"],
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
        tags = ["typescript", "dev-check"] + tags,
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
            typings.append(src[JsInfo].transitive_types)
            typings.append(src[JsInfo].npm_sources)

        if NpmPackageStoreInfo in src:
            typings.append(src[NpmPackageStoreInfo].transitive_files)

    return DefaultInfo(files = depset(transitive = typings))

_ts_typings = rule(
    _ts_typings_impl,
    attrs = {
        "srcs": attr.label_list(),
    },
)
