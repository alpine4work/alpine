load("@aspect_rules_js//js:defs.bzl", "js_binary")
load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "migration_lib",
    deps = [
        "//server/chat/data",
        "//server/documents/data",
        "//server/forum/data",
        "//server/helpers",
        "//server/node",
        "//server/spaces",
        "//server/tasks/data",
        "//shared/context",
        "//shared/error",
        "//shared/helpers",
        "//shared/id",
        "//shared/schema",
    ],
)

js_binary(
    name = "migration",
    data = [":migration_lib"],
    entry_point = "migration_service.js",
    visibility = [
        "//admin/dev:__pkg__",
    ],
)
