load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "dynamo",
    visibility = [
        "//app:__subpackages__",
        "//client:__subpackages__",
    ],
    deps = [
        "//:node_modules/@types/react",
        "//:node_modules/functional-red-black-tree",
        "//:node_modules/react",
        "//client/context",
        "//client/helpers",
        "//client/web_socket",
        "//shared/dynamo",
        "//shared/error",
        "//shared/helpers",
        "//shared/schema",
        "//shared/web_socket",
    ],
)
