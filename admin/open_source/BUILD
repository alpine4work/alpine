load("@aspect_rules_js//js:defs.bzl", "js_binary")
load("@aspect_bazel_lib//lib:write_source_files.bzl", "write_source_files")
load(":open_source_configuration.bzl", "OPEN_SOURCE_ALLOWED_BAZEL_PACKAGES", "open_source_configuration")
load(":open_source_repository.bzl", "open_source_repository")
load("//admin/typescript:typescript.bzl", "ts_lint_and_format_test", "ts_project")

exports_files(
    [
        "open_source_configuration.bzl",
        "open_source_repository.bzl",
        "generate_cli_patch_list.mjs",
    ],
    visibility = ["//visibility:public"],
)

open_source_configuration(
    name = "open_source_configuration",
    # This is the only package opt-in list. File tags select files inside an approved package but
    # cannot authorize a new package.
    allowed_bazel_packages = OPEN_SOURCE_ALLOWED_BAZEL_PACKAGES,
    generated_source_inputs = ["//skills:open_source_generated_source_inputs"],
    stub_destination_files = ["//shared/tracer:open_source_stub_destinations"],
    repository_files = "//:open_source_tagged_repository_files",
)

ts_lint_and_format_test(
    name = "open_source",
    srcs = glob(
        [
            "**/*.ts",
            "*.md",
            "*.sh",
        ],
        exclude = ["result/**/*.ts"],
        allow_empty = True,
    ),
)

# Keep the private pnpm patches out of the published source files. This checked-in YAML lists the
# patches that the archive converts and copies into the published CLI for patch-package.
write_source_files(
    name = "write_open_source_cli_patch_list",
    files = {
        "cli_patch_list.yaml": ":open_source_cli_patch_list.generated.yaml",
    },
)

# Generate the YAML patch list and public npm overrides from the public CLI manifest and lockfile.
# This runs privately because it reads the private pnpm patch configuration.
genrule(
    name = "open_source_cli_patch_files_generated",
    srcs = [
        "//:open_source_cli_patch_generator_inputs",
        "generate_cli_patch_list.mjs",
    ],
    outs = [
        "open_source_cli_patch_list.generated.yaml",
        "open_source_package.generated.json",
    ],
    cmd = "$(location //:node) $(location generate_cli_patch_list.mjs) --patch-list-output \"$$(pwd)/$(location :open_source_cli_patch_list.generated.yaml)\" --public-package-output \"$$(pwd)/$(location :open_source_package.generated.json)\"",
    tools = ["//:node"],
    visibility = ["//:__pkg__", "//admin/open_source:__pkg__"],
)

open_source_typescript_srcs = glob(
    ["**/*.ts"],
    exclude = [
        "**/*.test.ts",
        "result/**/*.ts",
    ],
    allow_empty = True,
)

open_source_typescript_test_srcs = glob(
    ["**/*.test.ts"],
    exclude = ["result/**/*.test.ts"],
    allow_empty = True,
)

ts_project(
    name = "open_source_typescript",
    # `result` is an ignored local inspection tree that contains a separately configured public
    # repository. It is deliberately not part of this internal TypeScript project.
    srcs = open_source_typescript_srcs,
    test_srcs = open_source_typescript_test_srcs,
    lint_and_format_srcs = open_source_typescript_srcs,
    # Fixture tests create and inspect temporary worktrees, including symlinked paths. They must
    # access those paths directly rather than through rules_js's runfiles symlink guard.
    all_tests = {"patch_node_fs": False},
    deps = [
        "//:node_modules/@types/jest",
        "//:node_modules/@types/node",
        "//:node_modules/typescript",
        "//:node_modules/yaml",
    ],
)

# The CI workflow queries this group before it compares a pull request with its base. List every
# private input that can change the generated repository or its verification, so unrelated private
# changes do not run the archive, test, or publish jobs.
#
# `open_source_typescript` compiles and tests the publisher. The remaining Starlark and shell files
# choose public inputs or verify the generated repository.
filegroup(
    name = "open_source_repository_ci_inputs",
    srcs = [
        ":open_source_repository_source_inputs",
        "cli_patch_list.yaml",
        "generate_cli_patch_list.mjs",
        "generate_open_source_package_lock.sh",
        "open_source_configuration.bzl",
        "open_source_repository.bzl",
        "open_source_repository_test.sh",
        "open_source_repository_typecheck_test.sh",
        "//admin/typescript:typescript.bzl",
        "//admin/patches:open_source_patch_source_configuration_inputs",
        "//:open_source_cli_patch_generator_inputs",
        "//:open_source_cli_patch_sources",
        "//:open_source_repository_configuration_inputs",
        "//:open_source_repository_workflow_inputs",
    ] + open_source_typescript_srcs + open_source_typescript_test_srcs,
    visibility = ["//visibility:public"],
)

js_binary(
    name = "package_open_source_repository",
    data = [
        ":open_source_typescript",
        ":open_source_configuration",
        "//:node_modules/typescript",
        "//:node_modules/yaml",
    ],
    entry_point = "publish_open_source_main.js",
)

# This local command reads the ZIP from `open_source_repository` and unpacks it into the ignored
# result directory. It does not collect or package source files again.
js_binary(
    name = "publish_open_source_repository",
    args = ["$(rootpath :open_source_repository)"],
    data = [
        ":open_source_repository",
        ":open_source_typescript",
        "//:node_modules/typescript",
        "//:node_modules/yaml",
    ],
    entry_point = "publish_open_source_result_main.js",
)

sh_binary(
    name = "generate_open_source_package_lock",
    srcs = ["generate_open_source_package_lock.sh"],
)

# npm resolves the lockfile from the same ZIP that public CI tests and publishes. Bazel runs this
# action locally because npm needs the external package registry.
genrule(
    name = "open_source_package_lock_generated",
    srcs = [":open_source_repository"],
    outs = ["package-lock.open_source.generated.json"],
    cmd = "$(location :generate_open_source_package_lock) \"$$(pwd)/$(location :open_source_repository)\" \"$$(pwd)/$(location :npm)\" \"$$(pwd)/$@\"",
    local = True,
    tools = [
        ":generate_open_source_package_lock",
        ":npm",
    ],
    visibility = ["//:__pkg__"],
)

alias(
    name = "npm",
    actual = select({
        "@bazel_tools//src/conditions:darwin_arm64": "@nodejs_darwin_arm64//:npm",
        "@bazel_tools//src/conditions:darwin_x86_64": "@nodejs_darwin_amd64//:npm",
        "@bazel_tools//src/conditions:linux_aarch64": "@nodejs_linux_arm64//:npm",
        "@bazel_tools//src/conditions:linux_x86_64": "@nodejs_linux_amd64//:npm",
    }),
)

open_source_repository_npm_packages = [
    "//:node_modules/@internationalized/date",
    "//:node_modules/@lezer/highlight",
    "//:node_modules/@lezer/markdown",
    "//:node_modules/@types/escape-html",
    "//:node_modules/@types/jest",
    "//:node_modules/@types/mdast",
    "//:node_modules/@types/node",
    "//:node_modules/@types/set-cookie-parser",
    "//:node_modules/@types/tough-cookie",
    "//:node_modules/@types/whatwg-mimetype",
    "//:node_modules/chalk",
    "//:node_modules/cookie",
    "//:node_modules/date-fns",
    "//:node_modules/env-paths",
    "//:node_modules/esbuild",
    "//:node_modules/escape-html",
    "//:node_modules/grapheme-splitter",
    "//:node_modules/htmlparser2",
    "//:node_modules/immer",
    "//:node_modules/inline-style-parser",
    "//:node_modules/jest",
    "//:node_modules/lmdb",
    "//:node_modules/mdast-util-from-markdown",
    "//:node_modules/mdast-util-frontmatter",
    "//:node_modules/mdast-util-gfm-strikethrough",
    "//:node_modules/mdast-util-gfm-table",
    "//:node_modules/mdast-util-gfm-task-list-item",
    "//:node_modules/mdast-util-math",
    "//:node_modules/mdast-util-to-markdown",
    "//:node_modules/micromark-extension-frontmatter",
    "//:node_modules/micromark-extension-gfm-strikethrough",
    "//:node_modules/micromark-extension-gfm-table",
    "//:node_modules/micromark-extension-gfm-task-list-item",
    "//:node_modules/micromark-extension-math",
    "//:node_modules/murmurhash",
    "//:node_modules/openapi-fetch",
    "//:node_modules/openapi-typescript-helpers",
    "//:node_modules/ordered-binary",
    "//:node_modules/prettier",
    "//:node_modules/pretty-bytes",
    "//:node_modules/remove-accents",
    "//:node_modules/set-cookie-parser",
    "//:node_modules/stemmer",
    "//:node_modules/strip-ansi",
    "//:node_modules/tough-cookie",
    "//:node_modules/typescript",
    "//:node_modules/whatwg-mimetype",
]

open_source_repository(
    name = "open_source_repository",
    cli_patch_list = "cli_patch_list.yaml",
    cli_patch_sources = "//:open_source_cli_patch_sources",
    node = "//:node",
    npm = ":npm",
    publisher = ":package_open_source_repository",
    configuration = ":open_source_configuration",
    verification_data = open_source_repository_npm_packages + [
        "//:open_source_cli_patch_sources",
        "//:node_modules/yaml",
    ],
    verification_script = "open_source_repository_test.sh",
)
