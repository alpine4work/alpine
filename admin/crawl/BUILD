load("@aspect_bazel_lib//lib:lists.bzl", "unique")
load("@aspect_rules_js//js:defs.bzl", "js_library")
load("//admin/typescript:typescript.bzl", "ts_project")
load("//server/dynamo/core:dynamo_core_visibility.bzl", "DYNAMO_CORE_VISIBILITY")
load("//server/opensearch:opensearch_visibility.bzl", "OPENSEARCH_VISIBILITY")

ts_project(
    name = "crawl",
    data = unique(DYNAMO_CORE_VISIBILITY + OPENSEARCH_VISIBILITY),
    visibility = [
        "//admin/aws:__pkg__",
        "//admin/dynamo:__pkg__",
    ],
    deps = [
        ":dynamo_core_visibility",
        ":opensearch_visibility",
        "//:node_modules/fast-glob",
        "//server/dynamo/core",
        "//server/rynamo",
        "//server/helpers/node",
        "//server/opensearch",
        "//shared/helpers",
    ],
)

genrule(
    name = "dynamo_core_visibility_src",
    outs = ["dynamo_core_visibility.js"],
    cmd = "echo \"export const dynamoCoreVisibilityBazelPackagePaths = [\n{}];\" > \"$@\"".format(
        "".join([
            "    \\\"{}\\\",\n".format(label[2:])
            for label in DYNAMO_CORE_VISIBILITY
        ]),
    ),
)

js_library(
    name = "dynamo_core_visibility",
    srcs = ["dynamo_core_visibility.js"],
)

genrule(
    name = "opensearch_visibility_src",
    outs = ["opensearch_visibility.js"],
    cmd = "echo \"export const opensearchVisibilityBazelPackagePaths = [\n{}];\" > \"$@\"".format(
        "".join([
            "    \\\"{}\\\",\n".format(label[2:])
            for label in OPENSEARCH_VISIBILITY
        ]),
    ),
)

js_library(
    name = "opensearch_visibility",
    srcs = ["opensearch_visibility.js"],
)
