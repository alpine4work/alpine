load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "data",
    visibility = [
        "//admin:__subpackages__",
        "//app:__pkg__",
        "//server:__subpackages__",
    ],
    deps = [
        "//server/context",
        "//server/dynamo/core",
        "//server/dynamo/core/general_realtime",
        "//server/search/data/table",
        "//server/spaces",
        "//shared/databases",
        "//shared/dynamo",
        "//shared/error",
        "//shared/helpers",
        "//shared/id",
        "//shared/schema",
    ],
)
