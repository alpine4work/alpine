load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "notifications",
    test_deps = [
        "//server/dynamo:dynamo_testonly",
        "//server/dynamo/test_helpers/shared",
        "//server/dynamo/test_helpers/jest",
    ],
    visibility = ["//server/edge:__subpackages__"],
    deps = [
        "//server/cloudflare",
        "//shared/accounts",
        "//shared/error",
        "//shared/helpers",
        "//shared/id",
        "//shared/notifications",
        "//shared/schema",
    ],
)
