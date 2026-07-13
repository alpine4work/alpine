load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "test_helpers",
    testonly = True,
    visibility = ["//server/agents:__subpackages__"],
    deps = [
        "//:node_modules/@types/json-stable-stringify",
        "//:node_modules/json-stable-stringify",
        "//:node_modules/openapi-typescript-helpers",
        "//server/agents/api",
        "//shared/accounts",
        "//shared/api/content/closed_source",
        "//shared/api/content/test_helpers",
        "//shared/api/specification",
        "//shared/context",
        "//shared/error",
        "//shared/helpers",
        "//shared/id",
        "//shared/spaces/test_helpers",
        "//shared/tasks",
        "//shared/tracer",
    ],
)
