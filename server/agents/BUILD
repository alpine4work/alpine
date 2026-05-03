load("@aspect_rules_esbuild//esbuild:defs.bzl", "esbuild")
load("@aspect_rules_js//js:defs.bzl", "js_binary")
load("@aspect_bazel_lib//lib:write_source_files.bzl", "write_source_files")
load("@npm//:drizzle-kit/package_json.bzl", drizzle_kit_bin = "bin")
load("@npm//:wrangler/package_json.bzl", wrangler_bin = "bin")
load("@npm//:openapi-typescript/package_json.bzl", openapi_typescript_bin = "bin")
load("@npm//:prettier/package_json.bzl", prettier_bin = "bin")
load("//admin/bazel:production_transition.bzl", "production_transition")
load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "agents_lib",
    test_deps = [
        "//:node_modules/@jest/globals",
        "//:node_modules/@miniflare/durable-objects",
        "//:node_modules/@miniflare/storage-memory",
        "//server/agents/api/test_helpers",
        "//shared/spaces/test_helpers",
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
        "//:node_modules/@types/mustache",
        "//:node_modules/bintrees",
        "//:node_modules/drizzle-orm",
        "//:node_modules/gpt-tokenizer",
        "//:node_modules/immer",
        "//:node_modules/mustache",
        "//:node_modules/openai",
        "//:node_modules/openapi-fetch",
        "//:node_modules/openapi-typescript-helpers",
        "//:node_modules/unicode-default-word-boundary",
        "//:node_modules/yaml",
        "//server/agents/api",
        "//server/api/content",
        "//server/api/markdown",
        "//server/cloudflare",
        "//server/cloudflare/types",
        "//server/helpers",
        "//server/kinesis",
        "//server/tracer",
        "//shared/agents",
        "//shared/api",
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
        "//:node_modules/better-sqlite3",
        "//:node_modules/fs-extra",
        "//:node_modules/miniflare",
        "//:node_modules/toml",
        "//:package_light_json_file",
        "//admin/dev/agents_d1",
        "//server/helpers",
        "//server/helpers/node",
        "//shared/tracer",
    ],
    entry_point = "agent_service_dev_main.mjs",
    env = {
        "NODE_ENV": "development",
        # On paid plans, Cloudflare Workers can make up to 1000 subrequests.
        # https://developers.cloudflare.com/workers/platform/limits/#subrequests
        #
        # This environment variable is parsed here:
        # https://github.com/cloudflare/miniflare/blob/b536e56ee19803f0c1fbb922394992bbed7e7c96/packages/shared/src/context.ts#L17-L19
        "MINIFLARE_SUBREQUEST_LIMIT": "1000",
    },
    node_options = ["--experimental-vm-modules"],
    visibility = ["//admin/environment/test/integration:__pkg__"],
)

production_transition(
    name = "agent_service_bundle_file_production",
    target = ":agent_service_bundle_file",
)

MIGRATIONS = glob(
    [
        "internal/d1/migrations/*.sql",
        "internal/d1/migrations/meta/*.json",
    ],
    allow_empty = True,
)

genrule(
    name = "agents_d1_local_data",
    srcs = MIGRATIONS + ["wrangler.toml"],
    outs = ["agents_d1_local_data.tar.gz"],
    cmd = """
set -euo pipefail

export BAZEL_BINDIR="$(BINDIR)"
execroot="$$(pwd)"

log_path="$$execroot/$(RULEDIR)/cmd.log"

export HOME="$$execroot/$(RULEDIR)/home"
mkdir -p "$$HOME"

data_path="$$execroot/$(RULEDIR)/agents_d1_local_data"
mkdir -p "$$data_path"

config_path="$$execroot/$(location wrangler.toml)"
output_path="$$execroot/$@"

{
  "$$execroot/$(location :wrangler_dev)" --config "$$config_path" d1 migrations apply agent-usage --local --persist-to "$$data_path"
  tar -C "$$data_path" -czf "$$output_path" .
} >"$$log_path" 2>&1 || { cat "$$log_path"; exit 1; }
""",
    tools = [":wrangler_dev"],
    visibility = ["//admin/environment/test/integration:__pkg__"],
)

wrangler_bin.wrangler_binary(
    name = "wrangler",
    chdir = package_name(),
    data = MIGRATIONS + [
        "wrangler.toml",
        ":agent_service_bundle_file_production",
    ],
    visibility = ["//server/deploy/script:__pkg__"],
)

wrangler_bin.wrangler_binary(
    name = "wrangler_dev",
    chdir = package_name(),
    data = MIGRATIONS + ["wrangler.toml"],
    visibility = ["//admin/dev/agents_d1:__pkg__"],
)

drizzle_kit_bin.drizzle_kit_binary(
    name = "drizzle_kit",
    chdir = package_name(),
    data = MIGRATIONS + [
        "//:node_modules/drizzle-kit",
        ":agents_lib",
        "internal/d1/agent_usage_drizzle.config.cjs",
    ],
    visibility = ["//admin/dev/agents_d1:__pkg__"],
)

openapi_typescript_bin.openapi_typescript(
    name = "cursor_cloud_agents_api_specification_types_without_namespace",
    srcs = ["internal/cursor/cursor_cloud_agents_api_specification.yaml"],
    outs = ["internal/cursor/cursor_cloud_agents_api_specification_types_without_namespace.ts"],
    args = [
        "internal/cursor/cursor_cloud_agents_api_specification.yaml",
        "--output",
        "internal/cursor/cursor_cloud_agents_api_specification_types_without_namespace.ts",
        "--immutable",
    ],
    chdir = package_name(),
)

prettier_bin.prettier_binary(
    name = "prettier",
)

genrule(
    name = "cursor_cloud_agents_api_specification_types_for_write",
    srcs = [
        "internal/cursor/cursor_cloud_agents_api_specification_types_without_namespace.ts",
        "//:prettier_config_files",
        "//:node_modules/prettier-plugin-embed",
        "//:node_modules/prettier-plugin-sql",
    ],
    outs = ["internal/cursor/cursor_cloud_agents_api_specification_types_for_write.ts"],
    cmd = """
echo "// @generated by //server/agents:write_cursor_cloud_agents_api_specification_types" >> $@
echo "/* eslint-disable @typescript-eslint/array-type */" >> $@
echo >> $@
echo "export namespace CursorCloudAgentsApiSpecification {{" >> $@
cat $(location internal/cursor/cursor_cloud_agents_api_specification_types_without_namespace.ts) >> $@
echo "}}" >> $@

BAZEL_BINDIR=$(BINDIR) $(location :prettier) "$$(readlink -f "$(BINDIR)/{}/internal/cursor/cursor_cloud_agents_api_specification_types_for_write.ts")" --write
""".format(package_name()),
    tools = [":prettier"],
)

write_source_files(
    name = "write_cursor_cloud_agents_api_specification_types",
    files = {
        "internal/cursor/cursor_cloud_agents_api_specification_types.ts": "internal/cursor/cursor_cloud_agents_api_specification_types_for_write.ts",
    },
)
