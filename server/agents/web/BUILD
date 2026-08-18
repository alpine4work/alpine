load("@aspect_bazel_lib//lib:copy_file.bzl", "copy_file")
load("@aspect_rules_js//js:defs.bzl", "js_library")
load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "web",
    visibility = ["//server/agents:__subpackages__"],
    test_deps = [
        "//:node_modules/fast-check",
        "//:node_modules/gpt-tokenizer",
        "//server/agents/api/test_helpers",
        "//server/cloudflare",
        "//shared/api/content/test_helpers",
        "//shared/documents",
        "//shared/tasks/test_helpers",
        "//shared/tracer/dev",
        "//server/agents/web/test_helpers",
    ],
    # IMPORTANT: We try to keep the first-party dependency list for our agent
    # service family pretty small. Since long term, we want an ecosystem of
    # agent developers. So we should be ready to open source the code in
    # `//server/agents/web` someday.
    #
    # However, we still write code in our codebase's code style and we still want
    # observability with our tracer framework. So there are some codebase-specific
    # dependencies but we try to keep them few and far between.
    deps = [
        ":agent_web_skill_content_by_path",
        "//:node_modules/@types/mdast",
        "//:node_modules/htmlparser2",
        "//:node_modules/murmurhash",
        "//:node_modules/pretty-bytes",
        "//:node_modules/stemmer",
        "//server/agents/api",
        "//shared/agents",
        "//shared/api/content",
        "//shared/api/content/closed_source",
        "//shared/api/specification",
        "//shared/error",
        "//shared/files",
        "//shared/helpers",
        "//shared/id",
    ],
)

copy_file(
    name = "copy_agent_web_skill_content_by_path",
    src = "//skills:agent_web_skill_content_by_path.open_source.js",
    out = "agent_web_skill_content_by_path.open_source.js",
)

js_library(
    name = "agent_web_skill_content_by_path",
    srcs = [
        "agent_web_skill_content_by_path.open_source.d.ts",
        "agent_web_skill_content_by_path.open_source.js",
    ],
)
