load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "remix",
    visibility = ["//app:__subpackages__"],
    deps = [
        "//:node_modules/@remix-run/dev",
        "//:node_modules/@remix-run/node",
        "//:node_modules/@remix-run/server-runtime",
        "//server/context",
        "//server/helpers",
        "//server/rpc",
        "//shared/context",
        "//shared/helpers",
        "//shared/id",
        "//shared/remix",
        "//shared/schema",
        "//shared/tracer",
    ],
)
