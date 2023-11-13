load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "core",
    visibility = ["//server:__subpackages__"],
    deps = [
        "//:node_modules/@aws-sdk/client-sqs",
        "//shared/context",
        "//shared/error",
        "//shared/helpers",
        "//shared/schema",
        "//shared/tracer",
    ],
)
