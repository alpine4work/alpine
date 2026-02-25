load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "shared",
    test_deps = [
        "//server/bots/test_helpers",
        "//server/dynamo/test_helpers",
        "//server/spaces/test_helpers",
        "//shared/documents",
        "//shared/forum",
    ],
    visibility = ["//server/api:__subpackages__"],
    deps = [
        "//:node_modules/@lezer/json",
        "//:node_modules/@types/escape-html",
        "//:node_modules/@types/negotiator",
        "//:node_modules/@types/node",
        "//:node_modules/@types/prettier",
        "//:node_modules/ajv",
        "//:node_modules/ajv-formats",
        "//:node_modules/cookie",
        "//:node_modules/escape-html",
        "//:node_modules/find-my-way",
        "//:node_modules/negotiator",
        "//:node_modules/openapi-types",
        "//:node_modules/prettier",
        "//:node_modules/prosemirror-model",
        "//:node_modules/yaml",
        "//server/api/content",
        "//server/api/markdown",
        "//server/bots",
        "//server/content",
        "//server/context",
        "//server/files/data",
        "//server/helpers",
        "//server/helpers/node",
        "//server/language_models/core",
        "//server/messaging/helpers",
        "//server/node",
        # NOTE(calebmer): Design goal for the API Bazel packages was to only depend on
        # `//server/documents` stuff in `//server/api/internal/documents` so a change
        # to forum code wouldn't need to re-run document API tests. However, taking
        # this dependency breaks that design goal. Can't think of a better approach for
        # now, but we should try to clean this dependency up eventually. (Maybe
        # fallback search entity loaders need to be implemented in feature packages.)
        "//server/search/data/index",
        "//server/spaces",
        "//server/tokens",
        "//server/tracer",
        "//shared/accounts",
        "//shared/api",
        "//shared/content",
        "//shared/content/code",
        "//shared/context",
        "//shared/design",
        "//shared/error",
        "//shared/helpers",
        "//shared/id",
        "//shared/messaging",
        "//shared/search",
        "//shared/spaces",
        "//shared/tracer",
    ],
)
