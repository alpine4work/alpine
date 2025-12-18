load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "notifications",
    visibility = [
        "//app:__subpackages__",
        "//client/web:__subpackages__",
    ],
    deps = [
        "//:node_modules/@types/web-push",
        "//:node_modules/web-push",
        "//shared/error",
        "//shared/helpers",
        "//shared/id",
        "//shared/notifications",
    ],
)
