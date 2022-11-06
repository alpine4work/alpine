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

# =========================================================================== #
#                                  Python                                     #
# =========================================================================== #

http_archive(
    name = "rules_python",
    patch_args = ["-p1"],
    patches = ["//admin/patches:rules_python.patch"],
    sha256 = "8c8fe44ef0a9afc256d1e75ad5f448bb59b81aba149b8958f02f7b3a98f5d9b4",
    strip_prefix = "rules_python-0.13.0",
    url = "https://github.com/bazelbuild/rules_python/archive/refs/tags/0.13.0.tar.gz",
)

load("@rules_python//python:repositories.bzl", "python_register_toolchains")

python_register_toolchains(
    name = "python",
    python_version = "3.10.6",
)

load("@python//:defs.bzl", python_interpreter = "interpreter")
load("@rules_python//python:pip.bzl", "pip_parse")

# Define the `pypi_installer` workspace first so we can add the patch from
# this PR:
# https://github.com/pypa/installer/pull/137
http_archive(
    name = "pypi__installer",
    build_file_content = """\
package(default_visibility = ["//visibility:public"])

load("@rules_python//python:defs.bzl", "py_library")

py_library(
    name = "lib",
    srcs = glob(["**/*.py"]),
    data = glob(["**/*"], exclude=["**/*.py", "**/* *", "BUILD", "WORKSPACE"]),
    # This makes this directory a top-level in the python import
    # search path for anything that depends on this.
    imports = ["."],
)
""",
    patch_args = ["-p1"],
    patches = ["//admin/patches:pypi__installer.patch"],
    sha256 = "1d6c8d916ed82771945b9c813699e6f57424ded970c9d8bf16bbc23e1e826ed3",
    type = "zip",
    url = "https://files.pythonhosted.org/packages/1b/21/3e6ebd12d8dccc55bcb7338db462c75ac86dbd0ac7439ac114616b21667b/installer-0.5.1-py3-none-any.whl",
)

pip_parse(
    name = "pypi",
    python_interpreter_target = python_interpreter,
    requirements_lock = "//admin/python:requirements_lock.txt",
)

load("@pypi//:requirements.bzl", pypi_install_deps = "install_deps")

pypi_install_deps()
