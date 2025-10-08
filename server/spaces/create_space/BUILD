load("//admin/typescript:typescript.bzl", "ts_project")

# We create a separate package for create_space since there are a few pieces
# we want to tie together here without causing circular dependencies.
# Typically, we should be creating subpackages using the `with_*` prefix,
# but this is a special case.

ts_project(
    name = "create_space",
    test_deps = [
        "//server/dynamo/test_helpers",
        "//server/spaces/test_helpers",
        "//shared/spaces/test_helpers",
    ],
    visibility = [
        "//app:__pkg__",
        "//server:__subpackages__",
    ],
    deps = [
        "//server/context",
        "//server/forum/data",
        "//server/spaces",
        "//shared/error:error_core",
        "//shared/helpers",
        "//shared/id",
        "//shared/spaces",
    ],
)
