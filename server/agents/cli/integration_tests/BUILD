load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "integration_tests",
    srcs = [],
    test_data = [
        "//admin/environment/test/integration:integration_data_without_agent_service",
        "//server/agents/cli",
    ],
    test_deps = [
        "//:node_modules/@types/node",
        "//admin/environment/test/integration",
        "//server/bots/test_helpers",
        "//server/helpers/node",
        "//server/spaces/test_helpers",
        "//shared/helpers",
    ],
)
