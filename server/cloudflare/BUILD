load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "cloudflare",
    visibility = [
        "//app:__subpackages__",
        "//server:__subpackages__",
    ],
    deps = [
        "//server/remix",
        "//server/tracer",
        "//shared/cloudflare",
        "//shared/context",
        "//shared/error",
        "//shared/helpers",
        "//shared/id",
        "//shared/schema",
        "//shared/tracer",
    ],
)
