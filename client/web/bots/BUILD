load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "bots",
    visibility = [
        "//app:__subpackages__",
        "//client/web:__subpackages__",
    ],
    deps = [
        "//:node_modules/@types/react",
        "//:node_modules/react",
        "//client/web/accounts",
        "//client/web/helpers",
        "//shared/bots",
        "//shared/design",
        "//shared/helpers",
        "//shared/id",
        "//shared/messaging",
    ],
)
