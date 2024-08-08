load("@aspect_rules_js//js:defs.bzl", "js_binary", "js_run_binary", "js_test")
load("//admin/typescript:typescript.bzl", "ts_lint_and_format_test")

ts_lint_and_format_test(
    name = "node",
)

js_binary(
    name = "generate_package_light_json_file",
    data = ["//:package.json"],
    entry_point = "generate_package_light_json_main.cjs",
    env = {"NODE_ENV": "development"},
    no_copy_to_bin = ["//:package.json"],
)

js_run_binary(
    name = "package_light_json_file",
    stdout = "package_light.json",
    tool = ":generate_package_light_json_file",
    visibility = ["//:__pkg__"],
)

js_test(
    name = "pnpm_lock_test",
    data = [
        "//:node_modules/fs-extra",
        "//:node_modules/yaml",
        "//:pnpm-lock.yaml",
    ],
    entry_point = "pnpm_lock_test.cjs",
    no_copy_to_bin = ["//:pnpm-lock.yaml"],
)
