load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "realtime",
    test_deps = ["//server/dynamo/test_helpers"],
    visibility = ["//server:__subpackages__"],
    deps = [
        "//server/cloudflare",
        "//shared/error",
        "//shared/helpers",
        "//shared/id",
        "//shared/schema",
    ],
)
