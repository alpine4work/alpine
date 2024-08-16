load("@aspect_rules_js//js:defs.bzl", "js_binary", "js_image_layer", "js_run_binary")
load("@rules_oci//oci:defs.bzl", "oci_image", "oci_tarball")
load("//admin/bazel:production_transition.bzl", "production_transition")
load("//admin/typescript:typescript.bzl", "ts_project")
load("//app:remix.bzl", "remix_app")

ts_project(
    name = "app_lib",
    visibility = ["//app/integration_tests:__pkg__"],
    deps = [
        "//:node_modules/@remix-run/dev",
        "//:node_modules/@remix-run/node",
        "//:node_modules/@remix-run/server-runtime",
        "//:node_modules/@types/cookie",
        "//:node_modules/@types/etag",
        "//:node_modules/@types/fs-extra",
        "//:node_modules/@types/mjml-react",
        "//:node_modules/@types/react",
        "//:node_modules/@types/serve-static",
        "//:node_modules/aws4fetch",
        "//:node_modules/cookie",
        "//:node_modules/etag",
        "//:node_modules/fs-extra",
        "//:node_modules/immer",
        "//:node_modules/mjml-react",
        "//:node_modules/react",
        "//:node_modules/react-router",
        "//:node_modules/serve-static",
        "//app/static:static_manifest",
        "//client/blob_factory",
        "//client/chat",
        "//client/context",
        "//client/design",
        "//client/dev",
        "//client/documents",
        "//client/forum",
        "//client/helpers",
        "//client/inbox",
        "//client/messaging",
        "//client/peek",
        "//client/remix",
        "//client/rpc",
        "//client/shimmer",
        "//client/spaces",
        "//client/spaces/layout",
        "//client/tasks",
        "//client/tracer",
        "//client/virtualized",
        "//server/accounts",
        "//server/alpha",
        "//server/apns",
        "//server/chat/data",
        "//server/content",
        "//server/context",
        "//server/deploy/data",
        "//server/documents/data",
        "//server/emails",
        "//server/forum/data",
        "//server/language_models/all_mini_lm_l6_v2",
        "//server/language_models/cohere_embed_english_v3",
        "//server/node",
        "//server/notifications/data",
        "//server/remix",
        "//server/rpc",
        "//server/spaces",
        "//server/tasks/router",
        "//server/tokens",
        "//server/tracer",
        "//shared/alpha",
        "//shared/context",
        "//shared/design",
        "//shared/documents",
        "//shared/error",
        "//shared/helpers",
        "//shared/id",
        "//shared/notifications",
        "//shared/remix",
        "//shared/rpc",
        "//shared/schema",
        "//shared/spaces",
        "//shared/styles",
        "//shared/tracer",
    ],
)

js_binary(
    name = "read_remix_resolved_config",
    data = [
        "entry.client.js",
        "entry.server.js",
        "root.js",
        "//:node_modules/@remix-run/dev",
        "//:remix_config_files",
        # Make sure we use the `.js` version of route files, not the `.ts` version. We
        # transpile with Bazel before building with Remix.
    ] + ["{}.js".format(src[:src.rindex(".")]) for src in glob([
        "routes/**/*.ts",
        "routes/**/*.tsx",
    ])],
    entry_point = "read_remix_resolved_config.cjs",
)

js_run_binary(
    name = "remix_resolved_config",
    stdout = "remix_resolved_config.json",
    tool = ":read_remix_resolved_config",
)

js_binary(
    name = "remix_compiler",
    data = [
        "//:node_modules/@bazel/worker",
        "//:node_modules/@remix-run/dev",
        "//:node_modules/fs-extra",
    ],
    entry_point = "remix_compiler.cjs",
)

remix_app(
    name = "app_build",
)

filegroup(
    name = "app_build_assets",
    srcs = [":app_build"],
    output_group = "assets",
)

filegroup(
    name = "app_static",
    srcs = [
        ":app_build_assets",
        "//app/static",
    ],
)

production_transition(
    name = "app_static_production",
    src = ":app_static",
    visibility = ["//server/deploy/script:__pkg__"],
)

js_binary(
    name = "app",
    data = [
        ":app_build",
        ":app_lib",
        ":app_static",
        "//:remix_config_files",
    ],
    entry_point = ":app_build",
    visibility = ["//app/integration_tests:__pkg__"],
)

# The container image we build for `AppService` is for production so doesn't
# include `:app_static` files which we only serve from `AppService` in
# development. In production `:app_static` files are served from Cloudflare R2.
#
# Doesn't use `production_transition()` because we apply
# `production_transition()` at the end of this build rule chain at
# `:app_image_tarball_production`.
js_binary(
    name = "app_production",
    data = [
        ":app_build",
        ":app_lib",
        "//:remix_config_files",
    ],
    entry_point = ":app_build",
)

js_image_layer(
    name = "app_image_layer",
    binary = ":app_production",
    root = "/var/www",
)

oci_image(
    name = "app_image",
    base = "@debian",
    tars = [":app_image_layer"],
    # For security, use the `www-data` user which exists on our Linux image. It
    # only has read access and execute access to files on our system.
    user = "www-data",
)

oci_tarball(
    name = "app_image_tarball",
    image = ":app_image",
    repo_tags = ["cyberworlds-app-service:latest"],
)

production_transition(
    name = "app_image_tarball_production",
    src = ":app_image_tarball",
    visibility = ["//admin/aws:__pkg__"],
)
