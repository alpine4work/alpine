load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "node",
    visibility = [
        "//app:__subpackages__",
        "//server:__subpackages__",
    ],
    deps = [
        "//:node_modules/@remix-run/node",
        "//:node_modules/@types/node",
        "//server/tracer",
        "//shared/context",
        "//shared/error",
        "//shared/helpers",
        "//shared/schema",
        "//shared/tracer",
    ],
)
