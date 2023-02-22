load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "integration_tests",
    test_node_options = [
        # Support for Cloudflare modules format.
        # https://miniflare.dev/core/modules
        "--experimental-vm-modules",
    ],
    deps = [
        "//:node_modules/jest-playwright-preset",
        "//app/local",
        "//server/dynamo",
        "//server/dynamo/test_helpers",
        "//server/emails",
        "//shared/helpers",
        "//shared/id",
    ],
)
