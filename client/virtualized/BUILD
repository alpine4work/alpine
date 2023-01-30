load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "virtualized",
    visibility = [
        "//app:__subpackages__",
        "//client:__subpackages__",
    ],
    deps = [
        "//:node_modules/@types/react",
        "//:node_modules/functional-red-black-tree",
        "//:node_modules/react",
        "//client/design",
        "//client/helpers",
        "//client/remix",
        "//shared/remix",
        "//shared/styles",
    ],
)
