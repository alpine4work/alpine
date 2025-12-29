load("@aspect_rules_js//js:defs.bzl", "js_binary", "js_library")
load("//admin/typescript:typescript.bzl", "ts_project")
load("//app:app_wrapper_srcs.bzl", "APP_WRAPPER_SRCS")

ts_project(
    name = "dev_lib",
    data = [
        "//admin/vendor:bazelisk_copy_to_bin",
        "//server/apns:apns_development_certificates",
        "//server/language_models/all_mini_lm_l6_v2:all_mini_lm_l6_v2_data",
    ],
    test_deps = ["//:node_modules/react"],
    deps = [
        ":app_wrapper_paths_lib",
        "//:node_modules/@inquirer/prompts",
        "//:node_modules/@internationalized/date",
        "//:node_modules/@types/express",
        "//:node_modules/@types/fs-extra",
        "//:node_modules/@types/node",
        "//:node_modules/@types/ws",
        "//:node_modules/@types/yargs",
        "//:node_modules/ansi-styles",
        "//:node_modules/chalk",
        "//:node_modules/chokidar",
        "//:node_modules/date-fns",
        "//:node_modules/fast-glob",
        "//:node_modules/fs-extra",
        "//:node_modules/murmurhash",
        "//:node_modules/ws",
        "//:node_modules/yargs",
        "//admin/cron",
        "//admin/dev/agents_d1",
        "//admin/dynamo/local",
        "//admin/helpers",
        "//admin/opensearch/local",
        "//admin/sqs/local",
        "//server/helpers/node",
        "//shared/design",
        "//shared/error",
        "//shared/helpers",
        "//shared/id",
        "//shared/schema",
    ],
)

genrule(
    name = "app_wrapper_paths",
    outs = ["app_wrapper_paths.js"],
    cmd = "echo \"export const appWrapperPaths = new Set([\n{}]);\" > \"$@\"".format(
        "".join([
            "    \\\"{}\\\",\n".format(label)
            for label in APP_WRAPPER_SRCS
        ]),
    ),
)

js_library(
    name = "app_wrapper_paths_lib",
    srcs = [":app_wrapper_paths"],
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

js_binary(
    name = "testlogs",
    data = [
        ":dev_lib",
        "//admin/playwright:playwright_show_trace",
    ],
    entry_point = "dev_testlogs_main.js",
    env = {"NODE_ENV": "development"},
)

js_binary(
    name = "deployed",
    data = [":dev_lib"],
    entry_point = "dev_deployed_main.js",
    env = {"NODE_ENV": "development"},
)

js_binary(
    name = "path",
    data = [":dev_lib"],
    entry_point = "dev_path_main.js",
    env = {"NODE_ENV": "development"},
)

js_binary(
    name = "stack",
    data = [":dev_lib"],
    entry_point = "dev_stack_main.js",
    env = {"NODE_ENV": "development"},
)

js_binary(
    name = "agents",
    data = [":dev_lib"],
    entry_point = "dev_agents_main.js",
    env = {"NODE_ENV": "development"},
)
