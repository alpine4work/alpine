load("@aspect_rules_js//js:defs.bzl", "js_binary")
load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "scenarios_lib",
    data = glob(
        ["fixtures/**"],
        # Exclude dot-files like `.DS_Store` on MacOS.
        exclude = ["fixtures/**/.*"],
    ),
    deps = [
        "//:node_modules/@inquirer/prompts",
        "//:node_modules/@internationalized/date",
        "//:node_modules/chalk",
        "//:node_modules/cookie",
        "//:node_modules/gpt-tokenizer",
        "//admin/dev/helpers",
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
    },
)
