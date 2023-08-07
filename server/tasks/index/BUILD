load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "index",
    test_deps = [
        "//server/dynamo/test_helpers/shared",
        "//shared/tasks/test_helpers",
    ],
    tests = {
        "index_task_space_action_transaction_permutations_test": {
            "size": "medium",
            # Give this test three CPUs. Two for OpenSearch, one for the test process.
            "tags": ["cpu:4"],
            # It takes ~10s to start OpenSearch. Better to have a small number of large
            # shards than many small shards.
            "shard_count": 10,
        },
    },
    visibility = [
        "//server/dynamo:__pkg__",
        "//server/tasks:__subpackages__",
    ],
    deps = [
        "//:node_modules/@internationalized/date",
        "//:node_modules/date-fns",
        "//server/opensearch",
        "//shared/context",
        "//shared/error",
        "//shared/helpers",
        "//shared/id",
        "//shared/schema",
        "//shared/tasks",
    ],
)
