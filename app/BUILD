load("@aspect_rules_js//js:defs.bzl", "js_binary")
load("//admin/bazel:ts-project.bzl", "ts_project")

ts_project(
    name = "app",
    visibility = ["//:__pkg__"],
    deps = [
        "//:node_modules/@axe-core/react",
        "//:node_modules/@cloudflare/workers-types",
        "//:node_modules/@remix-run/cloudflare",
        "//:node_modules/@remix-run/dev",
        "//client",
        "//server",
        "//shared",
    ],
)

js_binary(
    name = "remix_compiler",
    copy_data_to_bin = False,
    data = [
        "//:node_modules/@bazel/worker",
        "//:node_modules/@remix-run/dev",
    ],
    entry_point = "compiler/remix-compiler.js",
    visibility = ["//:__pkg__"],
)
