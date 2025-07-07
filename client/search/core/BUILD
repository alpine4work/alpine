load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "core",
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
        "//client/icons",
        "//client/rpc",
        "//client/spaces",
        "//shared/accounts",
        "//shared/error",
        "//shared/helpers",
        "//shared/rpc",
        "//shared/search",
        "//shared/spaces",
    ],
)
