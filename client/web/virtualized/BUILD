load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "virtualized",
    visibility = [
        "//app:__subpackages__",
        "//client/web:__subpackages__",
    ],
    deps = [
        "//:node_modules/@types/react",
        "//:node_modules/functional-red-black-tree",
        "//:node_modules/react",
        "//client/web/design",
        "//client/web/helpers",
        "//client/web/remix",
        "//client/web/styles",
        "//shared/remix",
    ],
)
