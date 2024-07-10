workspace(name = "cyberworlds")

load("@bazel_tools//tools/build_defs/repo:http.bzl", "http_archive", "http_file")

# `rules_xcodeproj` needs an updated version of `bazel_features` but someone in
# this file is downloading an old version. Make sure we install a new version
# early on.
http_archive(
    name = "bazel_features",
    sha256 = "0f23d75c7623d6dba1fd30513a94860447de87c8824570521fcc966eda3151c2",
    strip_prefix = "bazel_features-1.4.1",
    url = "https://github.com/bazel-contrib/bazel_features/releases/download/v1.4.1/bazel_features-v1.4.1.tar.gz",
)

load("@bazel_features//:deps.bzl", "bazel_features_deps")

bazel_features_deps()

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
#                            Aspect Bazel Helpers                             #
# =========================================================================== #

http_archive(
    name = "aspect_bazel_lib",
    patch_args = ["-p1"],
    patches = ["//admin/patches:bazel/aspect_bazel_lib.patch"],
    sha256 = "44f4f6d1ea1fc5a79ed6ca83f875038fee0a0c47db4f9c9beed097e56f8fad03",
    strip_prefix = "bazel-lib-1.34.0",
    url = "https://github.com/aspect-build/bazel-lib/releases/download/v1.34.0/bazel-lib-v1.34.0.tar.gz",
)

# =========================================================================== #
#                                   Python                                    #
# =========================================================================== #

http_archive(
    name = "rules_python",
    sha256 = "778aaeab3e6cfd56d681c89f5c10d7ad6bf8d2f1a72de9de55b23081b2d31618",
    strip_prefix = "rules_python-0.34.0",
    url = "https://github.com/bazelbuild/rules_python/releases/download/0.34.0/rules_python-0.34.0.tar.gz",
)

load("@rules_python//python:repositories.bzl", "py_repositories", "python_register_toolchains")

py_repositories()

python_register_toolchains(
    name = "python",
    python_version = "3.12",
)

load("@rules_python//python:pip.bzl", "pip_parse")
load("@python//:defs.bzl", python_interpreter = "interpreter")

pip_parse(
    name = "pypi",
    python_interpreter_target = python_interpreter,
    requirements_lock = "//:requirements.txt",
)

load("@pypi//:requirements.bzl", install_pypi_deps = "install_deps")

install_pypi_deps()

# =========================================================================== #
#                                 JavaScript                                  #
# =========================================================================== #

http_archive(
    name = "aspect_rules_js",
    sha256 = "a949d56fed8fa0a8dd82a0a660acc949253a05b2b0c52a07e4034e27f11218f6",
    strip_prefix = "rules_js-1.33.1",
    url = "https://github.com/aspect-build/rules_js/releases/download/v1.33.1/rules_js-v1.33.1.tar.gz",
)

load("@aspect_rules_js//js:repositories.bzl", "rules_js_dependencies")

rules_js_dependencies()

# =========================================================================== #
#                                 TypeScript                                  #
# =========================================================================== #

http_archive(
    name = "aspect_rules_ts",
    sha256 = "8aabb2055629a7becae2e77ae828950d3581d7fc3602fe0276e6e039b65092cb",
    strip_prefix = "rules_ts-2.0.0",
    url = "https://github.com/aspect-build/rules_ts/releases/download/v2.0.0/rules_ts-v2.0.0.tar.gz",
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
    # NOTE(calebmer): Our version of `rules_nodejs` does not have this Node.js
    # version yet.
    node_repositories = {
        "20.9.0-darwin_arm64": ("node-v20.9.0-darwin-arm64.tar.gz", "node-v20.9.0-darwin-arm64", "31d2d46ae8d8a3982f54e2ff1e60c2e4a8e80bf78a3e8b46dcaac95ac5d7ce6a"),
        "20.9.0-darwin_amd64": ("node-v20.9.0-darwin-x64.tar.gz", "node-v20.9.0-darwin-x64", "fc5b73f2a78c17bbe926cdb1447d652f9f094c79582f1be6471b4b38a2e1ccc8"),
        "20.9.0-linux_arm64": ("node-v20.9.0-linux-arm64.tar.xz", "node-v20.9.0-linux-arm64", "ced3ecece4b7c3a664bca3d9e34a0e3b9a31078525283a6fdb7ea2de8ca5683b"),
        "20.9.0-linux_ppc64le": ("node-v20.9.0-linux-ppc64le.tar.xz", "node-v20.9.0-linux-ppc64le", "3c6cea5d614cfbb95d92de43fbc2f8ecd66e431502fe5efc4f3c02637897bd45"),
        "20.9.0-linux_s390x": ("node-v20.9.0-linux-s390x.tar.xz", "node-v20.9.0-linux-s390x", "af1f4e63756ff685d452166c4d5ba93a308e816ee7c46015b5e086163d9f011b"),
        "20.9.0-linux_amd64": ("node-v20.9.0-linux-x64.tar.xz", "node-v20.9.0-linux-x64", "9033989810bf86220ae46b1381bdcdc6c83a0294869ba2ad39e1061f1e69217a"),
        "20.9.0-windows_amd64": ("node-v20.9.0-win-x64.zip", "node-v20.9.0-win-x64", "70d87dad2378c63216ff83d5a754c61d2886fc39d32ce0d2ea6de763a22d3780"),
    },
    node_version = "20.9.0",
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
    # Enable DynamoDB logging:
    # https://stackoverflow.com/questions/29525469/how-do-i-enable-dynamodb-local-logging
    patch_args = ["-p1"],
    patch_cmds = [
        "zip -d DynamoDBLocal.jar log4j2.xml",
        "zip -u DynamoDBLocal.jar log4j2.xml",
    ],
    patches = ["//admin/patches:bazel/dynamo_local.patch"],
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
    playwright_version = "1.39.0",
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
    # Remove all plugins except the KNN plugin. This improves local OpenSearch
    # startup time since we don't need to load plugins.
    patch_cmds = ["cd plugins && ls | grep -v knn | xargs rm -rf"],
    patches = ["//admin/patches:bazel/opensearch_local.patch"],
    sha256 = "8fd6cdd3d1385629033eabe14542df3a301399ee4a8151ab76fd2b20f75de12c",
    strip_prefix = "opensearch-2.11.0",
    url = "https://artifacts.opensearch.org/releases/bundle/opensearch/2.11.0/opensearch-2.11.0-linux-x64.tar.gz",
)

# =========================================================================== #
#                            ElasticMQ (local SQS)                            #
# =========================================================================== #

http_file(
    name = "elasticmq",
    downloaded_file_path = "elasticmq-server.jar",
    sha256 = "ef51a55fccf0882e6d666d8b19251d39ae190d9510409f734d8f2f8aed8c40b9",
    url = "https://s3-eu-west-1.amazonaws.com/softwaremill-public/elasticmq-server-1.4.2.jar",
)

# =========================================================================== #
#                                   Cohere                                    #
# =========================================================================== #

# NOTE(calebmer): It appears that Hugging Face only allows you to download
# individual files from their URL. I'd love to download a full directory as a
# `.tar.gz` but that doesn't seem like an option.
http_file(
    name = "cohere_embed_english_v3_tokenizer_config",
    downloaded_file_path = "tokenizer_config.json",
    sha256 = "8e58e2b9f143d556245dbbf37215aae8ffefcbcf592e3758951d95508844e54e",
    url = "https://huggingface.co/Cohere/Cohere-embed-english-v3.0/resolve/a73b09960122f77a78083ff79084162793ed9c39/tokenizer_config.json",
)

http_file(
    name = "cohere_embed_english_v3_tokenizer",
    downloaded_file_path = "tokenizer.json",
    sha256 = "7f542e02e847b77b493a81f54a69cf824e236c43bc63e3838065ba604f78f5f4",
    url = "https://huggingface.co/Cohere/Cohere-embed-english-v3.0/resolve/a73b09960122f77a78083ff79084162793ed9c39/tokenizer.json",
)

# =========================================================================== #
#                              all-MiniLM-L6-v2                               #
# =========================================================================== #

# This is the language model we run locally in development and test
# environments. It avoids charges from our production language model provider
# (Cohere). We use `all-MiniLM-L6-v2` which is a small, locally runnable, model
# that (as of 2023-11-30) is ranked 50 (out of 121) on the [MTEB Hugging Face
# leaderboard][1].
#
# Specifically we use [`Xenova/all-MiniLM-L6-v2`][2] on Hugging Face which is a
# fork of the original model with some extra data to be compatible with
# Transformers.js (so we can run the model in JavaScript).
#
# [1]: https://huggingface.co/spaces/mteb/leaderboard
# [2]: https://huggingface.co/Xenova/all-MiniLM-L6-v2

# NOTE(calebmer): It appears that Hugging Face only allows you to download
# individual files from their URL. I'd love to download a full directory as a
# `.tar.gz` but that doesn't seem like an option.
http_file(
    name = "all_mini_lm_l6_v2_tokenizer_config",
    downloaded_file_path = "tokenizer_config.json",
    sha256 = "9261e7d79b44c8195c1cada2b453e55b00aeb81e907a6664974b4d7776172ab3",
    url = "https://huggingface.co/Xenova/all-MiniLM-L6-v2/resolve/3f2acba6462e3d3b009664b530c4de07dd85b448/tokenizer_config.json",
)

http_file(
    name = "all_mini_lm_l6_v2_tokenizer",
    downloaded_file_path = "tokenizer.json",
    sha256 = "da0e79933b9ed51798a3ae27893d3c5fa4a201126cef75586296df9b4d2c62a0",
    url = "https://huggingface.co/Xenova/all-MiniLM-L6-v2/resolve/3f2acba6462e3d3b009664b530c4de07dd85b448/tokenizer.json",
)

http_file(
    name = "all_mini_lm_l6_v2_config",
    downloaded_file_path = "config.json",
    sha256 = "7135149f7cffa1a573466c6e4d8423ed73b62fd2332c575bf738a0d033f70df7",
    url = "https://huggingface.co/Xenova/all-MiniLM-L6-v2/resolve/3f2acba6462e3d3b009664b530c4de07dd85b448/config.json",
)

http_file(
    name = "all_mini_lm_l6_v2_onnx_model_quantized",
    downloaded_file_path = "onnx/model_quantized.onnx",
    sha256 = "afdb6f1a0e45b715d0bb9b11772f032c399babd23bfc31fed1c170afc848bdb1",
    url = "https://huggingface.co/Xenova/all-MiniLM-L6-v2/resolve/3f2acba6462e3d3b009664b530c4de07dd85b448/onnx/model_quantized.onnx",
)

# =========================================================================== #
#                                  Apple iOS                                  #
# =========================================================================== #

http_archive(
    name = "build_bazel_rules_apple",
    sha256 = "9c4f1e1ec4fdfeac5bddb07fa0e872c398e3d8eb0ac596af9c463f9123ace292",
    url = "https://github.com/bazelbuild/rules_apple/releases/download/3.2.1/rules_apple.3.2.1.tar.gz",
)

load(
    "@build_bazel_rules_apple//apple:repositories.bzl",
    "apple_rules_dependencies",
)

apple_rules_dependencies()

load(
    "@build_bazel_rules_swift//swift:repositories.bzl",
    "swift_rules_dependencies",
)

swift_rules_dependencies()

load(
    "@build_bazel_rules_swift//swift:extras.bzl",
    "swift_rules_extra_dependencies",
)

swift_rules_extra_dependencies()

load(
    "@build_bazel_apple_support//lib:repositories.bzl",
    "apple_support_dependencies",
)

apple_support_dependencies()

http_archive(
    name = "rules_xcodeproj",
    sha256 = "ccc719851a9942c53b9359984106e9fa5c5c97d9621b346243b638b18ec097f9",
    url = "https://github.com/MobileNativeFoundation/rules_xcodeproj/releases/download/1.16.0/release.tar.gz",
)

load(
    "@rules_xcodeproj//xcodeproj:repositories.bzl",
    "xcodeproj_rules_dependencies",
)

xcodeproj_rules_dependencies()
