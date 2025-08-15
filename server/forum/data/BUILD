load("//admin/typescript:typescript.bzl", "ts_project")

alias(
    name = "data_testonly",
    testonly = True,
    actual = ":data",
    visibility = [
        "//server:__subpackages__",
    ],
)

ts_project(
    name = "data",
    test_deps = [
        "//:node_modules/date-fns",
        "//server/dynamo/test_helpers",
        "//server/files/test_helpers",
        "//server/forum/test_helpers",
        "//server/messaging/test_helpers",
        "//server/spaces/test_helpers",
        "//server/spaces/with_search",
        "//shared/content",
    ],
    visibility = [
        "//admin/crawl:__pkg__",
        "//app:__pkg__",
        "//server:__subpackages__",
    ],
    deps = [
        "//server/access",
        "//server/cloudflare/r2",
        "//server/content",
        "//server/context",
        "//server/dynamo/core",
        "//server/dynamo/core/general_realtime",
        "//server/feed/data",
        "//server/files/data",
        "//server/helpers",
        "//server/jobs/core",
        "//server/messaging/helpers",
        "//server/notifications/core",
        "//server/search/data/table",
        "//server/spaces",
        "//server/tokens",
        "//shared/access",
        "//shared/context",
        "//shared/dynamo",
        "//shared/error",
        "//shared/feed",
        "//shared/files",
        "//shared/forum",
        "//shared/helpers",
        "//shared/id",
        "//shared/messaging",
        "//shared/prosemirror",
        "//shared/schema",
        "//shared/spaces",
    ],
)
