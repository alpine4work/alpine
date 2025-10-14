load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "spell_check",
    test_deps = [
        "//server/access/test_helpers",
        "//server/documents/test_helpers",
        "//server/dynamo/test_helpers",
        "//server/spaces/test_helpers",
    ],
    visibility = [
        "//admin/crawl:__pkg__",
        "//app:__pkg__",
        "//server:__subpackages__",
    ],
    deps = [
        "//server/access",
        "//server/context",
        "//server/documents/data",
        "//server/dynamo/core",
        "//server/dynamo/core/general_realtime",
        "//server/spaces",
        "//server/tasks/data",
        "//shared/accounts",
        "//shared/context",
        "//shared/helpers",
        "//shared/id",
        "//shared/spell_check",
    ],
)
