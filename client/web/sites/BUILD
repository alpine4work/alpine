load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "sites",
    visibility = [
        "//app:__subpackages__",
        "//client/web:__subpackages__",
    ],
    deps = [
        "//:node_modules/@types/scheduler",
        "//:node_modules/scheduler",
        "//client/web/helpers",
        "//client/web/sites/context",
        "//client/web/spaces",
        "//shared/helpers",
        "//shared/id",
        "//shared/sites",
        "//shared/store",
    ],
)
