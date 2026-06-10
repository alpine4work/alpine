load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "node",
    visibility = [
        "//admin:__subpackages__",
        "//app:__subpackages__",
        "//server:__subpackages__",
        "//shared/api/specification:__pkg__",  # For a build script
    ],
    deps = [
        "//:node_modules/@aws-sdk/credential-provider-node",
        "//:node_modules/@smithy/types",
        "//:node_modules/@types/node",
        "//:node_modules/aws4fetch",
        "//:node_modules/chalk",
        "//shared/error",
        "//shared/helpers",
        "//shared/tracer",
    ],
)
