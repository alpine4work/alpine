"""
Rules for generating Playwright tests.
"""

load("@npm//:@playwright/test/package_json.bzl", "bin")
load("//admin/typescript:typescript.bzl", "swc_compile", "ts_lint_and_format_test", "ts_project", "ts_typecheck_test")

def ts_playwright_tests(
        name,
        srcs = None,
        lib_srcs = None,
        deps = [],
        data = [],
        node_options = [],
        skip_projects_by_src = {}):
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
        skip_projects_by_src: Skip projects for specified source files. Can not
        skip Chromium.
    """

    if srcs == None:
        srcs = native.glob(["**/*.spec.ts", "**/*.spec.tsx"], allow_empty = True)

    if lib_srcs == None:
        lib_srcs = native.glob(
            ["**/*.ts", "**/*.tsx"],
            exclude = ["**/*.spec.ts", "**/*.spec.tsx"],
            allow_empty = True,
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
            testonly = True,
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
            name = src[:len(src) - 9] if src.endswith(".spec.tsx") else src[:len(src) - 8],
            src = src,
            deps = deps,
            data = data,
            node_options = node_options,
            skip_projects = skip_projects_by_src[src] if src in skip_projects_by_src else [],
        )

def playwright_test(
        name,
        src,
        deps = [],
        data = [],
        node_options = [],
        skip_projects = []):
    """
    Generate Playwright test rules for the provided source file.

    We generate one Playwright test rule for each platform we run tests on. So
    Chromium, Firefox, WebKit desktop, and WebKit mobile.

    Args:
        name: The base name of the test.
        src: The test source file.
        deps: Dependencies the test needs to run.
        data: Data to be made available at runtime in runfiles.
        node_options: Extra options to pass to Node.js.
        skip_projects: Projects to skip when running this test. Can not skip Chromium.
    """

    if not src.endswith(".spec.ts") and not src.endswith(".spec.tsx"):
        fail("test source must end in `.spec.{ts,tsx}`")

    # Extract directory name from src path to use as a tag
    directory_tag = "playwright_" + (src.split("/")[0] if "/" in src else "root")

    src_js = "{}.js".format(src[:len(src) - 4] if src.endswith(".spec.tsx") else src[:len(src) - 3])

    swc_compile(
        name = "{}_src".format(name),
        srcs = [src],
        js_outs = [src_js],
    )

    bin.playwright_binary(
        name = "{}_bin".format(name),
        data = [
            "{}_src".format(name),
            "//:node_modules/chalk",
            "//admin/jest:jest_config_files",
            "//admin/playwright:playwright_setup_file",
        ] + deps + data,
        # Don't copy `data` to bin. It's only used at runtime in runfiles which combine
        # the build tree and source tree anyways.
        no_copy_to_bin = data,
        node_options = node_options + [
            # Use the same Jest setup scripts to setup our environment for Playwright tests.
            "--require=./admin/jest/jest_setup_shared.cjs",
            "--require=./admin/jest/jest_setup_server.cjs",
            "--import=./admin/playwright/playwright_setup.mjs",
        ],
        testonly = True,
        # On by default to workaround a bug with `.mjs` entrypoints. We observe this
        # causes an issue where two copies of `@playwright/test` are imported. We don't
        # want to preserve symlinks, since Playwright uses a CommonJS entrypoint we can
        # safely disable.
        # https://docs-legacy.aspect.build/aspect-build/rules_js/v1.0.0/docs/js_binary-docgen.html#js_binary-preserve_symlinks_main
        preserve_symlinks_main = False,
    )

    # Alias that defaults to running our Chromium test for the file.
    native.test_suite(
        name = "{}_test".format(name),
        tests = ["{}_chromium_test".format(name)],
    )

    # Alias that runs all platforms for this test file.
    native.test_suite(
        name = "{}_all_tests".format(name),
        tests =
            ["{}_chromium_test".format(name)] +
            (["{}_firefox_test".format(name)] if not ("firefox" in skip_projects) else []) +
            (["{}_webkit_desktop_test".format(name)] if not ("webkit_desktop" in skip_projects) else []) +
            (["{}_webkit_mobile_test".format(name)] if not ("webkit_mobile" in skip_projects) else []),
        # Contains manual tests so must be manually invoked instead of running as a
        # part of `bazel test //...`.
        tags = ["manual"],
    )

    _playwright_project_test(
        name = name,
        project = "chromium",
        tags = [directory_tag],
    )

    if not ("firefox" in skip_projects):
        _playwright_project_test(
            name = name,
            project = "firefox",
            # Don't run as a part of `bazel test //...`. This means the test won't run in
            # CI. To save time and reduce flakes, we only run integration tests on the
            # browsers we focus support on. (Chrome and Safari Mobile.)
            tags = ["manual", directory_tag],
        )

    if not ("webkit_desktop" in skip_projects):
        _playwright_project_test(
            name = name,
            project = "webkit_desktop",
            # Don't run as a part of `bazel test //...`. This means the test won't run in
            # CI. To save time and reduce flakes, we only run integration tests on the
            # browsers we focus support on. (Chrome and Safari Mobile.)
            tags = ["manual", directory_tag],
        )

    if not ("webkit_mobile" in skip_projects):
        _playwright_project_test(
            name = name,
            project = "webkit_mobile",
            tags = [directory_tag],
        )

def _playwright_project_test(
        name,
        project,
        tags = []):
    native.sh_test(
        name = "{}_{}_test".format(name, project),
        srcs = ["//admin/playwright:playwright_test.sh"],
        data = [
            "@playwright_browsers//:browsers",
            "//:playwright_config_file",
            "{}_bin".format(name),
        ],
        env = {
            "NODE_ENV": "test",
            "PLAYWRIGHT_BIN": "$(location {}_bin)".format(name),
            "PLAYWRIGHT_BROWSERS_PATH": "$(location @playwright_browsers//:browsers)",
            "PLAYWRIGHT_CONFIG_PATH": "$(location //:playwright_config_file)",
            # Each test only runs a single file and Bazel will run them in parallel. For
            # whatever reason when we include the extension Playwright can't find the file?
            "PLAYWRIGHT_TEST_PATH": "{}/{}.spec".format(native.package_name(), name),
            "PLAYWRIGHT_PROJECT": project,
            # We transform all our code through Bazel. Disable Playwright code
            # transformations. Since Playwright code transformations slow us down and mess
            # with source maps.
            #
            # We add support for `PLAYWRIGHT_DISABLE_TRANSFORMS` in a patch.
            "PLAYWRIGHT_DISABLE_TRANSFORMS": "true",
            # Bazel will strip colors when necessary.
            "FORCE_COLOR": "true",
        },
        tags = tags + [
                   "playwright",
                   # Playwright tests are chunky, increase CPU requirements to reduce parallelism
                   # while one is running. We need CPU to run all our databases, services, and the
                   # browser.
                   #
                   # CPU requirement of 4 so two Playwright tests can run in parallel in CI given
                   # our CI runners have 8 cores.
                   "cpu:4",
               ] +
               # Firefox creates sandboxes for web content and you can't nest sandboxes. So
               # disable the Bazel sandbox. Ideally we would disable Firefox's sandboxing at
               # runtime and have the entire Firefox process run in the Bazel sandbox but it's
               # unclear if that's possible. Or if the Bazel sandbox is as strong as the
               # Firefox sandbox.
               #
               # See: https://bugzilla.mozilla.org/show_bug.cgi?id=1415159
               (["no-sandbox"] if project == "firefox" else []),
        # End-to-end tests are considered to be large sized.
        # https://bazel.build/reference/be/common-definitions
        size = "large",
        # Retry the test up to three times, marking it as failed only if it fails
        # each time.
        flaky = True,
    )

    native.sh_binary(
        name = "{}_{}_test_show_trace".format(name, project),
        srcs = ["//admin/playwright:playwright_test_show_trace.sh"],
        data = [
            "{}_bin".format(name),
        ],
        env = {
            "PLAYWRIGHT_BIN": "$(location {}_bin)".format(name),
            "TEST_PACKAGE_NAME": native.package_name(),
            "TEST_TARGET_NAME": "{}_{}_test".format(name, project),
        },
        testonly = True,
    )
