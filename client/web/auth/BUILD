load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "auth",
    visibility = [
        "//app:__subpackages__",
        "//client/web:__subpackages__",
    ],
    deps = [
        "//:node_modules/@types/react",
        "//:node_modules/react",
        "//:node_modules/react-dom",
        "//client/web/design",
        "//client/web/helpers",
        "//shared/auth",
        "//shared/content",
        "//shared/design",
        "//shared/files",
        "//shared/helpers",
        "//shared/id",
    ],
)
