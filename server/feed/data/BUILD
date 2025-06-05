load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "data",
    test_deps = [
        "//server/documents/test_helpers",
        "//server/feed/read",
        "//server/forum/test_helpers",
        "//server/tasks/test_helpers",
    ],
    visibility = [
        "//admin/crawl:__pkg__",
        "//admin/dynamo:__pkg__",
        "//app:__pkg__",
        "//server:__subpackages__",
    ],
    deps = [
        "//server/context",
        "//server/dynamo/core",
        "//server/helpers",
        "//server/spaces",
        "//shared/context",
        "//shared/error",
        "//shared/feed",
        "//shared/helpers",
        "//shared/id",
        "//shared/schema",
    ],
)
