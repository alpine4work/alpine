load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "forum",
    test_deps = [
        "//server/dynamo:dynamo_testonly",
        "//server/dynamo/test_helpers/shared",
        "//server/dynamo/test_helpers/jest",
    ],
    visibility = [
        "//app:__subpackages__",
        "//server:__subpackages__",
    ],
    deps = [
        "//server/cloudflare",
        "//server/messaging",
        "//shared/error",
        "//shared/forum",
        "//shared/helpers",
        "//shared/id",
        "//shared/schema",
    ],
)
