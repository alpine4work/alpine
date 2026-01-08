load("@aspect_bazel_lib//lib:output_files.bzl", "output_files")
load("@aspect_bazel_lib//lib:write_source_files.bzl", "write_source_files")
load("@aspect_rules_js//js:defs.bzl", "js_binary", "js_image_layer", "js_run_binary")
load("@rules_oci//oci:defs.bzl", "oci_image", "oci_load")
load("@npm//:@remix-run/dev/package_json.bzl", remix_bin = "bin")
load("//admin/bazel:production_transition.bzl", "production_transition")
load("//admin/typescript:typescript.bzl", "ts_project")
load("//admin/esbuild:esbuild_runfiles_aspect.bzl", "esbuild_runfiles_without_sources")
load("//app:app_wrapper_srcs.bzl", "APP_WRAPPER_SRCS")
load("//app:app_client_optimize_deps.bzl", "app_client_optimize_deps")
load("//app:app_client_optimize_deps_data.bzl", "APP_CLIENT_OPTIMIZE_DEPS")

# `app_wrapper` is a slim binary that runs `AppService` in development. We run
# the Vite dev server inside `app_wrapper` and that's what serves our Remix
# code. Vite watches for changes to files in Bazel's output directory and hot
# reloads the browser.
ts_project(
    name = "app_wrapper_lib",
    srcs = APP_WRAPPER_SRCS,
    # We lint and format everything in `app_lib`.
    lint_and_format_srcs = [],
    test_srcs = [],
    deps = [
        "//:node_modules/@types/serve-static",
        "//:node_modules/@types/ws",
        "//:node_modules/serve-static",
        "//:node_modules/vite",
        "//:node_modules/ws",
        "//app/static:static_manifest",
        "//server/helpers/node",
        "//server/node",
        "//server/opensearch",
        "//shared/error",
        "//shared/helpers",
        "//shared/schema",
        "//shared/tracer",
    ],
)

ts_project(
    name = "app_lib",
    srcs = glob(
        [
            "**/*.ts",
            "**/*.tsx",
        ],
        exclude = APP_WRAPPER_SRCS + [
            "**/*.test.ts",
            "**/*.test.tsx",
        ],
    ),
    visibility = ["//app/integration_tests:__pkg__"],
    deps = [
        ":app_wrapper_lib",
        "//:node_modules/@react-email/components",
        "//:node_modules/@react-email/render",
        "//:node_modules/@remix-run/dev",
        "//:node_modules/@remix-run/node",
        "//:node_modules/@remix-run/server-runtime",
        "//:node_modules/@types/etag",
        "//:node_modules/@types/fs-extra",
        "//:node_modules/@types/prettier",
        "//:node_modules/@types/react",
        "//:node_modules/aws4fetch",
        "//:node_modules/cookie",
        "//:node_modules/etag",
        "//:node_modules/free-email-domains",
        "//:node_modules/fs-extra",
        "//:node_modules/gpt-tokenizer",
        "//:node_modules/openai",
        "//:node_modules/prettier",
        "//:node_modules/pretty-ms",
        "//:node_modules/react",
        "//:node_modules/react-router",
        "//client/web/auth",
        "//client/web/avatar",
        "//client/web/blobs",
        "//client/web/chat",
        "//client/web/content/file_entity",
        "//client/web/context",
        "//client/web/debug/chat_gpt",
        "//client/web/design",
        "//client/web/dev",
        "//client/web/documents",
        "//client/web/feed",
        "//client/web/forum",
        "//client/web/helpers",
        "//client/web/inbox",
        "//client/web/messaging",
        "//client/web/navigation",
        "//client/web/notifications",
        "//client/web/peek",
        "//client/web/remix",
        "//client/web/rpc",
        "//client/web/settings",
        "//client/web/shimmer",
        "//client/web/spaces",
        "//client/web/spaces/layout",
        "//client/web/styles",
        "//client/web/tasks",
        "//client/web/tracer",
        "//client/web/virtualized",
        "//server/accounts",
        "//server/alpha",
        "//server/bots",
        "//server/chat/data",
        "//server/content",
        "//server/content/context_module",
        "//server/debug/chat_gpt",
        "//server/deploy/data",
        "//server/documents/data",
        "//server/emails",
        "//server/feed",
        "//server/forum/data",
        "//server/node",
        "//server/notifications/data",
        "//server/remix",
        "//server/rpc",
        "//server/spaces",
        "//server/tasks/router",
        "//server/tracer",
        "//shared/alpha",
        "//shared/avatar/protocol",
        "//shared/bots",
        "//shared/context",
        "//shared/debug/chat_gpt",
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
        "//shared/tracer",
    ],
)

APP_BUILD_SHARED_ARGS = ["vite:build"]

APP_BUILD_DEVELOPMENT_ARGS = APP_BUILD_SHARED_ARGS + [
    "--mode=development",
    "--minify=false",
]

APP_BUILD_PRODUCTION_ARGS = APP_BUILD_SHARED_ARGS + [
    "--mode=production",
    "--minify=terser",
]

APP_BUILD_DEVELOPMENT_ENV = {
    "NODE_ENV": "development",
}

APP_BUILD_PRODUCTION_ENV = {
    "NODE_ENV": "production",
}

app_client_optimize_deps(
    name = "app_client_optimize_deps_data",
    target = "//app:app_lib",
)

# By writing to a file anyone who depends on
# `app_client_optimize_deps_data.bzl` doesn't take a dependency on all of
# `//app:app_lib`. This is great for our development environment since
# otherwise a change to any file used by `//app:app_lib` would cause
# `app_client_optimize_deps` (used by `app_wrapper`) to rebuild.
write_source_files(
    name = "write_app_client_optimize_deps",
    files = {
        "app_client_optimize_deps_data.bzl": ":app_client_optimize_deps_data",
    },
)

js_binary(
    name = "app_client_optimize_deps_tool",
    data = ["@aspect_rules_esbuild//esbuild/private:plugins/bazel-sandbox.js"],
    entry_point = "app_client_optimize_deps_main.mjs",
    no_copy_to_bin = ["@aspect_rules_esbuild//esbuild/private:plugins/bazel-sandbox.js"],
)

js_run_binary(
    name = "app_client_optimize_deps",
    srcs = [
        "app_client_optimize_deps_data.bzl",
        "//:node_modules/@remix-run/dev",
        "//:node_modules/vite",
        "//:remix_config_files",
    ] + {
        "//:node_modules/{}".format("/".join(dep.split("/")[0:1]) if dep.startswith("@") else dep.split("/")[0]): None
        for dep in APP_CLIENT_OPTIMIZE_DEPS
    }.keys(),
    env = {"VITE_CONFIG_WITHOUT_REMIX_PLUGIN": "true"} | select({
        "//admin/bazel:compilation_mode_fastbuild": APP_BUILD_DEVELOPMENT_ENV,
        "//admin/bazel:compilation_mode_dbg": APP_BUILD_DEVELOPMENT_ENV,
        "//admin/bazel:compilation_mode_opt": APP_BUILD_PRODUCTION_ENV,
    }),
    out_dirs = ["optimize_deps"],
    progress_message = "Optimizing dependencies with Vite",
    tool = ":app_client_optimize_deps_tool",
)

ALL_ROUTE_SRCS = glob([
    "routes/*.ts",
    "routes/*.tsx",
])

genrule(
    name = "app_space_route_id_file",
    srcs = [],
    outs = ["app_space_route_id.ts"],
    cmd = "printf \"// @generated by //shared/remix:write_app_space_route_id\n\nexport type AppSpaceRouteId ={};\n\" > \"$@\"".format(
        "".join([
            "\n    | \\\"{}\\\"".format(route_src[:route_src.rindex(".")].replace("$", "\\$$"))
            for route_src in ALL_ROUTE_SRCS
            if route_src[:route_src.rindex(".")].startswith("routes/s.$spaceId.") and
               not route_src.startswith("routes/s.$spaceId.peek")
        ]),
    ),
    visibility = ["//shared/remix:__pkg__"],
)

# Files the Vite dev server watches. Our dev process manager will keep this
# target up-to-date in Bazel's output directory then the Vite dev server
# watches Bazel's output directory and hot reloads the browser if it detects
# a relevant file change.
filegroup(
    name = "app",
    # It's important that we use `data` instead of `srcs`! `data` puts our files in
    # `DefaultInfo.default_runfiles` whereas `srcs` puts our files in
    # `DefaultInfo.files`. Bazel will build both `data` and `srcs` on a
    # `bazel build` invocation but it won't print `srcs`. We don't want to print
    # `srcs` because it could be quite the long list.
    data = [
        ":app_lib",
        "//:remix_config_files",
        "//app/static",
    ],
)

js_binary(
    name = "app_wrapper",
    data = [
        ":app_client_optimize_deps",
        ":app_wrapper_lib",
    ],
    entry_point = "app_service_main.js",
)

remix_bin.remix(
    name = "app_build",
    srcs = [
        ":app_lib",
        "//:node_modules/terser",
        "//:node_modules/vite",
        "//:remix_config_files",
        "//app/static",
    ],
    outs = [
        "build/server/app_service_main.js",
        "build/server/remix_server_build.js",
    ],
    args = select({
        "//admin/bazel:compilation_mode_fastbuild": APP_BUILD_DEVELOPMENT_ARGS,
        "//admin/bazel:compilation_mode_dbg": APP_BUILD_DEVELOPMENT_ARGS,
        "//admin/bazel:compilation_mode_opt": APP_BUILD_PRODUCTION_ARGS,
    }),
    env = select({
        "//admin/bazel:compilation_mode_fastbuild": APP_BUILD_DEVELOPMENT_ENV,
        "//admin/bazel:compilation_mode_dbg": APP_BUILD_DEVELOPMENT_ENV,
        "//admin/bazel:compilation_mode_opt": APP_BUILD_PRODUCTION_ENV,
    }),
    out_dirs = [
        "build/client",
        "build/server/assets",
    ],
    progress_message = "Bundling Remix app",
)

output_files(
    name = "app_build_client",
    paths = ["app/build/client"],
    target = ":app_build",
)

output_files(
    name = "app_build_server",
    paths = [
        "app/build/server/app_service_main.js",
        "app/build/server/remix_server_build.js",
        "app/build/server/assets",
    ],
    target = ":app_build",
)

# Vite technically uses Rollup to bundle our app, not esbuild. So the rule
# being named `esbuild_runfiles_without_sources()` is a bit of a misnomer.
# However, the concept is the same. Bundlers bundle source files so we need
# `:app_lib`'s runfiles excluding source files.
esbuild_runfiles_without_sources(
    name = "app_runfiles",
    srcs = [":app_lib"],
)

alias(
    name = "app_static",
    actual = ":app_build_client",
    visibility = ["//visibility:public"],
)

production_transition(
    name = "app_static_production",
    target = ":app_static",
    visibility = ["//server/deploy/script:__pkg__"],
)

# `AppService` binary we run in integration tests. We want to use our Vite
# build (vs the Vite dev server) in integration tests to build confidence our
# product will work in production.
js_binary(
    name = "app_test",
    data = [
        ":app_build",
        ":app_runfiles",
    ],
    entry_point = "build/server/app_service_main.js",
    no_copy_to_bin = [":app_runfiles"],
    visibility = ["//app/integration_tests:__pkg__"],
)

# Doesn't use `production_transition()` because we apply
# `production_transition()` at the end of this build rule chain at
# `:app_image_tarball_production`.
js_binary(
    name = "app_production",
    data = [
        # `:app_build_server` excludes client assets.
        #
        # The production container we build for `AppService` doesn't include client
        # assets which we only serve from `AppService` in development/test. In
        # production client assets are served from Cloudflare R2.
        ":app_build_server",
        ":app_runfiles",
    ],
    entry_point = "build/server/app_service_main.js",
    no_copy_to_bin = [":app_runfiles"],
)

js_image_layer(
    name = "app_image_layer",
    binary = ":app_production",
    root = "/var/www",
)

oci_image(
    name = "app_image",
    base = "@debian_image",
    tars = [":app_image_layer"],
    # For security, use the `www-data` user which exists on our Linux image. It
    # only has read access and execute access to files on our system.
    user = "www-data",
)

oci_load(
    name = "app_image_tarball_load",
    image = ":app_image",
    repo_tags = ["cyberworlds-app-service:latest"],
)

filegroup(
    name = "app_image_tarball",
    srcs = [":app_image_tarball_load"],
    output_group = "tarball",
)

production_transition(
    name = "app_image_tarball_production",
    target = ":app_image_tarball",
    visibility = ["//admin/aws:__pkg__"],
)
