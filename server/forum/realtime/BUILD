load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "realtime",
    test_deps = [
        "//server/dynamo/test_helpers",
        "//server/messaging/realtime/test_helpers",
    ],
    visibility = ["//server/edge:__subpackages__"],
    deps = [
        "//server/cloudflare",
        "//server/forum/data",
        "//server/messaging/realtime",
        "//shared/error",
        "//shared/forum",
        "//shared/helpers",
        "//shared/id",
        "//shared/schema",
    ],
)
