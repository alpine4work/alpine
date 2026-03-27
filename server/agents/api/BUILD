load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "api",
    visibility = ["//server/agents:__subpackages__"],
    deps = [
        "//:node_modules/openapi-fetch",
        "//:node_modules/openapi-typescript-helpers",
        "//shared/api/specification",
        "//shared/error",
        "//shared/helpers",
        "//shared/tracer",
    ],
)
