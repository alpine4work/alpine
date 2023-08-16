load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "node",
    visibility = [
        "//app:__subpackages__",
        "//server:__subpackages__",
    ],
    deps = [
        "//:node_modules/@types/node",
        "//:node_modules/@types/ws",
        "//:node_modules/bufferutil",  # Optional module that improves `ws` performance
        "//:node_modules/utf-8-validate",  # Optional module that improves `ws` performance
        "//:node_modules/ws",
        "//server/tracer",
        "//shared/context",
        "//shared/error",
        "//shared/helpers",
        "//shared/schema",
        "//shared/tracer",
    ],
)
