load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "chat",
    test_deps = [
        "//server/dynamo:dynamo_testonly",
        "//server/dynamo/test_helpers/shared",
        "//server/dynamo/test_helpers/jest",
    ],
    visibility = ["//server/edge:__subpackages__"],
    deps = [
        "//server/cloudflare",
        "//server/messaging",
        "//shared/chat",
        "//shared/error",
        "//shared/helpers",
        "//shared/id",
        "//shared/schema",
    ],
)
