load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "access",
    visibility = [
        "//client/web:__subpackages__",
    ],
    deps = [
        "//client/web/sites",
        "//shared/access",
        "//shared/access/model",
        "//shared/helpers",
        "//shared/store",
    ],
)
