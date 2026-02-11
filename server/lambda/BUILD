load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "lambda",
    visibility = [
        "//server:__subpackages__",
        "//admin/lambda:__subpackages__",
        "//admin/opensearch/deploy_script:__subpackages__",
    ],
    deps = [
        "//:node_modules/@aws-sdk/client-secrets-manager",
        "//:node_modules/@aws-sdk/credential-provider-node",
        "//:node_modules/@types/aws-lambda",
        "//server/aws",
        "//server/cloudflare/r2",
        "//server/context",
        "//server/helpers",
        "//server/helpers/node",
        "//server/kinesis",
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
