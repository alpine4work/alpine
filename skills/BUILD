load("@aspect_bazel_lib//lib:write_source_files.bzl", "write_source_files")
load("@aspect_rules_js//js:defs.bzl", "js_binary", "js_run_binary")
load("@rules_pkg//pkg:mappings.bzl", "pkg_files")
load("//admin/typescript:typescript.bzl", "ts_project")

INTERNAL_MARKDOWN_FILES = glob(["*/*.internal.md"])
OPEN_SOURCE_MARKDOWN_FILES = glob(["*/*.open_source.md"])

# This is not a publication filegroup. It lists the private source files that generate a tagged
# JavaScript map consumed by the public CLI. The archive configuration uses it only to decide when
# the public-repository CI must rebuild that generated output.
filegroup(
    name = "open_source_generated_source_inputs",
    srcs = [
        "BUILD",
        "generate_skills_main.ts",
    ] + INTERNAL_MARKDOWN_FILES,
    visibility = ["//admin/open_source:__pkg__"],
)

pkg_files(
    name = "skills",
    srcs = OPEN_SOURCE_MARKDOWN_FILES,
    renames = {
        file: file.replace(".open_source.", ".")
        for file in OPEN_SOURCE_MARKDOWN_FILES
    },
    visibility = [
        "//admin/open_source:__pkg__",
        "//server/agents/bots_v2/sandbox:__pkg__",
    ],
)

ts_project(
    name = "skills_lib",
    deps = [
        "//:node_modules/@types/mdast",
        "//:node_modules/@types/node",
        "//:node_modules/htmlparser2",
        "//:node_modules/yaml",
        "//shared/api/content",
        "//shared/error",
        "//shared/helpers",
    ],
)

js_binary(
    name = "generate_skills",
    data = [":skills_lib"],
    entry_point = "generate_skills_main.js",
    env = {"NODE_ENV": "development"},
)

js_run_binary(
    name = "skills_generated",
    srcs = INTERNAL_MARKDOWN_FILES,
    args = INTERNAL_MARKDOWN_FILES,
    outs = ["agent_web_skill_content_by_path.open_source.js"] + ["{}.open_source.generated.md".format(file[:-len(".internal.md")]) for file in INTERNAL_MARKDOWN_FILES],
    tool = ":generate_skills",
    chdir = package_name(),
    visibility = ["//server/agents/web:__pkg__"],
)

write_source_files(
    name = "write_skills",
    files = {
        "{}.open_source.md".format(file[:-len(".internal.md")]): "{}.open_source.generated.md".format(file[:-len(".internal.md")])
        for file in INTERNAL_MARKDOWN_FILES
    },
)
