load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "importer",
    test_deps = [
        "//shared/tracer/dev",
    ],
    visibility = [
        "//admin:__subpackages__",
        "//app:__subpackages__",
        "//server:__subpackages__",
    ],
    deps = [
        "//:node_modules/@aws-sdk/client-s3",
        "//:node_modules/@aws-sdk/s3-request-presigner",
        "//:node_modules/env-paths",
        "//server/helpers/node",
        "//shared/context",
        "//shared/helpers",
        "//shared/id",
    ],
)
