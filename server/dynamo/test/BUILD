load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "test",
    visibility = ["//server:__subpackages__"],
    deps = [
        "//:node_modules/@types/jest",
        "//:node_modules/@types/node",
        "//:node_modules/aws4fetch",
        "//:node_modules/fs-extra",
        "//:node_modules/get-port",
        "//admin/dynamo/local",
        "//admin/helpers",
        "//server/dynamo",
        "//shared/context",
        "//shared/helpers",
        "//shared/tracer",
    ],
)
