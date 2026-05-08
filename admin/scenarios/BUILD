load("@aspect_bazel_lib//lib:copy_to_bin.bzl", "copy_to_bin")
load("@aspect_rules_js//js:defs.bzl", "js_binary", "js_library")
load("//admin/typescript:typescript.bzl", "ts_project")

copy_to_bin(
    name = "fixtures",
    srcs = glob(
        ["fixtures/**"],
        exclude = ["fixtures/**/.*"],
    ),
    visibility = ["//app/screenshot_tests:__pkg__"],
)

ts_project(
    name = "scenarios_lib",
    data = [":fixtures"],
    visibility = ["//admin/scenarios:__subpackages__"],
    deps = [
        "//:node_modules/@inquirer/prompts",
        "//:node_modules/@internationalized/date",
        "//:node_modules/@types/mustache",
        "//:node_modules/chalk",
        "//:node_modules/cookie",
        "//:node_modules/gpt-tokenizer",
        "//:node_modules/mustache",
        "//:node_modules/playwright",
        "//admin/environment/demo_space",
        "//admin/environment/development",
        "//admin/helpers",
        "//server/chat/test_helpers",
        "//server/context",
        "//server/documents/test_helpers",
        "//server/files/test_helpers",
        "//server/forum/test_helpers",
        "//server/helpers/node",
        "//server/messaging/test_helpers",
        "//server/node",
        "//server/notifications/data",
        "//server/search/data/index",
        "//server/spaces/test_helpers",
        "//server/tasks/test_helpers",
        "//shared/avatar/protocol",
        "//shared/context",
        "//shared/error",
        "//shared/helpers",
        "//shared/id",
        "//shared/schema",
    ],
)

js_binary(
    name = "scenarios",
    data = [":scenarios_lib"],
    entry_point = "scenarios_main.js",
    env = {
        "NODE_ENV": "development",
        "ADMIN_SCRIPT": "scenarios",
        "DEBUG": "admin/scenarios/*,admin/environment/*",
    },
)
