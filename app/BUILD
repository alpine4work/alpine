load("@aspect_bazel_lib//lib:copy_to_bin.bzl", "copy_to_bin")
load("@aspect_rules_js//js:defs.bzl", "js_binary")
load("@npm//:wrangler/package_json.bzl", wrangler_bin = "bin")
load("//admin/bazel:opt_compilation_mode.bzl", "opt_compilation_mode")
load("//admin/typescript:typescript.bzl", "ts_project")
load("//app:remix.bzl", "remix_app")

remix_app(
    name = "app",
    visibility = [":__subpackages__"],
)

ts_project(
    name = "app_lib",
    data = [
        ":app_assets",
        ":wrangler_files",
    ],
    test_deps = [
        "//:node_modules/@types/fs-extra",
        "//:node_modules/fs-extra",
    ],
    deps = [
        "//:node_modules/@axe-core/react",
        "//:node_modules/@cloudflare/workers-types",
        "//:node_modules/@remix-run/cloudflare",
        "//:node_modules/@remix-run/cloudflare-workers",
        "//:node_modules/@remix-run/dev",
        "//:node_modules/@remix-run/server-runtime",
        "//:node_modules/@types/cookie",
        "//:node_modules/@types/mjml-react",
        "//:node_modules/@types/react",
        "//:node_modules/cookie",
        "//:node_modules/mjml-react",
        "//:node_modules/react",
        "//client/blob_factory",
        "//client/context",
        "//client/design",
        "//client/dev",
        "//client/documents",
        "//client/forum",
        "//client/helpers",
        "//client/messaging",
        "//client/peek",
        "//client/remix",
        "//client/rpc",
        "//client/tracer",
        "//client/virtualized",
        "//server/aws",
        "//server/cloudflare",
        "//server/documents",
        "//server/dynamo",
        "//server/emails",
        "//server/posts",
        "//server/remix",
        "//server/rpc",
        "//server/tracer",
        "//shared/context",
        "//shared/design",
        "//shared/documents",
        "//shared/error",
        "//shared/helpers",
        "//shared/id",
        "//shared/models",
        "//shared/remix",
        "//shared/rpc",
        "//shared/schema",
        "//shared/styles",
        "//shared/tracer",
    ],
)

copy_to_bin(
    name = "app_assets",
    srcs = glob(["public/**/*"]),
)

copy_to_bin(
    name = "wrangler_files",
    srcs = ["wrangler.toml"],
)

js_binary(
    name = "remix_compiler",
    data = [
        "//:node_modules/@bazel/worker",
        "//:node_modules/@remix-run/dev",
    ],
    entry_point = "remix_compiler.js",
)

opt_compilation_mode(
    name = "app_opt_compilation_mode",
    src = ":app",
)

wrangler_bin.wrangler_binary(
    name = "wrangler_publish",
    args = ["publish"],
    chdir = package_name(),
    data = [":app_opt_compilation_mode"],
)
