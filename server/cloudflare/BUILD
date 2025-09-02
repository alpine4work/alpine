load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "cloudflare",
    visibility = ["//server:__subpackages__"],
    deps = [
        "//:node_modules/@cloudflare/workers-types",
        "//server/cloudflare/types",
        "//server/helpers",
        "//server/tokens",
        "//server/tracer",
        "//server/web_socket",
        "//shared/context",
        "//shared/error",
        "//shared/files",
        "//shared/helpers",
        "//shared/id",
        "//shared/messaging",
        "//shared/rpc",
        "//shared/schema",
        "//shared/tracer",
    ],
)
