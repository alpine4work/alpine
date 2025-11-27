load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "blobs",
    visibility = [
        "//app:__subpackages__",
        "//client/web:__subpackages__",
    ],
    deps = [
        "//:node_modules/@types/react",
        "//:node_modules/phosphor-react",
        "//:node_modules/react",
        "//client/web/blobs/helpers",
        "//client/web/blobs/script",
        "//client/web/design",
        "//client/web/helpers",
        "//client/web/peek",
        "//client/web/styles",
        "//shared/design",
        "//shared/helpers",
        "//shared/id",
    ],
)
