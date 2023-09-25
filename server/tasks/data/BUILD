load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "data",
    test_deps = [
        "//:node_modules/@types/json-bigint",
        "//:node_modules/json-bigint",
        "//server/accounts/update_name",
        "//server/dynamo/test_helpers",
        "//server/spaces/test_helpers",
        "//server/tasks/test_helpers",
        "//shared/tasks/test_helpers",
    ],
    tests = {
        "task_index_permutations_test": {
            "size": "medium",
            # Give this test at least three CPUs. Two for OpenSearch, one for the test
            # process.
            "tags": ["cpu:3"],
            # It takes ~10s to start OpenSearch. Better to have a small number of large
            # shards than many small shards.
            "shard_count": 3,
        },
        # These are kind of chunky tests that use OpenSearch. We configure OpenSearch
        # in tests to use 2 CPUs (see `startOpensearchLocal()`) so reserve those
        # resources in Bazel and one for the test process.
        "internal/get_task_query_normalized_filters_opensearch_query_clause_test": {
            "tags": ["cpu:3"],
        },
        "internal/get_task_query_normalized_sorts_opensearch_sort_clause_test": {
            "tags": ["cpu:3"],
        },
    },
    visibility = [
        "//admin/dynamo:__pkg__",
        "//server/accounts/update_name:__pkg__",
        "//server/remix:__pkg__",
        "//server/rpc:__pkg__",
        "//server/tasks:__subpackages__",
    ],
    deps = [
        "//:node_modules/@internationalized/date",
        "//:node_modules/date-fns",
        "//:node_modules/murmurhash",
        "//:node_modules/prosemirror-model",
        "//:node_modules/prosemirror-transform",
        "//server/content",
        "//server/dynamo/core",
        "//server/helpers",
        "//server/opensearch",
        "//server/spaces",
        "//server/tasks/router",
        "//shared/context",
        "//shared/crdt",
        "//shared/error",
        "//shared/helpers",
        "//shared/id",
        "//shared/schema",
        "//shared/tasks",
    ],
)
