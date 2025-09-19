load("@aspect_rules_js//js:defs.bzl", "js_binary")
load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "api_lib",
    deps = [
        "//server/api/internal/chat",
        "//server/api/internal/documents",
        "//server/api/internal/forum",
        "//server/api/internal/shared",
        "//server/api/internal/tasks",
        "//server/api/specification",
        "//server/chat/data",
        "//server/cloudflare/r2",
        "//server/context",
        "//server/documents/data",
        "//server/forum/data",
        "//server/helpers",
        "//server/node",
        "//server/notifications/data",
        "//server/search/data/index",
        "//server/spaces",
        "//server/tasks/data",
        "//server/tracer",
        "//shared/content/code",
        "//shared/error",
        "//shared/helpers",
        "//shared/schema",
        "//shared/tracer",
    ],
)

js_binary(
    name = "api",
    data = [":api_lib"],
    entry_point = "api_service_main.js",
)
