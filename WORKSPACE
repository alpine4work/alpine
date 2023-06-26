workspace(name = "cyberworlds")

load("@bazel_tools//tools/build_defs/repo:http.bzl", "http_archive")

# =========================================================================== #
#                                Bazel Skylib                                 #
# =========================================================================== #

http_archive(
    name = "bazel_skylib",
    sha256 = "66ffd9315665bfaafc96b52278f57c7e2dd09f5ede279ea6d39b2be471e7e3aa",
    urls = [
        "https://mirror.bazel.build/github.com/bazelbuild/bazel-skylib/releases/download/1.4.2/bazel-skylib-1.4.2.tar.gz",
        "https://github.com/bazelbuild/bazel-skylib/releases/download/1.4.2/bazel-skylib-1.4.2.tar.gz",
    ],
)

load("@bazel_skylib//:workspace.bzl", "bazel_skylib_workspace")

bazel_skylib_workspace()

# =========================================================================== #
#                                 JavaScript                                  #
# =========================================================================== #

http_archive(
    name = "aspect_rules_js",
    sha256 = "2a88d837f8fb7bfe46b1d9f413df9a777ec2973e1f812929b597c1971a3a1da5",
    strip_prefix = "rules_js-1.28.0",
    url = "https://github.com/aspect-build/rules_js/releases/download/v1.28.0/rules_js-v1.28.0.tar.gz",
)

load("@aspect_rules_js//js:repositories.bzl", "rules_js_dependencies")

rules_js_dependencies()

# =========================================================================== #
#                                 TypeScript                                  #
# =========================================================================== #

http_archive(
    name = "aspect_rules_ts",
    sha256 = "40ab6d3d9cc3259da54fe2f162588aba92244af0f151fbc905dcc8e7b8744296",
    strip_prefix = "rules_ts-1.4.2",
    url = "https://github.com/aspect-build/rules_ts/releases/download/v1.4.2/rules_ts-v1.4.2.tar.gz",
)

load("@aspect_rules_ts//ts:repositories.bzl", "rules_ts_dependencies")

rules_ts_dependencies(
    ts_version = "5.1.3",
)

# =========================================================================== #
#                                  Node.js                                    #
# =========================================================================== #

load("@rules_nodejs//nodejs:repositories.bzl", "nodejs_register_toolchains")

nodejs_register_toolchains(
    name = "node",
    node_version = "18.9.1",
)

# =========================================================================== #
#                          node_modules (via pnpm)                            #
# =========================================================================== #

load("@aspect_rules_js//npm:npm_import.bzl", "npm_translate_lock")

npm_translate_lock(
    name = "npm",
    patch_args = {},
    pnpm_lock = "//:pnpm-lock.yaml",
    verify_node_modules_ignored = "//:.bazelignore",
)

load("@npm//:repositories.bzl", "npm_repositories")

npm_repositories()

# =========================================================================== #
#                                    SWC                                      #
# =========================================================================== #

http_archive(
    name = "aspect_rules_swc",
    patch_args = ["-p1"],
    patches = ["//admin/patches:aspect_rules_swc.patch"],
    sha256 = "5d13b0123d91d4297f60d8da0ab5771615f6ad6829bdfe69e7dcda9e5c01bc54",
    strip_prefix = "rules_swc-1.0.0-rc0",
    url = "https://github.com/aspect-build/rules_swc/archive/refs/tags/v1.0.0-rc0.tar.gz",
)

load("@aspect_rules_swc//swc:dependencies.bzl", "rules_swc_dependencies")

rules_swc_dependencies()

load("@aspect_rules_swc//swc:repositories.bzl", "swc_register_toolchains", SWC_LATEST_VERSION = "LATEST_VERSION")

swc_register_toolchains(
    name = "swc",
    swc_version = SWC_LATEST_VERSION,
)

# =========================================================================== #
#                                  esbuild                                    #
# =========================================================================== #

http_archive(
    name = "aspect_rules_esbuild",
    sha256 = "a9e11d33bd79791586e562d0c9960e330a9e58860019d79b1bd45438266d78c9",
    strip_prefix = "rules_esbuild-0.14.3",
    url = "https://github.com/aspect-build/rules_esbuild/archive/refs/tags/v0.14.3.tar.gz",
)

load("@aspect_rules_esbuild//esbuild:dependencies.bzl", "rules_esbuild_dependencies")

rules_esbuild_dependencies()

load("@aspect_rules_esbuild//esbuild:repositories.bzl", "esbuild_register_toolchains")

esbuild_register_toolchains(
    name = "esbuild",
    esbuild_version = "0.17.10",
)

# =========================================================================== #
#                                 DynamoDB                                    #
# =========================================================================== #

http_archive(
    name = "dynamo_local",
    build_file_content = """\
exports_files(
    ["DynamoDBLocal.jar"],
    visibility = ["//visibility:public"],
)

filegroup(
    name = "DynamoDBLocal_lib",
    srcs = glob(["**/*"]),
    visibility = ["//visibility:public"],
)
""",
    # You can find DynamoDB local versions here:
    # https://s3.us-west-2.amazonaws.com/dynamodb-local/
    sha256 = "433564d6f96c50852c276133b95106870da67e54e39434f1a473827ad20b3576",
    url = "https://s3.us-west-2.amazonaws.com/dynamodb-local/dynamodb_local_2023-02-02.tar.gz",
)

# =========================================================================== #
#                                Playwright                                   #
# =========================================================================== #

load("//admin/playwright:playwright_browsers.bzl", "playwright_browsers_repository")

playwright_browsers_repository(
    name = "playwright_browsers",
    playwright_version = "1.31.1",
)
