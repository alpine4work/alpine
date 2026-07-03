load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "context",
    visibility = [
        "//app:__subpackages__",
        "//client/web:__subpackages__",
    ],
    deps = [
        "//:node_modules/@types/react",
        "//:node_modules/react",
        "//shared/accounts",
        "//shared/error",
        "//shared/helpers",
        "//shared/notifications",
        "//shared/spaces",
        "//shared/web_socket",
    ],
)
