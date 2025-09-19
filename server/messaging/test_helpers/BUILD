load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "test_helpers",
    testonly = True,
    visibility = ["//server:__subpackages__"],
    deps = [
        "//:node_modules/@types/jest",
        "//:node_modules/@types/node",
        "//server/bots/test_helpers",
        "//server/dynamo/test_helpers",
        "//server/files/test_helpers",
        "//server/messaging/helpers",
        "//shared/content",
        "//shared/context",
        "//shared/helpers",
    ],
)
