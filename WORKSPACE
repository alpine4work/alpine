workspace(name = "cyberworlds")

load("@bazel_tools//tools/build_defs/repo:http.bzl", "http_archive")

# =========================================================================== #
#                                 TypeScript                                  #
# =========================================================================== #

http_archive(
    name = "aspect_rules_ts",
    sha256 = "1149d4cf7f210de67e0fc5cd3e8f624de3ee976ac05af4f1484e57a74c12f2dc",
    strip_prefix = "rules_ts-1.0.0-rc5",
    url = "https://github.com/aspect-build/rules_ts/archive/refs/tags/v1.0.0-rc5.tar.gz",
)

load("@aspect_rules_ts//ts:repositories.bzl", "rules_ts_dependencies")

rules_ts_dependencies(ts_version = "4.8.2")

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
load("//admin/patches:patches.bzl", "NPM_PATCHES")

npm_translate_lock(
    name = "npm",
    patch_args = {
        package: ["-p1"]
        for package in NPM_PATCHES
    },
    patches = NPM_PATCHES,
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
    sha256 = "313307136cb6369f3c9d2992209c1e354b3e2c9989877ee67c688917320fba1f",
    strip_prefix = "rules_swc-0.17.1",
    url = "https://github.com/aspect-build/rules_swc/archive/refs/tags/v0.17.1.tar.gz",
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
    sha256 = "1e365451341ffb2490193292dfd9953f2ca009586c2381cb4dc08d01e48866b7",
    strip_prefix = "rules_esbuild-0.12.0",
    url = "https://github.com/aspect-build/rules_esbuild/archive/refs/tags/v0.12.0.tar.gz",
)

load("@aspect_rules_esbuild//esbuild:dependencies.bzl", "rules_esbuild_dependencies")

rules_esbuild_dependencies()

load("@aspect_rules_esbuild//esbuild:repositories.bzl", "esbuild_register_toolchains")

esbuild_register_toolchains(
    name = "esbuild",
    esbuild_version = "0.14.51",
)
