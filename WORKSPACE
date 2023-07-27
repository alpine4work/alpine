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
    # NOTE(calebmer): `rules_nodejs` has not updated with the latest Node.js version yet.
    node_repositories = {
        "20.3.1-darwin_arm64": ("node-v20.3.1-darwin-arm64.tar.gz", "node-v20.3.1-darwin-arm64", "fabf0d5bde4e1c16b6b96c310115425508c3750cd2b1d2992fa03d52b0050cf1"),
        "20.3.1-darwin_amd64": ("node-v20.3.1-darwin-x64.tar.gz", "node-v20.3.1-darwin-x64", "fd2be29c8e17ef1460a3c67b5fd36ead27159367a8958fae8fe8f3945465e0db"),
        "20.3.1-linux_arm64": ("node-v20.3.1-linux-arm64.tar.xz", "node-v20.3.1-linux-arm64", "75f820e7e0c460d902eb2c35716d158c06a4692e69f9a6cf2be30a721d7e0b42"),
        "20.3.1-linux_ppc64le": ("node-v20.3.1-linux-ppc64le.tar.xz", "node-v20.3.1-linux-ppc64le", "8463ced01d4aa008be5c699ac4c0f75edac341d6da3bb4c34d5e708bc164e660"),
        "20.3.1-linux_s390x": ("node-v20.3.1-linux-s390x.tar.xz", "node-v20.3.1-linux-s390x", "62737d306d1a3c25b794a362a354092cbce5f04f22f9e8f5cfd61e95aecd487e"),
        "20.3.1-linux_amd64": ("node-v20.3.1-linux-x64.tar.xz", "node-v20.3.1-linux-x64", "a9f94435763f9c0128a8b6282ccbeefd0413a96e78e4427cfb7831d150c50334"),
        "20.3.1-windows_amd64": ("node-v20.3.1-win-x64.zip", "node-v20.0.3-1in-x64", "b9660cf19136d6cfce9d5ec1bd7b8b7dcc5642fe5fb8c5ddde78dc0aba216dd5"),
    },
    node_version = "20.3.1",
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
    patches = ["//admin/patches:bazel/aspect_rules_swc.patch"],
    sha256 = "b647c7c31feeb7f9330fff08b45f8afe7de674d3a9c89c712b8f9d1723d0c8f9",
    strip_prefix = "rules_swc-1.0.1",
    url = "https://github.com/aspect-build/rules_swc/releases/download/v1.0.1/rules_swc-v1.0.1.tar.gz",
)

load("@aspect_rules_swc//swc:dependencies.bzl", "rules_swc_dependencies")

rules_swc_dependencies()

load("@aspect_rules_swc//swc:repositories.bzl", "swc_register_toolchains")

swc_register_toolchains(
    name = "swc",
    # NOTE(calebmer): Upgrading from v1.3.35 to v1.3.36 breaks our path resolution.
    # I believe it's the below PR which causes the regression. Previously a path
    # where SWC was not following the symlink was changed to now follow the
    # symlink.
    #
    # https://github.com/swc-project/swc/commit/1ec161a0f15886f97d4fb9cbb5d115b29ed5e2a2
    swc_version = "v1.3.35",
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

# =========================================================================== #
#                          Open Container Initiative                          #
# =========================================================================== #

http_archive(
    name = "rules_oci",
    sha256 = "db57efd706f01eb3ce771468366baa1614b5b25f4cce99757e2b8d942155b8ec",
    strip_prefix = "rules_oci-1.0.0",
    url = "https://github.com/bazel-contrib/rules_oci/releases/download/v1.0.0/rules_oci-v1.0.0.tar.gz",
)

load("@rules_oci//oci:dependencies.bzl", "rules_oci_dependencies")

rules_oci_dependencies()

load("@rules_oci//oci:repositories.bzl", "LATEST_CRANE_VERSION", "oci_register_toolchains")

oci_register_toolchains(
    name = "oci",
    crane_version = LATEST_CRANE_VERSION,
)

load("@rules_oci//oci:pull.bzl", "oci_pull")

oci_pull(
    name = "debian",
    digest = "sha256:432f545c6ba13b79e2681f4cc4858788b0ab099fc1cca799cc0fae4687c69070",
    image = "debian",
    platforms = [
        "linux/amd64",
        "linux/arm64/v8",
    ],
)

# =========================================================================== #
#                                OpenSearch                                   #
# =========================================================================== #

# We download the Linux build for MacOS which you may understandably
# find...strange. The Linux build comes with a bundled JDK built for Linux,
# however the built `.jar` files in the download are cross platform and can run
# anywhere.
#
# We do this for now because it is simple and works. If we find problems with
# this approach in the future we can build from source code which is what
# [Homebrew does][1] and host it in S3.
#
# [1]: https://github.com/Homebrew/homebrew-core/blob/af8df3291c69a65475cef507ca32cf7502ec8b9c/Formula/opensearch.rb
http_archive(
    name = "opensearch_local",
    build_file_content = """\
filegroup(
    name = "opensearch_local",
    srcs = glob(["bin/*"]),
    visibility = ["//visibility:public"],
)
""",
    patch_args = ["-p1"],
    patches = ["//admin/patches:bazel/opensearch_local.patch"],
    sha256 = "03d623c2d99a7100c2f0faddc8ffda8ba27eae8aa63ff6f3f7dad2337be8b68c",
    strip_prefix = "opensearch-2.9.0",
    url = "https://artifacts.opensearch.org/releases/bundle/opensearch/2.9.0/opensearch-2.9.0-linux-x64.tar.gz",
)
