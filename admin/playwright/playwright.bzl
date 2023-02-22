"""
Rules for generating Playwright tests.
"""

load("@npm//:@playwright/test/package_json.bzl", "bin")
load("//admin/typescript:typescript.bzl", "swc_transpiler", "ts_lint_and_format_test", "ts_project", "ts_typecheck_test")

def ts_playwright_tests(
        name,
        srcs = None,
        lib_srcs = None,
        deps = [],
        data = [],
        node_options = []):
    """
    Sets up Playwright tests for the provided test files.

    If no test files are provided we default to all test files in the
    current directory.

    Also sets up lint, format, and typechecking tests.

    Args:
        name: The base name of our Playwright tests.
        srcs: Sources to test. This defaults to all TypeScript test files in
        the package.
        lib_srcs: Sources of non-test helper files. This defaults to all
        TypeScript non-test files in the package.
        deps: Dependencies of the sources we're testing.
        data: Data to be made available through the file system at runtime.
        node_options: Extra options to pass to Node.js.
    """

    if srcs == None:
        srcs = native.glob(["**/*.spec.ts", "**/*.spec.tsx"])

    if lib_srcs == None:
        lib_srcs = native.glob(
            ["**/*.ts", "**/*.tsx"],
            exclude = ["**/*.spec.ts", "**/*.spec.tsx"],
        )

    deps = deps + [
        "//:node_modules/@playwright/test",
    ]

    ts_lint_and_format_test(
        name = name,
        deps = deps,
    )

    if len(lib_srcs) > 0:
        ts_project(
            name = "{}_lib".format(name),
            srcs = lib_srcs,
            test_srcs = [],
            # We lint and format everything with the above `ts_lint_and_format_test()`.
            lint_and_format_srcs = [],
            deps = deps,
        )

        deps = deps + [
            "{}_lib".format(name),
        ]

    ts_typecheck_test(
        name = "{}_typecheck_test".format(name),
        srcs = srcs,
        deps = deps,
    )

    for src in srcs:
        playwright_test(
            src = src,
            deps = deps,
            data = data,
            node_options = node_options,
        )

def playwright_test(
        src,
        deps = [],
        data = [],
        node_options = []):
    """
    Generate Playwright test rules for the provided source file.

    We generate one Playwright test rule for each platform we run tests on. So
    Chromium, Firefox, WebKit desktop, and WebKit mobile.

    Args:
        src: The test source file.
        deps: Dependencies the test needs to run.
        data: Data to be made available at runtime in runfiles.
        node_options: Extra options to pass to Node.js.
    """

    if not src.endswith(".spec.ts") and not src.endswith(".spec.tsx"):
        fail("test source must end in `.spec.{ts,tsx}`")

    src_js = "{}.js".format(src[:len(src) - 4] if src.endswith(".spec.tsx") else src[:len(src) - 3])
    base_name = src_js[:len(src_js) - 8]

    swc_transpiler(
        name = "{}_src".format(base_name),
        srcs = [src],
        js_outs = [src_js],
    )

    # Alias that defaults to running our Chromium test for the file.
    native.test_suite(
        name = "{}_test".format(base_name),
        tests = ["{}_chromium_test".format(base_name)],
    )

    _playwright_project_test(
        base_name = base_name,
        project = "chromium",
        deps = deps,
        data = data,
        node_options = node_options,
    )

    _playwright_project_test(
        base_name = base_name,
        project = "firefox",
        deps = deps,
        data = data,
        node_options = node_options,
    )

    _playwright_project_test(
        base_name = base_name,
        project = "webkit_desktop",
        deps = deps,
        data = data,
        node_options = node_options,
    )

    _playwright_project_test(
        base_name = base_name,
        project = "webkit_mobile",
        deps = deps,
        data = data,
        node_options = node_options,
    )

def _playwright_project_test(
        base_name,
        project,
        deps,
        data,
        node_options):
    workspace_relative_path = "." if native.package_name() == "" else "/".join([".." for segment in native.package_name().split("/")])

    name = "{}_{}_test".format(base_name, project)

    bin.playwright_test(
        name = name,
        args = [
            "test",
            # Each test only runs a single file and Bazel will run them in parallel. For
            # whatever reason when we include the extension Playwright can't find the file?
            "{}/{}.spec".format(native.package_name(), base_name),
            # Use our custom Playwright config.
            "--config",
            "playwright.config.js",
            # Write screenshots, videos, and traces taken by Playwright to Bazel's test
            # output directory. These files will be available in `bazel-testlogs`.
            #
            # Ideally we would use the `$TEST_UNDECLARED_OUTPUTS_DIR` environment variable
            # but we can't interpolate environment variables in this arg list. So instead
            # hardcode the contents of `$TEST_UNDECLARED_OUTPUTS_DIR`.
            "--output",
            "{}/../../../testlogs/{}/{}/test.outputs".format(workspace_relative_path, native.package_name(), name),
            # Disable parallelism. Bazel is responsible for running tests in parallel.
            "--workers",
            "1",
            # Only run one project per test.
            "--project",
            project,
        ],
        data = [
            "@playwright_browsers//:browsers",
            "//:playwright_config_file",
            "{}_src".format(base_name),
        ] + deps + data,
        copy_data_to_bin = False,
        env = {
            "NODE_ENV": "test",
            # Bazel will strip colors when necessary.
            "FORCE_COLOR": "true",
            "PLAYWRIGHT_BROWSERS_PATH": "$(location @playwright_browsers//:browsers)",
        },
        node_options = node_options,
        # Firefox creates sandboxes for web content and you can't nest sandboxes. So
        # disable the Bazel sandbox. Ideally we would disable Firefox's sandboxing at
        # runtime and have the entire Firefox process run in the Bazel sandbox but it's
        # unclear if that's possible. Or if the Bazel sandbox is as strong as the
        # Firefox sandbox.
        #
        # See: https://bugzilla.mozilla.org/show_bug.cgi?id=1415159
        tags = ["no-sandbox"] if project == "firefox" else [],
    )
