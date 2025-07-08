load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "blobs",
    visibility = [
        "//app:__subpackages__",
        "//client:__subpackages__",
    ],
    deps = [
        "//:node_modules/@types/react",
        "//:node_modules/phosphor-react",
        "//:node_modules/react",
        "//client/design",
        "//client/helpers",
        "//client/styles",
        "//shared/design",
        "//shared/helpers",
        "//shared/id",
        "//client/blobs/helpers",
        "//client/blobs/script",
        "//client/peek",
    ],
)
