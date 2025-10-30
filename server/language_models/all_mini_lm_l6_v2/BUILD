load("@aspect_rules_js//js:defs.bzl", "js_library")
load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "all_mini_lm_l6_v2",
    visibility = [
        "//admin/adhoc:__pkg__",
        "//app:__pkg__",
        "//server:__subpackages__",
    ],
    deps = [
        "//:node_modules/@types/node",
        "//:node_modules/@xenova/transformers",
        "//server/helpers",
        "//server/helpers/node",
        "//server/language_models/core",
        "//shared/error",
        "//shared/helpers",
    ],
)

# This model's file size is pretty big! I mean, it's small enough to make
# running locally reasonable but large enough that you should avoid including
# it in a production container since it'll slow down the container download
# time.
#
# The preferred pattern is for the top-level rule to take a dependency on these
# files and pass some `--modelPath` arg to a process which needs the model.
js_library(
    name = "all_mini_lm_l6_v2_data",
    data = [
        "@all_mini_lm_l6_v2_config//file",
        "@all_mini_lm_l6_v2_onnx_model_quantized//file",
        "@all_mini_lm_l6_v2_tokenizer//file",
        "@all_mini_lm_l6_v2_tokenizer_config//file",
    ],
    no_copy_to_bin = [
        "@all_mini_lm_l6_v2_config//file",
        "@all_mini_lm_l6_v2_onnx_model_quantized//file",
        "@all_mini_lm_l6_v2_tokenizer//file",
        "@all_mini_lm_l6_v2_tokenizer_config//file",
    ],
    visibility = [
        "//admin/adhoc:__pkg__",
        "//admin/dev:__pkg__",
        "//app/integration_tests:__pkg__",
        "//server/api/internal/test_helpers:__pkg__",
    ],
)

# Broader visibility if you're using the model data only for tests.
alias(
    name = "all_mini_lm_l6_v2_data_testonly",
    testonly = True,
    actual = ":all_mini_lm_l6_v2_data",
    visibility = [
        "//server/search:__subpackages__",
    ],
)
