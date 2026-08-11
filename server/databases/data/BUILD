load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "data",
    visibility = [
        "//admin:__subpackages__",
        "//app:__pkg__",
        "//server:__subpackages__",
    ],
    test_deps = [
        "//server/dynamo/test_helpers",
        "//server/sites/data",
        "//server/sites/test_helpers",
        "//server/spaces/test_helpers",
    ],
    deps = [
        "//server/access",
        "//server/context",
        "//server/dynamo/core",
        "//server/jobs/core",
        "//server/rynamo",
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
