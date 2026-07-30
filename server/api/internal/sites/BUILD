load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "sites",
    test_deps = [
        "//server/api/internal/test_helpers",
        "//server/bots/test_helpers",
        "//server/dynamo/test_helpers",
        "//server/sites/test_helpers",
        "//server/spaces/test_helpers",
        "//shared/id",
    ],
    visibility = ["//server/api:__subpackages__"],
    deps = [
        "//server/api/internal/shared",
    ],
)
