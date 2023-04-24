load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "accounts",
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
        "//shared/error",
        "//shared/helpers",
        "//shared/id",
        "//shared/models",
        "//shared/schema",
    ],
)
