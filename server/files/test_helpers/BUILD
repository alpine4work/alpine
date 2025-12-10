load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "test_helpers",
    visibility = [
        "//admin:__subpackages__",
        "//app/integration_tests:__subpackages__",
        "//server:__subpackages__",
    ],
    deps = [
        "//server/files/data",
        "//server/spaces/test_helpers",
        "//shared/files",
        "//shared/helpers",
        "//shared/id",
        "//shared/schema",
    ],
)
