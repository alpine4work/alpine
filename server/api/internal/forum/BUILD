load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "forum",
    test_deps = [
        "//:node_modules/@types/supertest",
        "//:node_modules/supertest",
        "//server/api/internal/test_helpers",
        "//server/bots/test_helpers",
        "//server/documents/test_helpers",
        "//server/dynamo/test_helpers",
        "//server/files/test_helpers",
        "//server/forum/test_helpers",
        "//server/spaces/test_helpers",
    ],
    visibility = ["//server/api:__subpackages__"],
    deps = [
        "//server/api/internal/files",
        "//server/api/internal/shared",
        "//server/files/data",
        "//server/forum/data",
        "//server/search/data/index",
        "//shared/api/markdown",
        "//shared/api/specification",
        "//shared/error",
        "//shared/helpers",
        "//shared/id",
    ],
)
