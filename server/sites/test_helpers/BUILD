load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "test_helpers",
    visibility = [
        "//admin:__subpackages__",
        "//app/integration_tests:__subpackages__",
        "//app/screenshot_tests:__subpackages__",
        "//server:__subpackages__",
    ],
    deps = [
        "//server/access/test_helpers",
        "//server/sites/data",
        "//server/sites/entity_actions",
        "//server/spaces/test_helpers",
        "//shared/access",
        "//shared/helpers",
        "//shared/id",
        "//shared/search",
        "//shared/sites",
        "//shared/spaces",
    ],
)
