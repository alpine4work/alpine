load("@aspect_rules_js//js:defs.bzl", "js_binary", "js_run_binary")
load("//admin/typescript:typescript.bzl", "ts_project")
load("//app:remix.bzl", "remix_app")

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

filegroup(
    name = "remix_config_files",
    srcs = [
        "//:node_modules/dotenv",
        "//:node_modules/fs-extra",
        "//:package_light_json_file",
        "//:remix_config_files",
    ],
)

js_binary(
    name = "read_remix_resolved_config",
    data = [
        "entry.client.js",
        "entry.server.js",
        "root.js",
        ":remix_config_files",
        "//:node_modules/@remix-run/dev",
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

js_binary(
    name = "app",
    data = [
        ":app_build",
        ":app_lib",
        ":app_public_files",
        ":remix_config_files",
    ],
    entry_point = ":app_build",
)
