load("@aspect_bazel_lib//lib:copy_to_bin.bzl", "copy_to_bin")
load("@aspect_rules_js//js:defs.bzl", "js_binary")
load("@aspect_rules_esbuild//esbuild:defs.bzl", "esbuild")
load("@npm//:wrangler/package_json.bzl", wrangler_bin = "bin")
load("//admin/bazel:production_transition.bzl", "production_transition")
load("//admin/typescript:typescript.bzl", "ts_project")

filegroup(
    name = "bots_v2",
    # It's important that we use `data` instead of `srcs`! `data` puts our files in
    # `DefaultInfo.default_runfiles` whereas `srcs` puts our files in
    # `DefaultInfo.files`. Bazel will build both `data` and `srcs` on a
    # `bazel build` invocation but it won't print `srcs`. We don't want to print
    # `srcs` because it could be quite the long list.
    data = [
        ":agent_v2_service_bundle_file",
        ":bots_v2_copy_to_bin",
        "//server/agents/bots_v2/sandbox:sandbox_files",
    ],
    visibility = ["//server/agents/bots_v2/dev:__pkg__"],
)

copy_to_bin(
    name = "bots_v2_copy_to_bin",
    srcs = [
        "wrangler.toml",
    ],
)

ts_project(
    name = "bots_v2_lib",
    # IMPORTANT: We try to keep the first-party dependency list for our agent
    # service family pretty small. Since long term, we want an ecosystem of
    # agent developers. So we should be ready to open source the code in
    # `//server/agents/bots` someday.
    #
    # However, we still write code in our codebase's code style and we still want
    # observability with our tracer framework. So there are some codebase-specific
    # dependencies but we try to keep them few and far between.
    deps = [
        "//:node_modules/@cloudflare/sandbox",
        "//server/agents/api",
        "//server/agents/bots_v2/shared",
        "//server/cloudflare",
        "//server/cloudflare/types",
        "//server/helpers",
        "//server/tracer",
        "//shared/error",
        "//shared/api/content",
        "//shared/helpers",
    ],
)

esbuild(
    name = "agent_v2_service_bundle_file",
    srcs = [
        ":bots_v2_lib",
        "//:package_light_json_file",
    ],
    config = "agent_v2_esbuild_config.cjs",
    external = ["node:*", "cloudflare:*"],
    entry_point = "agent_v2_service.js",
    output = "agent_v2_service_bundle.js",
)

production_transition(
    name = "agent_v2_service_bundle_file_production",
    target = ":agent_v2_service_bundle_file",
)

wrangler_bin.wrangler_binary(
    name = "wrangler",
    chdir = package_name(),
    data = [
        "wrangler.toml",
        ":agent_v2_service_bundle_file_production",
        "//server/agents/bots_v2/sandbox:sandbox_files_production",
    ],
    visibility = ["//server/deploy/script:__pkg__"],
)
