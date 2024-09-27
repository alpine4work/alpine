load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "r2",
    visibility = ["//server:__subpackages__"],
    deps = [
        "//:node_modules/@aws-sdk/client-s3",
        "//:node_modules/@aws-sdk/s3-request-presigner",
        "//:node_modules/@miniflare/r2",
        "//:node_modules/@miniflare/storage-file",
        "//:node_modules/@smithy/types",
        "//:node_modules/undici",
        "//shared/context",
        "//shared/error",
        "//shared/helpers",
        "//shared/schema",
        "//shared/tracer",
    ],
)
