load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "jest",
    visibility = ["//server:__subpackages__"],
    deps = [
        "//:node_modules/@types/jest",
        "//:node_modules/@types/node",
        "//server/cloudflare",
        "//server/dynamo",
        "//server/dynamo/test_helpers/shared",
        "//server/messaging",
        "//shared/content",
        "//shared/context",
        "//shared/helpers",
    ],
)
