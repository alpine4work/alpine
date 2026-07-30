load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "language_models",
    test_deps = [
        "//:node_modules/@jest/globals",
        "//shared/tracer/dev",
    ],
    visibility = [
        "//admin:__subpackages__",
        "//app:__pkg__",
        "//server:__subpackages__",
    ],
    deps = [
        "//:node_modules/@aws-sdk/client-bedrock-runtime",
        "//:node_modules/@aws-sdk/credential-providers",
        "//server/language_models/core",
        "//shared/context",
        "//shared/error",
        "//shared/helpers",
        "//shared/schema",
        "//shared/tracer",
    ],
)
