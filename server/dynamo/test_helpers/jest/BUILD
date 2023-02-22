load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "jest",
    visibility = ["//server:__subpackages__"],
    deps = [
        "//:node_modules/@types/jest",
        "//:node_modules/@types/node",
        "//server/dynamo",
        "//server/dynamo/test_helpers/shared",
        "//shared/content",
        "//shared/context",
        "//shared/helpers",
        "//shared/models",
    ],
)
