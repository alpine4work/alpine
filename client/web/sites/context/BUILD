load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "context",
    visibility = [
        "//app:__subpackages__",
        "//client/web:__subpackages__",
    ],
    deps = [
        "//client/web/context",
        "//client/web/dynamo",
        "//client/web/search/core",
        "//client/web/sites/helpers",
        "//client/web/spaces",
        "//shared/dynamo",
        "//shared/error",
        "//shared/helpers",
        "//shared/id",
        "//shared/rpc",
        "//shared/search",
        "//shared/sites",
        "//shared/store",
    ],
)
