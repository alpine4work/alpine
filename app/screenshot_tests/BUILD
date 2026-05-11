load("@aspect_rules_js//js:defs.bzl", "js_binary")
load("//admin/typescript:typescript.bzl", "ts_project")
load(":screenshot_tests.bzl", "screenshot_tests")

filegroup(
    name = "screenshots",
    srcs = glob(["screenshots/**"], allow_empty = True),
)

ts_project(
    name = "screenshot_tests_lib",
    testonly = True,
    data = ["//admin/scenarios:fixtures"],
    deps = [
        "//:node_modules/@internationalized/date",
        "//:node_modules/@playwright/test",
        "//:node_modules/@types/mustache",
        "//:node_modules/cookie",
        "//:node_modules/fast-glob",
        "//:node_modules/looks-same",
        "//:node_modules/mustache",
        "//:node_modules/playwright",
        "//admin/environment/demo_space",
        "//admin/environment/test/integration",
        "//admin/helpers",
        "//client/web/styles",
        "//server/accounts",
        "//server/bots",
        "//server/chat/test_helpers",
        "//server/documents/test_helpers",
        "//server/files/test_helpers",
        "//server/forum/test_helpers",
        "//server/helpers/node",
        "//server/search/data/table",
        "//server/spaces/create",
        "//server/spaces/test_helpers",
        "//server/tasks/test_helpers",
        "//server/tokens",
        "//shared/accounts",
        "//shared/avatar/protocol",
        "//shared/content",
        "//shared/documents",
        "//shared/error",
        "//shared/feed",
        "//shared/files",
        "//shared/helpers",
        "//shared/id",
        "//shared/remix",
        "//shared/tracer",
    ],
)

screenshot_tests()

js_binary(
    name = "screenshot_tests_sync",
    data = [":screenshot_tests_lib"],
    entry_point = "screenshot_tests_sync_main.js",
    env = {"NODE_ENV": "development"},
    testonly = True,
)

alias(
    name = "sync",
    actual = "screenshot_tests_sync",
)
