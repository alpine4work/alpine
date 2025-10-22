load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "table",
    test_deps = [
        "//server/bots/test_helpers",
        "//server/documents/test_helpers",
        "//server/dynamo/test_helpers",
        "//server/spaces/test_helpers",
        "//server/tasks/test_helpers",
    ],
    tests = {
        "search_entity_actions_test": {"size": "medium"},
        "search_entity_actions_index_embedding_chunks_job_test": {"size": "medium"},
    },
    visibility = [
        "//admin/crawl:__pkg__",
        "//server:__subpackages__",
    ],
    deps = [
        "//server/context",
        "//server/dynamo/core",
        "//server/search/core",
        "//server/spaces",
        "//shared/error",
        "//shared/helpers",
        "//shared/id",
        "//shared/schema",
        "//shared/search",
    ],
)
