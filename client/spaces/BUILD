load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "spaces",
    visibility = [
        "//app:__subpackages__",
        "//client:__subpackages__",
    ],
    deps = [
        "//:node_modules/@types/react",
        "//:node_modules/@types/scheduler",
        "//:node_modules/react",
        "//:node_modules/scheduler",
        "//client/context",
        "//client/design",
        "//client/dev",
        "//client/rpc",
        "//client/web_socket",
        "//shared/accounts",
        "//shared/error",
        "//shared/helpers",
        "//shared/rpc",
        "//shared/spaces",
    ],
)
