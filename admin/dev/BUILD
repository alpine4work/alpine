load("@aspect_rules_js//js:defs.bzl", "js_binary")
load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "dev_lib",
    data = [
        "//:env_files",
        "//admin/vendor:bazelisk_copy_to_bin",
        "//server/apns:apns_development_certificates",
        "//server/language_models/all_mini_lm_l6_v2:all_mini_lm_l6_v2_data",
    ],
    deps = [
        "//:node_modules/@types/express",
        "//:node_modules/@types/fs-extra",
        "//:node_modules/@types/node",
        "//:node_modules/@types/ws",
        "//:node_modules/chalk",
        "//:node_modules/chokidar",
        "//:node_modules/express",
        "//:node_modules/fs-extra",
        "//:node_modules/get-port",
        "//:node_modules/pretty-ms",
        "//:node_modules/strip-ansi",
        "//:node_modules/ws",
        "//admin/cron",
        "//admin/dynamo/local",
        "//admin/helpers",
        "//admin/opensearch/local",
        "//admin/sqs/local",
        "//server/helpers/node",
        "//shared/error",
        "//shared/helpers",
        "//shared/id",
    ],
)

js_binary(
    name = "dev",
    data = [":dev_lib"],
    entry_point = "dev_main.js",
    env = {"NODE_ENV": "development"},
)

js_binary(
    name = "migrate",
    data = [
        ":dev_lib",
        "//server/migration",
    ],
    entry_point = "dev_migrate_main.js",
    env = {"NODE_ENV": "development"},
)
