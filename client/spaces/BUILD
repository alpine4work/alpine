load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "spaces",
    visibility = [
        "//app:__subpackages__",
        "//client:__subpackages__",
    ],
    deps = [
        "//:node_modules/@types/react",
        "//:node_modules/react",
        "//client/accounts",
        "//client/context",
        "//client/design",
        "//client/helpers",
        "//client/peek",
        "//client/rpc",
        "//shared/helpers",
        "//shared/models",
        "//shared/rpc",
    ],
)
