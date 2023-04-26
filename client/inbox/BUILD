load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "inbox",
    visibility = [
        "//app:__subpackages__",
        "//client:__subpackages__",
    ],
    deps = [
        "//:node_modules/@types/react",
        "//:node_modules/react",
        "//client/context",
        "//client/design",
        "//client/spaces",
        "//shared/helpers",
        "//shared/models",
    ],
)
