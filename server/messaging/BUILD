load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "messaging",
    test_deps = [
        "//server/dynamo:dynamo_testonly",
        "//server/dynamo/test_helpers/shared",
    ],
    visibility = [
        "//app:__subpackages__",
        "//server:__subpackages__",
    ],
    deps = [
        "//server/cloudflare",
        "//shared/error",
        "//shared/helpers",
        "//shared/id",
        "//shared/schema",
    ],
)
