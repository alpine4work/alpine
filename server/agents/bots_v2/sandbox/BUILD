load("@aspect_bazel_lib//lib:copy_file.bzl", "copy_file")
load("@aspect_bazel_lib//lib:copy_to_bin.bzl", "copy_to_bin")
load("@aspect_rules_esbuild//esbuild:defs.bzl", "esbuild")
load("@rules_pkg//pkg:tar.bzl", "pkg_tar")
load("//admin/bazel:production_transition.bzl", "production_transition")
load("//admin/typescript:typescript.bzl", "ts_project")

filegroup(
    name = "sandbox_files",
    srcs = [
        ":sandbox_copy_to_bin",
        ":sandbox_skills",
        ":claude_agent_service_bundle_file",
    ],
    visibility = ["//server/agents/bots_v2:__subpackages__"],
)

production_transition(
    name = "sandbox_files_production",
    target = ":sandbox_files",
    visibility = ["//server/agents/bots_v2:__subpackages__"],
)

copy_to_bin(
    name = "sandbox_copy_to_bin",
    srcs = [
        "claude_agent.dockerfile",
    ],
)

ts_project(
    name = "sandbox",
    # IMPORTANT: We try to keep the first-party dependency list for our agent
    # service family pretty small. Since long term, we want an ecosystem of
    # agent developers. So we should be ready to open source the code in
    # `//server/agents/bots` someday.
    #
    # However, we still write code in our codebase's code style and we still want
    # observability with our tracer framework. So there are some codebase-specific
    # dependencies but we try to keep them few and far between.
    deps = [
        "//:node_modules/@anthropic-ai/claude-agent-sdk",
        "//:node_modules/@types/node",
        "//:node_modules/uuid",
        "//:node_modules/zod",
        "//server/agents/api",
        "//server/agents/lmdb",
        "//server/agents/web",
        "//server/tracer",
        "//server/helpers",
        "//shared/api/content",
        "//shared/error",
        "//shared/helpers",
    ],
    test_deps = [
        "//server/agents/api/test_helpers",
        "//server/agents/web/test_helpers",
        "//shared/id",
        "//shared/tracer/dev",
    ],
)

esbuild(
    name = "claude_agent_service_bundle_file",
    srcs = [
        ":sandbox",
        "//:package_light_json_file",
    ],
    config = "agent_v2_sandbox_esbuild_config.cjs",
    external = ["node:*", "@anthropic-ai/claude-agent-sdk", "lmdb"],
    entry_point = "claude_agent_service.js",
    output = "claude_agent_service_bundle.mjs",
)

pkg_tar(
    name = "sandbox_skills",
    srcs = ["//skills"],
    extension = "tar.gz",
)
