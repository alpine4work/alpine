load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "test_helpers",
    visibility = [
        "//admin:__subpackages__",
        "//server:__subpackages__",
    ],
    deps = [
        "//:node_modules/fflate",
        "//server/context",
        "//server/importer",
        "//server/importer/importer_service",
        "//server/importer/notion",
        "//shared/context",
        "//shared/error",
        "//shared/helpers",
        "//shared/id",
    ],
)
