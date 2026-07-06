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
        "//server/jobs/core",
        "//server/rynamo",
        "//server/search/data/index",
        "//server/search/data/table",
        "//server/spaces",
        "//shared/access",
        "//shared/databases",
        "//shared/dynamo",
        "//shared/error",
        "//shared/helpers",
        "//shared/id",
        "//shared/schema",
    ],
)
