load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "test_helpers",
    testonly = True,
    visibility = [
        "//app/integration_tests:__subpackages__",
        "//server:__subpackages__",
    ],
    deps = [
        "//server/accounts",
        "//server/dynamo/core",
        "//server/dynamo/test_helpers",
        "//server/spaces",
        "//server/spaces/with_search",
        "//shared/helpers",
        "//shared/id",
    ],
)
