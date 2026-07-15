load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "tasks",
    test_deps = [
        "//:node_modules/@types/supertest",
        "//:node_modules/supertest",
        "//server/api/internal/test_helpers",
        "//shared/api/content/test_helpers",
        "//server/bots/test_helpers",
        "//server/dynamo/test_helpers",
        "//server/files/test_helpers",
        "//server/spaces/test_helpers",
        "//server/tasks/data/test_helpers",
        "//server/tasks/realtime/test_helpers",
        "//shared/prosemirror",
        "//shared/tasks/test_helpers",
    ],
    tests = {
        "api_tasks_paths_batch_task_move_test": {"size": "medium"},
        "api_tasks_paths_test": {"size": "medium"},
    },
    visibility = ["//server/api:__subpackages__"],
    deps = [
        "//server/access",
        "//server/api/internal/shared",
        "//server/files/data",
        "//server/tasks/data",
        "//server/search/data/index",
        "//shared/api/content",
        "//shared/api/content/closed_source",
        "//shared/api/specification",
        "//shared/error",
        "//shared/helpers",
        "//shared/id",
        "//shared/tasks",
    ],
)
