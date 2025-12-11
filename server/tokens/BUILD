load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "tokens",
    test_deps = ["//:node_modules/@types/node"],
    visibility = [
        "//app:__subpackages__",
        "//server:__subpackages__",
    ],
    deps = [
        "//:node_modules/cookie",
        "//:node_modules/jose",
        "//shared/context",
        "//shared/error",
        "//shared/helpers",
        "//shared/schema",
        "//shared/tracer",
    ],
)
