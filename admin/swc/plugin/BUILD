load("@aspect_rules_swc//swc:defs.bzl", "swc_plugin")
load("@swc_plugin_crates//:defs.bzl", "aliases", "all_crate_deps")
load("@rules_rust//rust:defs.bzl", "rust_shared_library")

rust_shared_library(
    name = "plugin_wasm",
    srcs = [
        "src/assert_message.rs",
        "src/lib.rs",
    ],
    edition = "2021",
    platform = "@rules_rust//rust/platform:wasm",
    rustc_flags = select({
        "//admin/bazel:compilation_mode_opt": [
            "--cfg=swc_ast_unknown",

            # These options are recommended by:
            # https://swc.rs/docs/plugin/publishing#adjusting-configuration-for-smaller-binary

            # This removes more dead code
            "-Ccodegen-units=1",
            "-Clto=yes",
            # Optimize for size
            "-Copt-level=s",
            # Strip debug symbols
            "-Cstrip=symbols",
        ],
        "//conditions:default": ["--cfg=swc_ast_unknown"],
    }),
    deps = all_crate_deps(normal = True),
    proc_macro_deps = all_crate_deps(proc_macro = True),
    aliases = aliases(),
)

swc_plugin(
    name = "plugin",
    # We vendor the SWC WASM plugin because building it is quite expensive!
    # Otherwise every CI run, cloud agent run, and developer must pay the cost to
    # build our SWC plugin which updates quite rarely. If we had Bazel remote
    # caching configured this wouldn't matter since Bazel would download the WASM
    # file from the remote cache.
    #
    # To update the vendored WASM file see the command in `README.md`.
    srcs = ["plugin_wasm_vendored.wasm"],
    visibility = ["//visibility:public"],
)
