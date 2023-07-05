load("@aspect_rules_js//js:defs.bzl", "js_binary")
load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "dev_lib",
    data = [
        "//:env_files",
        "//admin/vendor:bazelisk_copy_to_bin",
    ],
    deps = [
        "//:node_modules/@types/fs-extra",
        "//:node_modules/@types/node",
        "//:node_modules/chokidar",
        "//:node_modules/colorette",
        "//:node_modules/fs-extra",
        "//admin/dynamo/local",
        "//admin/helpers",
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
