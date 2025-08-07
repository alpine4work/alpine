load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "settings",
    visibility = [
        "//app:__subpackages__",
        "//client:__subpackages__",
    ],
    deps = [
        "//:node_modules/@types/react",
        "//:node_modules/phosphor-react",
        "//:node_modules/react",
        "//client/accounts",
        "//client/design",
        "//client/styles",
        "//shared/id",
        "//shared/rpc",
    ],
)
