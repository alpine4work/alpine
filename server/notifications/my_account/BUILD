load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "my_account",
    test_deps = [
        "//server/cloudflare/test_helpers",
        "//server/dynamo/test_helpers",
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
