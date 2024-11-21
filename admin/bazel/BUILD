platform(
    name = "linux_arm",
    constraint_values = [
        "@platforms//os:linux",
        "@platforms//cpu:arm",
    ],
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
