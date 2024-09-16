load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "data",
    test_deps = [
        "//server/dynamo/test_helpers",
        "//server/spaces/test_helpers",
    ],
    visibility = [
        "//admin/dynamo:__pkg__",
        "//server:__subpackages__",
    ],
    deps = [
        "//:node_modules/pretty-bytes",
        "//server/cloudflare/r2",
        "//server/context",
        "//server/dynamo/core",
        "//server/helpers",
        "//server/spaces",
        "//shared/context",
        "//shared/error",
        "//shared/files",
        "//shared/helpers",
        "//shared/id",
        "//shared/schema",
    ],
)
