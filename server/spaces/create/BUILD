load("//admin/typescript:typescript.bzl", "ts_project")

# We create a separate package for create_space since there are a few pieces
# we want to tie together here without causing circular dependencies.
# Typically, we should be creating subpackages using the `with_*` prefix,
# but this is a special case.

ts_project(
    name = "create",
    test_deps = [
        "//server/bots/test_helpers",
        "//server/dynamo/test_helpers",
        "//server/search/data/index",
        "//server/spaces/test_helpers",
        "//shared/spaces/test_helpers",
    ],
    visibility = [
        "//app:__subpackages__",
        "//server:__subpackages__",
    ],
    deps = [
        "//server/accounts",
        "//server/context",
        "//server/forum/data",
        "//server/spaces",
        "//server/tasks/data",
        "//shared/error:error_core",
        "//shared/helpers",
        "//shared/id",
        "//shared/spaces",
    ],
)
