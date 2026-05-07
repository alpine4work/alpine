load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "realtime",
    test_deps = [
        "//server/cloudflare/test_helpers",
        "//server/dynamo/test_helpers",
        "//server/sites/data",
    ],
    visibility = ["//server/edge:__subpackages__"],
    deps = [
        "//server/cloudflare",
        "//server/web_socket",
        "//shared/context",
        "//shared/dynamo",
        "//shared/error",
        "//shared/helpers",
        "//shared/id",
        "//shared/notifications",
        "//shared/rpc",
        "//shared/schema",
        "//shared/sites",
    ],
)
