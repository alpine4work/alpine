load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "notifications",
    test_deps = [
        "//server/dynamo/test_helpers/shared",
        "//server/dynamo/test_helpers/jest",
    ],
    visibility = [
        "//app:__subpackages__",
        "//server:__subpackages__",
    ],
    deps = [
        "//server/cloudflare",
        "//server/dynamo",
        "//shared/accounts",
        "//shared/error",
        "//shared/helpers",
        "//shared/id",
        "//shared/notifications",
        "//shared/schema",
    ],
)
