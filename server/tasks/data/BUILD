load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "data",
    test_deps = [
        "//:node_modules/@types/json-bigint",
        "//:node_modules/json-bigint",
        "//server/bots/test_helpers",
        "//server/dynamo/test_helpers",
        "//server/messaging/test_helpers",
        "//server/spaces/test_helpers",
        "//server/tasks/test_helpers",
        "//shared/tasks/test_helpers",
        "//shared/test_helpers",
    ],
    tests = {
        "task_index_test": {
            "size": "medium",
            "tags": ["cpu:3"],
        },
        "task_table_test": {"size": "medium"},
        "task_index_permutations_test": {
            "size": "medium",
            # Give this test at least three CPUs. Two for OpenSearch, one for the test
            # process.
            "tags": ["cpu:3"],
            # It takes ~10s to start OpenSearch. Better to have a small number of large
            # shards than many small shards.
            "shard_count": 4,
        },
        # These are kind of chunky tests that use OpenSearch. We configure OpenSearch
        # in tests to use 2 CPUs (see `startOpensearchLocal()`) so reserve those
        # resources in Bazel and one for the test process.
        "internal/get_task_query_normalized_filters_opensearch_query_clause_test": {
            "size": "medium",
            "tags": ["cpu:3"],
        },
        "internal/get_task_query_normalized_sorts_opensearch_sort_clause_test": {
            "size": "medium",
            "tags": ["cpu:3"],
        },
    },
    visibility = [
        "//admin/crawl:__pkg__",
        "//admin/opensearch/deploy_script:__pkg__",
        "//app:__pkg__",
        "//server:__subpackages__",
    ],
    deps = [
        "//:node_modules/@aws-sdk/client-ec2",
        "//:node_modules/@aws-sdk/client-ecs",
        "//:node_modules/@internationalized/date",
        "//:node_modules/date-fns",
        "//:node_modules/murmurhash",
        "//:node_modules/prosemirror-model",
        "//:node_modules/prosemirror-transform",
        "//server/access",
        "//server/content",
        "//server/dynamo/core",
        "//server/feed",
        "//server/helpers",
        "//server/helpers/node",
        "//server/messaging/helpers",
        "//server/opensearch",
        "//server/search/data/table",
        "//server/spaces",
        "//server/tasks/router",
        "//shared/access",
        "//shared/context",
        "//shared/crdt",
        "//shared/design",
        "//shared/error",
        "//shared/helpers",
        "//shared/id",
        "//shared/messaging",
        "//shared/schema",
        "//shared/tasks",
    ],
)
