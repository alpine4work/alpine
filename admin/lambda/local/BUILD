load("@aspect_rules_js//js:defs.bzl", "js_binary")
load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "local",
    deps = [
        "//:node_modules/@aws-sdk/client-sqs",
        "//:node_modules/@types/aws-lambda",
        "//:node_modules/@types/node",
        "//server/lambda",
        "//server/helpers",
        "//server/jobs/queue/consumer",
        "//server/node",
        "//shared/helpers",
    ],
    visibility = ["//admin/lambda/local:__subpackages__"],
)

