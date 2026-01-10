load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "helpers",
    visibility = ["//admin:__subpackages__"],
    deps = [
        "//:node_modules/@miniflare/r2",
        "//:node_modules/@miniflare/storage-file",
        "//admin/helpers",
        "//server/billing",
        "//server/chat/data",
        "//server/context",
        "//server/documents/data",
        "//server/node",
        "//server/notifications/data",
        "//server/search/data/index",
        "//server/spaces/test_helpers",
        "//server/tasks/data",
        "//shared/context",
        "//shared/error",
        "//shared/helpers",
        "//shared/id",
        "//shared/schema",
    ],
)
