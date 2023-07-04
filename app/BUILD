load("@npm//:@remix-run/dev/package_json.bzl", remix_bin = "bin")
load("//admin/bazel:opt_compilation_mode.bzl", "opt_compilation_mode")
load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "app_lib",
    deps = [
        "//:node_modules/@remix-run/dev",
        "//:node_modules/@remix-run/node",
        "//:node_modules/@remix-run/server-runtime",
        "//:node_modules/@types/cookie",
        "//:node_modules/@types/fs-extra",
        "//:node_modules/@types/mjml-react",
        "//:node_modules/@types/react",
        "//:node_modules/cookie",
        "//:node_modules/fs-extra",
        "//:node_modules/immer",
        "//:node_modules/mjml-react",
        "//:node_modules/react",
        "//:node_modules/react-router",
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
        "//client/spaces",
        "//client/spaces/layout",
        "//client/tasks",
        "//client/tracer",
        "//client/virtualized",
        "//server/aws",
        "//server/dynamo",
        "//server/emails",
        "//server/remix",
        "//server/rpc",
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

filegroup(
    name = "app_public_files",
    srcs = glob(["public/**/*"]),
)

# `remix build` will always be a minified `NODE_ENV=production` build. So we
# want to always use an `opt` Bazel compilation mode. This is accomplished with
# the `opt_compilation_mode()` transition below. You should avoid building this
# directly since you may end up using a `fastbuild` Bazel compilation mode.
remix_bin.remix(
    name = "app_build_without_opt",
    srcs = [
        ":app_lib",
        ":app_public_files",
        "//:node_modules/dotenv",
        "//:node_modules/fs-extra",
        "//:package_light_json_file",
        "//:remix_config_files",
    ],
    outs = ["build/server.js"],
    args = ["build"],
    out_dirs = ["public/build"],
)

opt_compilation_mode(
    name = "app_build",
    src = ":app_build_without_opt",
)
