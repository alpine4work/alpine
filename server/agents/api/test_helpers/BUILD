load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "test_helpers",
    testonly = True,
    visibility = [
        "//server:__subpackages__",
    ],
    deps = [
        "//:node_modules/openapi-typescript-helpers",
        "//server/agents/api",
        "//shared/accounts",
        "//shared/api/content",
        "//shared/api/specification",
        "//shared/context",
        "//shared/error",
        "//shared/helpers",
        "//shared/id",
        "//shared/spaces/test_helpers",
        "//shared/tracer",
    ],
)
