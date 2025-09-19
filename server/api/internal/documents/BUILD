load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "documents",
    test_deps = [
        "//:node_modules/@types/supertest",
        "//:node_modules/supertest",
        "//server/api/internal/test_helpers",
        "//server/bots/test_helpers",
        "//server/documents/test_helpers",
        "//server/dynamo/test_helpers",
        "//server/spaces/test_helpers",
    ],
    visibility = ["//server/api:__subpackages__"],
    deps = [
        "//server/api/internal/shared",
        "//server/api/specification",
        "//server/documents/data",
        "//shared/error",
        "//shared/helpers",
        "//shared/id",
    ],
)
