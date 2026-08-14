load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "api",
    visibility = ["//server/agents:__subpackages__"],
    test_deps = [
        "//:node_modules/@miniflare/durable-objects",
        "//:node_modules/@miniflare/storage-memory",
        "//server/agents/api/test_helpers",
        "//server/cloudflare",
        "//shared/tracer/dev",
    ],
    deps = [
        "//:node_modules/openapi-fetch",
        "//:node_modules/openapi-typescript-helpers",
        "//shared/api/specification",
        "//shared/error",
        "//shared/helpers",
        "//shared/tracer",
    ],
)
