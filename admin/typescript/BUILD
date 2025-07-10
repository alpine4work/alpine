filegroup(
    name = "typescript_swc_es6_config",
    srcs = select({
        "//admin/bazel:compilation_mode_fastbuild": ["typescript_swc_es6_development_config.json"],
        "//admin/bazel:compilation_mode_dbg": ["typescript_swc_es6_development_config.json"],
        "//admin/bazel:compilation_mode_opt": ["typescript_swc_es6_production_config.json"],
    }),
    visibility = ["//visibility:public"],
)

filegroup(
    name = "typescript_swc_commonjs_config",
    srcs = select({
        "//admin/bazel:compilation_mode_fastbuild": ["typescript_swc_commonjs_development_config.json"],
        "//admin/bazel:compilation_mode_dbg": ["typescript_swc_commonjs_development_config.json"],
        "//admin/bazel:compilation_mode_opt": ["typescript_swc_commonjs_production_config.json"],
    }),
    visibility = ["//visibility:public"],
)
