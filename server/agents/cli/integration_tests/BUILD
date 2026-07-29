load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "integration_tests",
    # All tests in this package use our integration test environment and so need
    # extra time to run plus a larger CPU count. Also, we run these test with
    # `app/integration_tests` because they use the integration test environment.
    all_tests = {
        "size": "large",
        "tags": ["cpu:4", "integration_test"],
    },
    data = [
        "//admin/environment/test/integration:integration_data_without_agent_service",
        "//server/agents/cli",
    ],
    deps = [
        "//:node_modules/@types/node",
        "//admin/environment/test/integration",
        "//server/agents/cli",
        "//server/bots/test_helpers",
        "//server/chat/data",
        "//server/chat/test_helpers",
        "//server/documents/test_helpers",
        "//server/files/test_helpers",
        "//server/forum/test_helpers",
        "//server/helpers/node",
        "//server/search/data/index",
        "//server/spaces/test_helpers",
        "//server/tasks/data/test_helpers",
        "//shared/context",
        "//shared/helpers",
    ],
)
