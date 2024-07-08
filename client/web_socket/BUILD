load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "web_socket",
    visibility = [
        "//app:__subpackages__",
        "//client:__subpackages__",
    ],
    deps = [
        "//:node_modules/@types/react",
        "//:node_modules/react",
        "//client/context",
        "//client/design",
        "//client/helpers",
        "//client/remix",
        "//shared/error",
        "//shared/helpers",
        "//shared/schema",
        "//shared/web_socket",
    ],
)
