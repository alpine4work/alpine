load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "core",
    visibility = [
        "//app:__subpackages__",
        "//client/web:__subpackages__",
    ],
    deps = [
        "//:node_modules/@types/react",
        "//:node_modules/phosphor-react",
        "//:node_modules/react",
        "//client/web/accounts",
        "//client/web/design",
        "//client/web/icons",
        "//client/web/rpc",
        "//client/web/spaces",
        "//shared/accounts",
        "//shared/error",
        "//shared/helpers",
        "//shared/rpc",
        "//shared/search",
        "//shared/spaces",
    ],
)
