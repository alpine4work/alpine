load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "settings",
    visibility = [
        "//app:__subpackages__",
        "//client/web:__subpackages__",
    ],
    deps = [
        "//:node_modules/@types/react",
        "//:node_modules/fflate",
        "//:node_modules/phosphor-react",
        "//:node_modules/react",
        "//client/web/accounts",
        "//client/web/design",
        "//client/web/styles",
        "//shared/error",
        "//shared/id",
        "//shared/importer/notion",
        "//shared/rpc",
    ],
)
