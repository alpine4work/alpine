load("@aspect_rules_esbuild//esbuild:defs.bzl", "esbuild")
load("@aspect_rules_js//js:defs.bzl", "js_binary")
load("@npm//:wrangler/package_json.bzl", wrangler_bin = "bin")
load("//admin/bazel:production_transition.bzl", "production_transition")
load("//admin/typescript:typescript.bzl", "ts_project")

# Allow any test to depend on `upload_file.ts` from `EdgeService`.
alias(
    name = "upload_file_testonly",
    testonly = True,
    actual = ":upload_file",
    visibility = [
        "//server:__subpackages__",
    ],
)

UPLOAD_FILE_SRCS = [
    "upload_file.ts",
    "file_multipart_upload.ts",
    "internal/put_r2_object_with_span.ts",
    "internal/authorize_request_and_get_metadata_with_session_token.ts",
]

ts_project(
    name = "upload_file",
    srcs = UPLOAD_FILE_SRCS,
    # We lint and format everything with the below `ts_project()`.
    lint_and_format_srcs = [],
    test_srcs = [],
    deps = [
        "//:node_modules/pretty-bytes",
        "//server/helpers",
        "//server/tokens",
        "//shared/context",
        "//shared/error",
        "//shared/files",
        "//shared/helpers",
        "//shared/id",
        "//shared/rpc",
        "//shared/tracer",
    ],
)

ts_project(
    name = "edge_lib",
    srcs = glob(
        ["**/*.ts"],
        exclude = UPLOAD_FILE_SRCS + ["**/*.test.ts"],
    ),
    deps = [
        ":upload_file",
        "//:node_modules/pretty-bytes",
        "//app/static:static_manifest",
        "//server/chat/realtime",
        "//server/cloudflare",
        "//server/documents/collaboration",
        "//server/forum/realtime",
        "//server/helpers",
        "//server/notifications/my_account",
        "//server/tasks/notes_collaboration",
        "//server/tasks/router",
        "//server/tracer",
        "//shared/avatar",
        "//shared/avatar/protocol",
        "//shared/files",
        "//shared/helpers",
        "//shared/schema",
        "//shared/tracer/dev",
    ],
)

esbuild(
    name = "edge_service_bundle_file",
    srcs = [
        ":edge_lib",
        "//:package_light_json_file",
    ],
    config = "edge_esbuild_config.cjs",
    entry_point = "edge_service.js",
    output = "edge_service_bundle.js",
)

js_binary(
    name = "edge",
    data = [
        "wrangler.toml",
        ":edge_lib",
        ":edge_service_bundle_file",
        "//:node_modules/fs-extra",
        "//:node_modules/miniflare",
        "//:node_modules/toml",
        "//:package_light_json_file",
        "//server/helpers",
    ],
    entry_point = "edge_service_dev_main.mjs",
    env = {"NODE_ENV": "development"},
    node_options = ["--experimental-vm-modules"],
    visibility = ["//app/integration_tests:__pkg__"],
)

production_transition(
    name = "edge_service_bundle_file_production",
    target = ":edge_service_bundle_file",
)

wrangler_bin.wrangler_binary(
    name = "wrangler",
    chdir = package_name(),
    data = [
        "wrangler.toml",
        ":edge_service_bundle_file_production",
    ],
    visibility = ["//server/deploy/script:__pkg__"],
)
