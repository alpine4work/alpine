load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "cloudflare",
    visibility = ["//server:__subpackages__"],
    deps = [
        "//:node_modules/@cloudflare/workers-types",
        "//server/helpers",
        "//server/tokens",
        "//server/tracer",
        "//shared/cloudflare",
        "//shared/context",
        "//shared/error",
        "//shared/helpers",
        "//shared/id",
        "//shared/rpc",
        "//shared/schema",
        "//shared/tracer",
    ],
)
