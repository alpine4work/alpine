load("@aspect_bazel_lib//lib:write_source_files.bzl", "write_source_files")
load("@aspect_rules_js//js:defs.bzl", "js_binary", "js_run_binary")
load("//admin/typescript:typescript.bzl", "ts_project")

MARKDOWN_FILES = glob(["*/*.internal.md"])

filegroup(
    name = "skills",
    srcs = glob(["*/*.open_source.md"]),
    visibility = ["//visibility:public"],
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
    srcs = MARKDOWN_FILES,
    args = MARKDOWN_FILES,
    outs = ["agent_web_skill_content_by_path.open_source.js"] + ["{}.open_source.generated.md".format(file[:-len(".internal.md")]) for file in MARKDOWN_FILES],
    tool = ":generate_skills",
    chdir = package_name(),
    visibility = ["//server/agents/web:__pkg__"],
)

write_source_files(
    name = "write_skills",
    files = {
        "{}.open_source.md".format(file[:-len(".internal.md")]): "{}.open_source.generated.md".format(file[:-len(".internal.md")])
        for file in MARKDOWN_FILES
    },
)
