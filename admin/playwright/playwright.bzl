load("@npm//:@playwright/test/package_json.bzl", "bin")
load("//admin/typescript:typescript.bzl", "swc_transpiler")

def playwright_test(test_src):
    if not test_src.endswith(".test.ts") and not test_src.endswith(".test.tsx"):
        fail("test source must end in `.test.{ts,tsx}`")

    test_src_js = "{}.js".format(test_src[:len(test_src) - 4] if test_src.endswith(".test.tsx") else test_src[:len(test_src) - 3])
    test_base_name = test_src_js[:len(test_src_js) - 8]

    swc_transpiler(
        name = "{}_test_src".format(test_base_name),
        srcs = [test_src],
        js_outs = [test_src_js],
    )

    shared_args = [
        "test",
        # Use our custom Playwright config.
        "--config",
        "playwright.config.js",
        # Disable parallelism. Bazel is responsible for running tests in parallel.
        "--workers",
        "1",
        # Each test only runs a single file and Bazel will run them in parallel. For
        # whatever reason when we include the extension Playwright can't find the file?
        "{}/{}.test".format(native.package_name(), test_base_name),
    ]

    data = [
        "@playwright_browsers//:browsers",
        "//:node_modules/@playwright/test",
        "//:playwright_config_file",
        "{}_test_src".format(test_base_name),
    ]

    env = {
        # Bazel will strip colors when necessary.
        "FORCE_COLOR": "true",
        "PLAYWRIGHT_BROWSERS_PATH": "$(location @playwright_browsers//:browsers)",
    }

    bin.playwright_test(
        name = "{}_chromium_test".format(test_base_name),
        args = shared_args + [
            "--project",
            "chromium",
        ],
        data = data,
        copy_data_to_bin = False,
        env = env,
    )

    bin.playwright_test(
        name = "{}_firefox_test".format(test_base_name),
        args = shared_args + [
            "--project",
            "firefox",
        ],
        data = data,
        copy_data_to_bin = False,
        env = env,
        # Firefox creates sandboxes for web content and you can't nest sandboxes. So
        # disable the Bazel sandbox. Ideally we would disable Firefox's sandboxing at
        # runtime and have the entire Firefox process run in the Bazel sandbox but it's
        # unclear if that's possible. Or if the Bazel sandbox is as strong as the
        # Firefox sandbox.
        #
        # See: https://bugzilla.mozilla.org/show_bug.cgi?id=1415159
        tags = ["no-sandbox"],
    )

    bin.playwright_test(
        name = "{}_webkit_desktop_test".format(test_base_name),
        args = shared_args + [
            "--project",
            "webkit_desktop",
        ],
        data = data,
        copy_data_to_bin = False,
        env = env,
    )

    bin.playwright_test(
        name = "{}_webkit_mobile_test".format(test_base_name),
        args = shared_args + [
            "--project",
            "webkit_mobile",
        ],
        data = data,
        copy_data_to_bin = False,
        env = env,
    )
