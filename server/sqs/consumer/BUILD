load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "consumer",
    visibility = [],
    deps = [
        "//:node_modules/@aws-sdk/client-sqs",
        "//shared/error",
        "//shared/helpers",
        "//shared/schema",
    ],
)
