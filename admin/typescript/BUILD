filegroup(
    name = "typescript_swc_config",
    srcs = select({
        ":compilation_mode_fastbuild": ["typescript_swc_development_config.json"],
        ":compilation_mode_dbg": ["typescript_swc_development_config.json"],
        ":compilation_mode_opt": ["typescript_swc_production_config.json"],
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
