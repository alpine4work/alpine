load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "test_helpers",
    testonly = True,
    visibility = ["//server/api:__subpackages__"],
    deps = [
        "//:node_modules/@types/supertest",
        "//:node_modules/supertest",
        "//server/api/internal/shared",
        "//server/api/markdown",
        "//server/bots/test_helpers",
        "//server/dynamo/test_helpers",
        "//server/messaging/test_helpers",
        "//server/spaces/test_helpers",
        "//server/tokens",
        "//shared/agents",
        "//shared/api",
        "//shared/error",
        "//shared/helpers",
    ],
)
