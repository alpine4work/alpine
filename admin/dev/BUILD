load("@aspect_rules_js//js:defs.bzl", "js_binary")
load("@npm//:@remix-run/dev/package_json.bzl", remix_bin = "bin")
load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "dev_lib",
    data = [
        ":remix_dev",
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
    ],
)

js_binary(
    name = "dev",
    data = [":dev_lib"],
    entry_point = "dev_main.js",
    env = {"NODE_ENV": "development"},
)

remix_bin.remix_binary(
    name = "remix_dev",
    args = ["dev"],
)
