load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "spaces",
    test_deps = [
        "//:node_modules/@types/supertest",
        "//:node_modules/supertest",
        "//server/api/internal/test_helpers",
        "//server/bots/test_helpers",
        "//server/documents/test_helpers",
        "//server/dynamo/test_helpers",
        "//server/spaces/test_helpers",
        "//shared/test_helpers",
    ],
    visibility = ["//server/api:__subpackages__"],
    deps = [
        "//server/api/internal/shared",
        "//server/bots",
        "//server/bots/with_spaces",
        "//server/context",
        "//server/forum/data",
        "//server/search/data/index",
        "//server/spaces",
        "//shared/api/specification",
        "//shared/error",
        "//shared/helpers",
        "//shared/id",
        "//shared/search",
        "//shared/spaces",
        "//shared/tasks",
    ],
)
