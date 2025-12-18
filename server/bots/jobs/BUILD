load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "jobs",
    test_deps = [
    ],
    visibility = [
        "//server/jobs:__subpackages__",
    ],
    deps = [
        "//server/accounts",
        "//server/bots",
        "//server/jobs/core",
        "//server/spaces",
        "//shared/error",
        "//shared/helpers",
    ],
)
