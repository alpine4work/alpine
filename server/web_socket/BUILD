load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "web_socket",
    visibility = ["//server:__subpackages__"],
    deps = [
        "//:node_modules/@types/ws",
        "//:node_modules/bufferutil",  # Optional module that improves `ws` performance
        "//:node_modules/utf-8-validate",  # Optional module that improves `ws` performance
        "//:node_modules/ws",
        "//server/helpers",
        "//server/tracer",
        "//shared/context",
        "//shared/error",
        "//shared/helpers",
        "//shared/id",
        "//shared/rpc",
        "//shared/schema",
        "//shared/tracer",
        "//shared/web_socket",
    ],
)
