load("@aspect_bazel_lib//lib:copy_to_bin.bzl", "copy_to_bin")
load("@aspect_rules_js//js:defs.bzl", "js_binary")
load("//admin/typescript:typescript.bzl", "ts_project")
load("//app:remix.bzl", "remix_app")

remix_app(
    name = "app",
    visibility = [":__subpackages__"],
)

ts_project(
    name = "app_lib",
    data = [":app_assets"],
    deps = [
        "//:node_modules/@axe-core/react",
        "//:node_modules/@cloudflare/workers-types",
        "//:node_modules/@remix-run/cloudflare",
        "//:node_modules/@remix-run/cloudflare-workers",
        "//:node_modules/@remix-run/dev",
        "//:node_modules/jose",
        "//client",
        "//server",
        "//shared",
    ],
)

copy_to_bin(
    name = "app_assets",
    srcs = glob(["public/**/*"]),
)

js_binary(
    name = "remix_compiler",
    data = [
        "//:node_modules/@bazel/worker",
        "//:node_modules/@remix-run/dev",
    ],
    entry_point = "remix_compiler.js",
)
