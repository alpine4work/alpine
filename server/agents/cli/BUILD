load("@aspect_rules_js//js:defs.bzl", "js_binary")
load("//admin/typescript:typescript.bzl", "ts_project")

exports_files(
    ["micromark_parse_options.open_source.d.ts"],
    visibility = ["//admin/open_source:__pkg__"],
)

ts_project(
    name = "cli_lib",
    visibility = ["//server/agents:__subpackages__"],
    # IMPORTANT: We try to keep the first-party dependency list for our agent
    # service family pretty small. Since long term, we want an ecosystem of
    # agent developers. So we should be ready to open source the code in
    # `//server/agents/web` someday.
    #
    # However, we still write code in our codebase's code style and we still want
    # observability with our tracer framework. So there are some codebase-specific
    # dependencies but we try to keep them few and far between.
    deps = [
        "//:node_modules/@lezer/highlight",
        "//:node_modules/@lezer/markdown",
        "//:node_modules/@types/node",
        "//:node_modules/chalk",
        "//:node_modules/date-fns",
        "//:node_modules/env-paths",
        "//:node_modules/lmdb",
        "//:node_modules/ordered-binary",
        "//:node_modules/prettier",
        "//:node_modules/strip-ansi",
        "//server/agents/api",
        "//server/agents/lmdb",
        "//server/agents/web",
        "//shared/api/content",
        "//shared/api/content/closed_source",
        "//shared/api/specification",
        "//shared/error",
        "//shared/helpers",
        "//shared/id",
        "//shared/lezer",
        "//shared/tracer",
    ],
)

js_binary(
    name = "cli",
    data = [":cli_lib"],
    entry_point = "cli_main.open_source.js",
    env = {"NODE_ENV": "development"},
    visibility = [
        "//admin/open_source:__pkg__",
        "//server/agents/cli:__subpackages__",
    ],
)
