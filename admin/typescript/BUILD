load("@aspect_bazel_lib//lib:copy_to_bin.bzl", "copy_to_bin")
load("//admin/typescript:typescript_swc_config.bzl", "typescript_swc_config")

copy_to_bin(
    name = "base",
    srcs = ["base/README.md"],
    visibility = ["//visibility:public"],
)

typescript_swc_config(
    name = "typescript_swc_es6_development_config",
    src = "typescript_swc_config_template.json",
    out = "typescript_swc_es6_development_config.json",
    module_type = "es6",
    react_development = True,
    visibility = ["//visibility:public"],
)

typescript_swc_config(
    name = "typescript_swc_es6_production_config",
    src = "typescript_swc_config_template.json",
    out = "typescript_swc_es6_production_config.json",
    module_type = "es6",
    react_development = False,
    visibility = ["//visibility:public"],
)

typescript_swc_config(
    name = "typescript_swc_commonjs_development_config",
    src = "typescript_swc_config_template.json",
    out = "typescript_swc_commonjs_development_config.json",
    module_type = "commonjs",
    react_development = True,
    visibility = ["//visibility:public"],
)

typescript_swc_config(
    name = "typescript_swc_commonjs_production_config",
    src = "typescript_swc_config_template.json",
    out = "typescript_swc_commonjs_production_config.json",
    module_type = "commonjs",
    react_development = False,
    visibility = ["//visibility:public"],
)

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
