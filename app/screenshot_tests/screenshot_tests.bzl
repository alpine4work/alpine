load("@aspect_rules_js//js:defs.bzl", "js_binary", "js_test")

def _strip_suffix(value, suffix):
    if not value.endswith(suffix):
        fail("Expected %s to end with %s" % (value, suffix))
    return value[: -len(suffix)]

def screenshot_tests():
    common_data = [
        ":screenshot_tests_lib",
        ":screenshots",
        "//server/helpers/node",
        "//admin/environment/test/integration:integration_data",
        "@playwright_browsers//:browsers",
    ]

    common_env = {
        "NODE_ENV": "test",
        "DEBUG": "admin/environment/*,app/screenshot_tests/*",
        # Always use ANSI colors. Bazel will be responsible for stripping ANSI color
        # sequences when needed.
        "DEBUG_COLORS": "1",
        "PLAYWRIGHT_BROWSERS_PATH": "$(rootpath @playwright_browsers//:browsers)",
    }

    node_options = [
        "--import",
        "./server/helpers/node/register_noop_react_refresh.js",
    ]

    js_binary(
        name = "screenshot_tests",
        args = ["update"],
        data = common_data,
        entry_point = "helpers/run_all_screenshot_tests.js",
        env = common_env,
        node_options = node_options,
        no_copy_to_bin = ["@playwright_browsers//:browsers"],
        testonly = True,
    )

    js_binary(
        name = "screenshot_tests_preview",
        args = ["preview"],
        data = common_data,
        entry_point = "helpers/run_all_screenshot_tests.js",
        env = common_env,
        node_options = node_options,
        no_copy_to_bin = ["@playwright_browsers//:browsers"],
        testonly = True,
    )

    native.alias(
        name = "preview",
        actual = "screenshot_tests_preview",
    )

    test_srcs = native.glob(["*_screenshot_test.ts"])

    for src in test_srcs:
        base = src.rsplit("/", 1)[-1]
        base = _strip_suffix(base, ".ts")
        if not base.endswith("_screenshot_test"):
            fail("Screenshot test file name must end with _screenshot_test.ts: %s" % src)

        test_name = _strip_suffix(base, "_screenshot_test")

        js_test(
            name = "{}_screenshot_test".format(test_name),
            args = [test_name, "compare"],
            data = common_data,
            entry_point = "helpers/run_one_screenshot_test.js",
            env = common_env,
            node_options = node_options,
            no_copy_to_bin = ["@playwright_browsers//:browsers"],
            tags = [
                "playwright",
                "screenshot_test",
                # Playwright tests are chunky, increase CPU requirements to reduce parallelism
                # while one is running. We need CPU to run all our databases, services, and the
                # browser.
                #
                # CPU requirement of 4 so two Playwright tests can run in parallel in CI given
                # our CI runners have 8 cores.
                "cpu:4",
            ],
            # End-to-end tests are considered to be large sized.
            # https://bazel.build/reference/be/common-definitions
            size = "large",
            # Retry the test up to three times, marking it as failed only if it fails
            # each time.
            flaky = True,
        )

        js_binary(
            name = "{}_screenshot_update".format(test_name),
            data = common_data,
            args = [test_name, "update"],
            entry_point = "helpers/run_one_screenshot_test.js",
            env = common_env,
            node_options = node_options,
            no_copy_to_bin = ["@playwright_browsers//:browsers"],
            testonly = True,
        )

        js_binary(
            name = "{}_screenshot_preview".format(test_name),
            data = common_data,
            args = [test_name, "preview"],
            entry_point = "helpers/run_one_screenshot_test.js",
            env = common_env,
            node_options = node_options,
            no_copy_to_bin = ["@playwright_browsers//:browsers"],
            testonly = True,
        )

        native.alias(
            name = test_name,
            actual = "{}_screenshot_update".format(test_name),
        )

        native.alias(
            name = "{}_preview".format(test_name),
            actual = "{}_screenshot_preview".format(test_name),
        )
