load("@aspect_rules_esbuild//esbuild:defs.bzl", "esbuild")
load("@aspect_rules_js//js:defs.bzl", "js_binary")
load("@npm//:wrangler/package_json.bzl", wrangler_bin = "bin")
load("//admin/bazel:production_transition.bzl", "production_transition")
load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "agents_lib",
    test_deps = [
        "//:node_modules/@miniflare/durable-objects",
        "//:node_modules/@miniflare/storage-memory",
    ],
    # IMPORTANT: We try to keep the first-party dependency list for our agent
    # service family pretty small. Since long term, we want an ecosystem of
    # agent developers. So we should be ready to open source the code in
    # `//server/agents` someday.
    #
    # However, we still write code in our codebase's code style and we still want
    # observability with our tracer framework. So there are some codebase-specific
    # dependencies but we try to keep them few and far between.
    deps = [
        "//:node_modules/@types/bintrees",
        "//:node_modules/bintrees",
        "//:node_modules/gpt-tokenizer",
        "//:node_modules/immer",
        "//:node_modules/openai",
        "//:node_modules/openapi-fetch",
        "//server/api/markdown",
        "//server/api/specification",
        "//server/cloudflare/types",
        "//server/helpers",
        "//server/tracer",
        "//shared/context",
        "//shared/error",
        "//shared/helpers",
        "//shared/tracer/dev",
    ],
)

esbuild(
    name = "agent_service_bundle_file",
    srcs = [
        ":agents_lib",
        "//:package_light_json_file",
    ],
    config = "agent_esbuild_config.cjs",
    entry_point = "agent_service.js",
    output = "agent_service_bundle.js",
)

js_binary(
    name = "agents",
    data = [
        "wrangler.toml",
        ":agent_service_bundle_file",
        ":agents_lib",
        "//:node_modules/fs-extra",
        "//:node_modules/miniflare",
        "//:node_modules/toml",
        "//:package_light_json_file",
        "//server/helpers",
    ],
    entry_point = "agent_service_dev_main.mjs",
    env = {"NODE_ENV": "development"},
    node_options = ["--experimental-vm-modules"],
    visibility = ["//app/integration_tests:__pkg__"],
)

production_transition(
    name = "agent_service_bundle_file_production",
    target = ":agent_service_bundle_file",
)

wrangler_bin.wrangler_binary(
    name = "wrangler",
    chdir = package_name(),
    data = [
        "wrangler.toml",
        ":agent_service_bundle_file_production",
    ],
    visibility = ["//server/deploy/script:__pkg__"],
)
