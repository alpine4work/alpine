load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "lambda",
    visibility = [
        "//server:__subpackages__",
        "//admin/lambda/local:__subpackages__",
    ],
    deps = [
        "//:node_modules/@aws-sdk/client-secrets-manager",
        "//:node_modules/@types/aws-lambda",
        "//server/aws",
        "//server/cloudflare/r2",
        "//server/context",
        "//server/helpers/node",
        "//server/node",
        "//server/tokens",
        "//server/tracer",
        "//shared/context",
        "//shared/error",
        "//shared/helpers",
        "//shared/schema",
        "//shared/tracer",
        "//shared/tracer/dev",
    ],
)
