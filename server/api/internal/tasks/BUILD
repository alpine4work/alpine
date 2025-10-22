load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "tasks",
    test_deps = [
        "//:node_modules/@types/supertest",
        "//:node_modules/supertest",
        "//server/api/internal/test_helpers",
        "//server/bots/test_helpers",
        "//server/dynamo/test_helpers",
        "//server/spaces/test_helpers",
        "//server/tasks/test_helpers",
        "//server/tasks/realtime/test_helpers",
    ],
    tests = {"api_tasks_paths_test": {"size": "medium"}},
    visibility = ["//server/api:__subpackages__"],
    deps = [
        "//server/api/internal/shared",
        "//server/api/markdown",
        "//server/tasks/data",
        "//shared/api",
        "//shared/error",
        "//shared/helpers",
        "//shared/id",
    ],
)
