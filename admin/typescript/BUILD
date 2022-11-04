load("@aspect_bazel_lib//lib:copy_to_bin.bzl", "copy_to_bin")

copy_to_bin(
    name = "typescript_swc_config",
    srcs = select({
        ":compilation_mode_fastbuild": ["typescript-swc-development-config.json"],
        ":compilation_mode_dbg": ["typescript-swc-development-config.json"],
        ":compilation_mode_opt": ["typescript-swc-production-config.json"],
    }),
    visibility = ["//visibility:public"],
)

config_setting(
    name = "compilation_mode_fastbuild",
    values = {"compilation_mode": "fastbuild"},
)

config_setting(
    name = "compilation_mode_dbg",
    values = {"compilation_mode": "dbg"},
)

config_setting(
    name = "compilation_mode_opt",
    values = {"compilation_mode": "opt"},
)
