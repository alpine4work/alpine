load("@aspect_bazel_lib//lib:copy_to_bin.bzl", "copy_to_bin")
load("@aspect_rules_js//js:defs.bzl", "js_binary")
load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "eslint",
    deps = [
        "//client/web/content",
        "//shared/helpers",
        "//shared/id",
    ],
)

copy_to_bin(
    name = "eslint_test_file",
    srcs = ["eslint_test.cjs"],
    visibility = ["//visibility:public"],
)

js_binary(
    name = "eslint_fix",
    data = [
        "//:eslint_config_files",
        "//:node_modules/@remix-run/eslint-config",
        "//:node_modules/@remotion/eslint-plugin",
        "//:node_modules/@typescript-eslint/eslint-plugin",
        "//:node_modules/eslint",
        "//:node_modules/eslint-plugin-cyberworlds",
        "//:node_modules/eslint-plugin-jest",
        "//:node_modules/eslint-plugin-jest-dom",
        "//:node_modules/eslint-plugin-playwright",
        "//:node_modules/eslint-plugin-react-compiler",
        "//:node_modules/eslint-plugin-react-refresh",
        "//:node_modules/eslint-plugin-testing-library",
        "//:node_modules/react",
        "//:node_modules/typescript",
        "//:package_light_json_file",
        "//:tsconfig_files",
    ],
    entry_point = "eslint_test.cjs",
    env = {
        "NODE_ENV": "test",
    },
    node_options = ["--no-deprecation"],
)
