load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "accounts",
    visibility = [
        "//app:__subpackages__",
        "//client:__subpackages__",
    ],
    deps = [
        "//:node_modules/@types/react",
        "//:node_modules/react",
        "//shared/helpers",
        "//shared/models",
    ],
)
