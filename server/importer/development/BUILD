load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "development",
    visibility = [
        "//admin:__subpackages__",
        "//app:__subpackages__",
        "//server:__subpackages__",
    ],
    deps = [
        "//:node_modules/env-paths",
        "//server/context",
        "//server/importer",
        "//server/importer/notion",
        "//shared/context",
        "//shared/helpers",
        "//shared/id",
    ],
)
