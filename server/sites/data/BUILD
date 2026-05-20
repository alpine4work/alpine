load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "data",
    test_deps = [
        "//server/dynamo/test_helpers",
        "//server/sites/test_helpers",
        "//server/spaces/test_helpers",
    ],
    visibility = [
        "//admin:__subpackages__",
        "//app:__pkg__",
        "//server:__subpackages__",
    ],
    deps = [
        "//server/access",
        "//server/context",
        "//server/dynamo/core",
        "//server/dynamo/core/rynamo",
        "//server/search/data/table",
        "//server/spaces",
        "//shared/access",
        "//shared/dynamo",
        "//shared/error",
        "//shared/helpers",
        "//shared/id",
        "//shared/schema",
        "//shared/search",
        "//shared/sites",
        "//shared/web_socket",
    ],
)
