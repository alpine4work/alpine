load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "tokens",
    visibility = [
        "//app:__subpackages__",
        "//server:__subpackages__",
    ],
    deps = [
        "//:node_modules/@types/cookie",
        "//:node_modules/cookie",
        "//:node_modules/jose",
        "//shared/error",
        "//shared/helpers",
        "//shared/schema",
        "//shared/tracer",
    ],
)
