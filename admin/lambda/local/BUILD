load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "local",
    visibility = [
        "//server/files/processor:__pkg__",
    ],
    deps = [
        "//:node_modules/@aws-sdk/client-sqs",
        "//:node_modules/@types/aws-lambda",
        "//:node_modules/@types/node",
        "//server/helpers",
        "//server/jobs/queue/consumer",
        "//server/lambda",
        "//server/node",
        "//shared/helpers",
    ],
)
