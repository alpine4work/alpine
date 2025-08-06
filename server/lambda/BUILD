load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "lambda",
    visibility = [
        "//server:__subpackages__",
        "//admin/lambda/local:__subpackages__",
    ],
    deps = [
        "//:node_modules/@types/aws-lambda",
        "//server/cloudflare",
        "//server/context",
        "//server/node",
        "//server/tokens",
        "//server/tracer",
        "//shared/context",
        "//shared/error",
        "//shared/helpers",
        "//shared/tracer",
    ],
)
