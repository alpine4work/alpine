load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "web",
    test_deps = [
        "//:node_modules/fast-check",
        "//server/cloudflare",
        "//shared/api/markdown/test_helpers",
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
        "//:node_modules/@types/mdast",
        "//:node_modules/htmlparser2",
        "//:node_modules/prettier",
        "//:node_modules/pretty-bytes",
        "//server/agents/api",
        "//shared/api/markdown",
        "//shared/api/specification",
        "//shared/error",
        "//shared/helpers",
        "//shared/id",
    ],
)
