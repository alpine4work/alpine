load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "lmdb",
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
        "//:node_modules/lmdb",
        "//:node_modules/ordered-binary",
        "//server/agents/web",
        "//shared/helpers",
        "//shared/id",
    ],
)
