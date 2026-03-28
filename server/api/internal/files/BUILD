load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "files",
    test_deps = [
        "//server/api/internal/test_helpers",
        "//server/bots/test_helpers",
        "//server/documents/test_helpers",
        "//server/dynamo/test_helpers",
        "//server/files/test_helpers",
        "//server/spaces/test_helpers",
    ],
    visibility = ["//server/api:__subpackages__"],
    deps = [
        "//server/api/internal/shared",
        "//server/files/data",
        "//shared/api/content/closed_source",
        "//shared/id",
    ],
)
