load("@aspect_rules_js//js:defs.bzl", "js_binary")
load(":open_source_configuration.bzl", "OPEN_SOURCE_ALLOWED_BAZEL_PACKAGES", "open_source_configuration")
load(":open_source_repository.bzl", "open_source_repository")
load("//admin/typescript:typescript.bzl", "ts_lint_and_format_test", "ts_project")

exports_files(
    [
        "open_source_configuration.bzl",
        "open_source_repository.bzl",
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
    # Fixture tests create and inspect temporary worktrees, including symlinked paths. They must
    # access those paths directly rather than through rules_js's runfiles symlink guard.
    all_tests = {"patch_node_fs": False},
    deps = [
        "//:node_modules/@types/jest",
        "//:node_modules/@types/node",
        "//:node_modules/typescript",
    ],
)

# This filegroup is the source-level scheduling boundary for the public-repository CI. The
# workflow queries it with Bazel before comparing a PR to its base, so changing a private source
# outside this declared set cannot start the archive, test, or publish jobs.
#
# Keep the TypeScript sources shared with `open_source_typescript`: they implement and test the
# archive action itself. The remaining files are Starlark or shell inputs that can change which
# files are selected or how the generated repository is verified.
filegroup(
    name = "open_source_repository_ci_inputs",
    srcs = [
        ":open_source_repository_source_inputs",
        "generate_open_source_package_lock.sh",
        "open_source_configuration.bzl",
        "open_source_repository.bzl",
        "open_source_repository_test.sh",
        "open_source_repository_typecheck_test.sh",
        "//admin/typescript:typescript.bzl",
        "//:open_source_repository_configuration_inputs",
    ] + open_source_typescript_srcs + open_source_typescript_test_srcs,
    visibility = ["//visibility:public"],
)

js_binary(
    name = "package_open_source_repository",
    data = [
        ":open_source_typescript",
        ":open_source_configuration",
        "//:node_modules/typescript",
    ],
    entry_point = "publish_open_source_main.js",
)

# This is intentionally a separate local command from the archive-producing action above. Bazel
# owns the archive; the command only unpacks that verified product into the ignored result folder
# for a developer to inspect.
js_binary(
    name = "publish_open_source_repository",
    args = ["$(rootpath :open_source_repository)"],
    data = [
        ":open_source_repository",
        ":open_source_typescript",
        "//:node_modules/typescript",
    ],
    entry_point = "publish_open_source_result_main.js",
)

sh_binary(
    name = "generate_open_source_package_lock",
    srcs = ["generate_open_source_package_lock.sh"],
)

# npm resolves the lock from the same ZIP that public CI tests and publishes. It stays local
# because npm's registry resolution is an intentional external boundary, not a cacheable remote
# action.
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
    node = "//:node",
    npm = ":npm",
    publisher = ":package_open_source_repository",
    configuration = ":open_source_configuration",
    verification_data = open_source_repository_npm_packages,
    verification_script = "open_source_repository_test.sh",
)
