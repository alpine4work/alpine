load("//admin/typescript:typescript.bzl", "ts_project")

# We need a separate project for `addSpaceAccount()` since it needs to depend
# on `//server/search/data` so we can favorite a search entity after creating
# an account.
ts_project(
    name = "add_account",
    visibility = [
        "//admin/crawl:__pkg__",
        "//app:__pkg__",
        "//server:__subpackages__",
    ],
    deps = [
        "//server/accounts",
        "//server/context",
        "//server/search/data/table",
        "//server/spaces",
        "//shared/error",
        "//shared/helpers",
        "//shared/id",
    ],
)
