load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "data",
    test_deps = [
        "//:node_modules/@types/json-bigint",
        "//:node_modules/json-bigint",
        "//server/dynamo/test_helpers",
        "//server/spaces/test_helpers",
        "//server/tasks/test_helpers",
        "//shared/tasks/test_helpers",
    ],
    tests = {
        "task_index_permutations_test": {
            "size": "medium",
            # Give this test three CPUs. Two for OpenSearch, one for the test process.
            "tags": ["cpu:4"],
            # It takes ~10s to start OpenSearch. Better to have a small number of large
            # shards than many small shards.
            "shard_count": 10,
        },
    },
    visibility = [
        "//admin/dynamo:__pkg__",
        "//server/tasks:__subpackages__",
    ],
    deps = [
        "//:node_modules/@internationalized/date",
        "//:node_modules/date-fns",
        "//server/dynamo/core",
        "//server/helpers",
        "//server/opensearch",
        "//server/spaces",
        "//shared/context",
        "//shared/crdt",
        "//shared/error",
        "//shared/helpers",
        "//shared/id",
        "//shared/schema",
        "//shared/tasks",
    ],
)
