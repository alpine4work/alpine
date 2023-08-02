load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "index",
    test_data = glob([
        "tests/index_task_space_action_transaction_permutations_*.test.ts",
    ]),
    test_deps = [
        "//server/dynamo/test_helpers/shared",
        "//server/tasks/index/test_helpers",
        "//shared/tasks/test_helpers",
    ],
    tests = {
        "index_task_space_action_transaction_permutations_test": {
            # Give this test three CPUs. Two for OpenSearch, one for the test process.
            "tags": ["cpu:3"],
            "size": "medium",

            # This test is configured to be runnable in parallel with `shard_count`. In
            # practice I haven't found `shard_count` helpful for performance. Each shard
            # needs to spend ~10s initializing OpenSearch. Better to have a size medium
            # test with allocated resources.
            #
            # "shard_count": 3,
        },
    },
    visibility = ["//server/tasks:__subpackages__"],
    deps = [
        "//:node_modules/@internationalized/date",
        "//:node_modules/date-fns",
        "//server/opensearch",
        "//shared/error",
        "//shared/helpers",
        "//shared/id",
        "//shared/schema",
        "//shared/tasks",
    ],
)
