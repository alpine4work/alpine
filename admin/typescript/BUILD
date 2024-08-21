filegroup(
    name = "typescript_swc_config",
    srcs = select({
        "//admin/bazel:compilation_mode_fastbuild": ["typescript_swc_development_config.json"],
        "//admin/bazel:compilation_mode_dbg": ["typescript_swc_development_config.json"],
        "//admin/bazel:compilation_mode_opt": ["typescript_swc_production_config.json"],
    }),
    visibility = ["//visibility:public"],
)
