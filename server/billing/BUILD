load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "billing",
    test_deps = [
        "//server/dynamo/test_helpers",
        "//server/spaces/test_helpers",
        "//shared/tracer/dev",
    ],
    visibility = [
        "//admin/crawl:__pkg__",
        "//admin/dev:__subpackages__",
        "//app:__pkg__",
        "//server:__subpackages__",
    ],
    deps = [
        "//:node_modules/stripe",
        "//server/accounts",
        "//server/context",
        "//server/spaces",
        "//shared/context",
        "//shared/error",
        "//shared/helpers",
    ],
)
