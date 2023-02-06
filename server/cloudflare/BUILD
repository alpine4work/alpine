load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "cloudflare",
    visibility = [
        "//app:__subpackages__",
        "//server:__subpackages__",
    ],
    deps = [
        "//:node_modules/jose",
        "//server/aws",
        "//server/dynamo",
        "//server/remix",
        "//shared/context",
        "//shared/error",
        "//shared/helpers",
        "//shared/id",
        "//shared/schema",
        "//shared/tracer",
    ],
)
