load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "test_helpers",
    visibility = [
        "//app/integration_tests:__subpackages__",
        "//server:__subpackages__",
    ],
    deps = [
        "//server/accounts",
        "//server/emails",
        "//server/forum/data",
        "//server/spaces",
        "//server/tokens",
        "//shared/accounts",
        "//shared/context",
        "//shared/error:error_core",
        "//shared/helpers",
        "//shared/helpers:helpers_core",
        "//shared/id",
        "//shared/spaces",
    ],
)
