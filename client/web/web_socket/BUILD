load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "web_socket",
    visibility = [
        "//app:__subpackages__",
        "//client/web:__subpackages__",
    ],
    deps = [
        "//:node_modules/@types/react",
        "//:node_modules/react",
        "//client/web/context",
        "//client/web/design",
        "//client/web/helpers",
        "//client/web/remix",
        "//shared/context",
        "//shared/error",
        "//shared/helpers",
        "//shared/schema",
        "//shared/store",
        "//shared/tracer",
        "//shared/web_socket",
    ],
)
