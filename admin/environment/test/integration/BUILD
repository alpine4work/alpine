load("//admin/typescript:typescript.bzl", "ts_project")

# Not included in the `integration` `ts_project()`'s `data` so we don't need to
# build it when running `dev check`. Depend on this separately.
filegroup(
    name = "integration_data",
    srcs = [
        "//app:app_test",
        "//server/agents/bots",
        "//server/agents/bots:agents_d1_local_data",
        "//server/api",
        "//server/apns:apns_development_certificates",
        "//server/edge",
        "//server/files/processor",
        "//server/jobs/queue",
        "//server/language_models/all_mini_lm_l6_v2:all_mini_lm_l6_v2_data",
        "//server/tasks/realtime",
    ],
    visibility = [
        "//admin:__subpackages__",
        "//app/integration_tests:__pkg__",
        "//app/screenshot_tests:__pkg__",
    ],
)

ts_project(
    name = "integration",
    visibility = [
        "//admin:__subpackages__",
        "//app/integration_tests:__pkg__",
        "//app/screenshot_tests:__pkg__",
    ],
    deps = [
        "//:node_modules/@types/fs-extra",
        "//:node_modules/@types/node",
        "//:node_modules/@types/set-cookie-parser",
        "//:node_modules/fs-extra",
        "//:node_modules/get-port",
        "//:node_modules/playwright",
        "//:node_modules/set-cookie-parser",
        "//admin/environment/test/unit",
        "//admin/helpers",
        "//server/chat/data",
        "//server/context",
        "//server/documents/data",
        "//server/documents/test_helpers",
        "//server/forum/data",
        "//server/helpers/node",
        "//server/node",
        "//server/notifications/data",
        "//server/search/data/index",
        "//server/sites/data",
        "//server/spaces",
        "//server/tasks/data",
        "//server/tokens",
        "//shared/context",
        "//shared/error",
        "//shared/helpers",
        "//shared/id",
        "//shared/schema",
        "//shared/tasks",
        "//shared/tracer",
    ],
)
