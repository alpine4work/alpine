load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "test_helpers",
    visibility = [
        "//admin:__subpackages__",
        "//server:__subpackages__",
    ],
    deps = [
        "//server/context",
        "//server/importer",
        "//server/importer/development",
        "//server/importer/notion",
        "//shared/context",
        "//shared/helpers",
        "//shared/id",
    ],
)
