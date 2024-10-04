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
    sha256 = "bc283cdfcd526a52c3201279cda4bc298652efa898b10b4db0837dc51652756f",
    urls = [
        "https://mirror.bazel.build/github.com/bazelbuild/bazel-skylib/releases/download/1.7.1/bazel-skylib-1.7.1.tar.gz",
        "https://github.com/bazelbuild/bazel-skylib/releases/download/1.7.1/bazel-skylib-1.7.1.tar.gz",
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
    sha256 = "714cf8ce95a198bab0a6a3adaffea99e929d2f01bf6d4a59a2e6d6af72b4818c",
    strip_prefix = "bazel-lib-2.7.8",
    url = "https://github.com/aspect-build/bazel-lib/releases/download/v2.7.8/bazel-lib-v2.7.8.tar.gz",
)

load("@aspect_bazel_lib//lib:repositories.bzl", "aspect_bazel_lib_dependencies", "aspect_bazel_lib_register_toolchains")

aspect_bazel_lib_dependencies()

aspect_bazel_lib_register_toolchains()

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
    requirements_lock = "//:requirements_lock.txt",
)

load("@pypi//:requirements.bzl", install_pypi_deps = "install_deps")

install_pypi_deps()

# =========================================================================== #
#                                 JavaScript                                  #
# =========================================================================== #

http_archive(
    name = "rules_nodejs",
    patch_args = ["-p1"],
    patches = ["//admin/patches:bazel/rules_nodejs.patch"],
    sha256 = "8fc8e300cb67b89ceebd5b8ba6896ff273c84f6099fc88d23f24e7102319d8fd",
    urls = ["https://github.com/bazelbuild/rules_nodejs/releases/download/5.8.4/rules_nodejs-core-5.8.4.tar.gz"],
)

http_archive(
    name = "aspect_rules_js",
    patch_args = ["-p1"],
    patches = ["//admin/patches:bazel/aspect_rules_js.patch"],
    sha256 = "2cfb3875e1231cefd3fada6774f2c0c5a99db0070e0e48ea398acbff7c6c765b",
    strip_prefix = "rules_js-1.42.3",
    url = "https://github.com/aspect-build/rules_js/releases/download/v1.42.3/rules_js-v1.42.3.tar.gz",
)

load("@aspect_rules_js//js:repositories.bzl", "rules_js_dependencies")

rules_js_dependencies()

# =========================================================================== #
#                                 TypeScript                                  #
# =========================================================================== #

http_archive(
    name = "aspect_rules_ts",
    patch_args = ["-p1"],
    patches = ["//admin/patches:bazel/aspect_rules_ts.patch"],
    sha256 = "f69a6452b129d39d9b05f3dff8b1057185bb195b4daf0cff419988de757c6c31",
    strip_prefix = "rules_ts-2.4.2",
    url = "https://github.com/aspect-build/rules_ts/releases/download/v2.4.2/rules_ts-v2.4.2.tar.gz",
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
    lifecycle_hooks_envs = {
        "sharp": ["SHARP_IGNORE_GLOBAL_LIBVIPS=true"],
    },
    npmrc = "//:.npmrc",
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
    patch_args = ["-p1"],
    patches = ["//admin/patches:bazel/aspect_rules_esbuild.patch"],
    sha256 = "82e6fa940760412eedfa0c4e3918c68424cf0432840de4bcc476d0b9869ff7b5",
    strip_prefix = "rules_esbuild-0.20.1",
    url = "https://github.com/aspect-build/rules_esbuild/releases/download/v0.20.1/rules_esbuild-v0.20.1.tar.gz",
)

load("@aspect_rules_esbuild//esbuild:dependencies.bzl", "rules_esbuild_dependencies")

rules_esbuild_dependencies()

load("@aspect_rules_esbuild//esbuild:repositories.bzl", "esbuild_register_toolchains")

esbuild_register_toolchains(
    name = "esbuild",
    esbuild_version = "0.21.5",
)

# =========================================================================== #
#                                 DynamoDB                                    #
# =========================================================================== #

http_archive(
    name = "dynamo_local",
    build_file = "@//admin/bazel:third_party/BUILD.dynamo_local.bazel",
    # Enable DynamoDB logging:
    # https://stackoverflow.com/questions/29525469/how-do-i-enable-dynamodb-local-logging
    patch_args = ["-p1"],
    patch_cmds = [
        "zip -d DynamoDBLocal.jar log4j2.xml",
        # NOTE(calebmer, 2024-07-25): In order to create a reproducible `.zip` file
        # across builds we need to set the modification timestamp to a constant
        # (`touch -t`) and ignore all other OS timestamps like access time (`-X`).
        # If we don't create a reproducible `.zip` file then remote caching breaks!
        # Anything that depends on this rule will need to rebuild.
        #
        # Great article on building reproducible zip files:
        # https://tanzu.vmware.com/content/blog/barriers-to-deterministic-reproducible-zip-files
        #
        # The touch timestamp we're using is copied from that file and doesn't have
        # anything to do with reality.
        "touch -t 201401010000 log4j2.xml",
        "zip -u -X DynamoDBLocal.jar log4j2.xml",
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
    playwright_version = "1.46.0",
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
    build_file = "@//admin/bazel:third_party/BUILD.opensearch_local.bazel",
    integrity = "sha256-cF2JZX5psuh7h8acazK9tcjNu6wralJtliwqaBnd/V8=",
    patch_args = ["-p1"],
    patch_cmds = [
        # Remove the `jdk` directory. The `jdk` binaries are built for an x86_64 Linux
        # so we can't use them. We'll instead use a Bazel installed Java
        # implementation.
        "rm -rf jdk",
        # Remove all plugins except the KNN plugin. This improves local OpenSearch
        # startup time since we don't need to load plugins.
        "cd plugins && ls | grep -v knn | xargs rm -rf",
    ],
    patches = ["//admin/patches:bazel/opensearch_local.patch"],
    strip_prefix = "opensearch-2.13.0",
    url = "https://artifacts.opensearch.org/releases/bundle/opensearch/2.13.0/opensearch-2.13.0-linux-x64.tar.gz",
)

# =========================================================================== #
#                            ElasticMQ (local SQS)                            #
# =========================================================================== #

http_file(
    name = "elasticmq",
    downloaded_file_path = "elasticmq-server.jar",
    integrity = "sha256-LTunKXhvN6VOcOuTA/uFcg3sZngZ9icTeJOR4uTIi4s=",
    url = "https://s3-eu-west-1.amazonaws.com/softwaremill-public/elasticmq-server-1.6.6.jar",
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
    patch_args = ["-p1"],
    patches = ["//admin/patches:bazel/build_bazel_rules_apple.patch"],
    sha256 = "9c4f1e1ec4fdfeac5bddb07fa0e872c398e3d8eb0ac596af9c463f9123ace292",
    url = "https://github.com/bazelbuild/rules_apple/releases/download/3.2.1/rules_apple.3.2.1.tar.gz",
)

load(
    "@build_bazel_rules_apple//apple:repositories.bzl",
    "apple_rules_dependencies",
)

apple_rules_dependencies()

load(
    "@build_bazel_apple_support//lib:repositories.bzl",
    "apple_support_dependencies",
)

apple_support_dependencies()

load(
    "@build_bazel_rules_swift//swift:repositories.bzl",
    "swift_rules_dependencies",
)

swift_rules_dependencies()

# NOTE(calebmer): We don't call `swift_rules_extra_dependencies()` since we
# [already have the dependencies from this call we need][1]
# (`apple_support_dependencies()` and `bazel_features_deps()`) and we don't
# want to install `rules_proto` which we don't need.
#
# [1]: https://github.com/bazelbuild/rules_swift/blob/86dc0f046269b3001f6f20cec38342c03120a209/swift/extras.bzl#L27-L42

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

# =========================================================================== #
#                                   FFmpeg                                    #
# =========================================================================== #

# TODO(calebmer): Eventually we will need a software licenses notice that
# mentions our use of FFmpeg and includes patches we make to FFmpeg and
# probably the Bazel build files. This is necessary for [compliance with
# LGPL][1].
#
# [1]: https://www.ffmpeg.org/legal.html
http_archive(
    name = "ffmpeg",
    build_file = "@//admin/bazel:third_party/BUILD.ffmpeg.bazel",
    integrity = "sha256-S2/UvhYJ/LSqiKSafSZaqoGb1CtZCWcwVQcQ8NMeJtg=",
    patch_args = ["-p1"],
    patches = ["//admin/patches:bazel/ffmpeg.patch"],
    strip_prefix = "FFmpeg-a49188297f1763c4f6188ca8ca7c1a8da6771896",
    url = "https://github.com/FFmpeg/FFmpeg/archive/a49188297f1763c4f6188ca8ca7c1a8da6771896.tar.gz",
)

http_archive(
    name = "libvpx",
    build_file = "@//admin/bazel:third_party/BUILD.libvpx.bazel",
    integrity = "sha256-kBdHJU2Ap5N8kz0DvXxdQejmyIPgZl+tyxclQhZ8eXc=",
    strip_prefix = "libvpx-1.14.1",
    url = "https://github.com/webmproject/libvpx/archive/refs/tags/v1.14.1.tar.gz",
)

http_archive(
    name = "pkg_config",
    build_file = "@//admin/bazel:third_party/BUILD.pkg_config.bazel",
    integrity = "sha256-b8acAWiMlFilfrmhZkyaujcszaQgoCv0Qp/mEOfn1ZE=",
    strip_prefix = "pkg-config-0.29.2",
    url = "https://pkg-config.freedesktop.org/releases/pkg-config-0.29.2.tar.gz",
)

http_archive(
    name = "cmake_macos",
    build_file = "@//admin/bazel:third_party/BUILD.cmake.bazel",
    integrity = "sha256-zshzsoIvHDS8Pi/W7J/dHExryFDt/rpHUk8jzf6xyMQ=",
    strip_prefix = "cmake-3.30.3-macos-universal/CMake.app/Contents",
    url = "https://github.com/Kitware/CMake/releases/download/v3.30.3/cmake-3.30.3-macos-universal.tar.gz",
)

http_archive(
    name = "cmake_linux_x86_64",
    build_file = "@//admin/bazel:third_party/BUILD.cmake.bazel",
    integrity = "sha256-Slhk6f8NeUVzH+bRSvthSQvw7BVFJ7w68EVr2PqQ3ss=",
    strip_prefix = "cmake-3.30.3-linux-x86_64",
    url = "https://github.com/Kitware/CMake/releases/download/v3.30.3/cmake-3.30.3-linux-x86_64.tar.gz",
)

http_archive(
    name = "cmake_linux_aarch64",
    build_file = "@//admin/bazel:third_party/BUILD.cmake.bazel",
    integrity = "sha256-Qg8XxY3k7YtTwQVaNDGK7FwG2UsE2sndPHKGHf3JnVI=",
    strip_prefix = "cmake-3.30.3-linux-aarch64",
    url = "https://github.com/Kitware/CMake/releases/download/v3.30.3/cmake-3.30.3-linux-aarch64.tar.gz",
)

http_archive(
    name = "libaom",
    build_file = "@//admin/bazel:third_party/BUILD.libaom.bazel",
    integrity = "sha256-26mfwcKKqt4o3aWYIRZrL6kcBhYtG8mf3g3arXzsxQ4=",
    strip_prefix = "libaom-3.9.1",
    url = "https://storage.googleapis.com/aom-releases/libaom-3.9.1.tar.gz",
)

http_archive(
    name = "libopus",
    build_file = "@//admin/bazel:third_party/BUILD.libopus.bazel",
    integrity = "sha256-ybMrQlO+WuY9H/Fu6ga5S18PKVG3oCrO71jjo85JxR8=",
    strip_prefix = "opus-1.4",
    url = "https://github.com/xiph/opus/releases/download/v1.4/opus-1.4.tar.gz",
)

http_archive(
    name = "zlib",
    build_file = "@//admin/bazel:third_party/BUILD.zlib.bazel",
    integrity = "sha256-mpOyt9/ax3zrpaVYpYDnRmfdb+3kWFuR7vtg8Dty3yM=",
    strip_prefix = "zlib-1.3.1",
    url = "https://zlib.net/zlib-1.3.1.tar.gz",
)
