load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "accounts",
    test_deps = ["//server/dynamo/test_helpers"],
    visibility = [
        "//admin/dynamo:__pkg__",
        "//app:__pkg__",
        "//server:__subpackages__",
    ],
    deps = [
        "//:node_modules/date-fns",
        "//server/dynamo/core",
        "//server/emails",
        "//server/tokens",
        "//shared/accounts",
        "//shared/context",
        "//shared/error",
        "//shared/helpers",
        "//shared/id",
        "//shared/schema",
        "//shared/tracer",
    ],
)
