load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "test",
    data = ["//admin/dynamo:dynamo_local_base_data"],
    visibility = ["//server:__subpackages__"],
    deps = [
        "//:node_modules/@types/jest",
        "//:node_modules/@types/node",
        "//:node_modules/aws4fetch",
        "//:node_modules/fs-extra",
        "//:node_modules/get-port",
        "//admin/dynamo",
        "//admin/helpers",
        "//server/dynamo",
        "//shared/context",
        "//shared/helpers",
        "//shared/tracer",
    ],
)
