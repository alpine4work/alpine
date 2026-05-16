load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "index",
    test_deps = [
        "//:node_modules/fuse.js",
        "//:node_modules/prosemirror-transform",
        "//server/access/test_helpers",
        "//server/bots/test_helpers",
        "//server/chat/test_helpers",
        "//server/documents/test_helpers",
        "//server/dynamo/test_helpers",
        "//server/files/test_helpers",
        "//server/forum/test_helpers",
        "//server/sites/test_helpers",
        "//server/spaces/test_helpers",
        "//server/tasks/test_helpers",
        "//shared/spaces/test_helpers",
        "//shared/test_helpers",
    ],
    tests = {
        "search_entity_index_test": {
            "size": "medium",
            # Give this test at least three CPUs. Two for OpenSearch, one for the test
            # process.
            "tags": ["cpu:3"],
            "data": ["//server/language_models/all_mini_lm_l6_v2:all_mini_lm_l6_v2_data_testonly"],
        },
        "search_entity_index_documents_test": {
            "size": "medium",
            # Give this test at least three CPUs. Two for OpenSearch, one for the test
            # process.
            "tags": ["cpu:3"],
        },
        "search_entity_index_forum_test": {
            "size": "medium",
            # Give this test at least three CPUs. Two for OpenSearch, one for the test
            # process.
            "tags": ["cpu:3"],
        },
        "search_entity_index_tasks_test": {
            "size": "medium",
            # Give this test at least three CPUs. Two for OpenSearch, one for the test
            # process.
            "tags": ["cpu:3"],
        },
        "search_entity_index_mentions_test": {
            "size": "medium",
            # Give this test at least three CPUs. Two for OpenSearch, one for the test
            # process.
            "tags": ["cpu:3"],
        },
        "get_message_references_for_multiple_accounts_test": {
            "size": "medium",
        },
        "search_entity_index_sites_test": {
            "size": "medium",
            # Give this test at least three CPUs. Two for OpenSearch, one for the test
            # process.
            "tags": ["cpu:3"],
            "data": ["//server/language_models/all_mini_lm_l6_v2:all_mini_lm_l6_v2_data_testonly"],
        },
    },
    visibility = [
        "//admin:__subpackages__",
        "//server:__subpackages__",
    ],
    deps = [
        "//:node_modules/@types/damerau-levenshtein",
        "//:node_modules/@types/mdast",
        "//:node_modules/compromise",
        "//:node_modules/compromise-dates",
        "//:node_modules/damerau-levenshtein",
        "//:node_modules/mdast-util-from-markdown",
        "//:node_modules/mdast-util-gfm-strikethrough",
        "//:node_modules/micromark-extension-gfm-strikethrough",
        "//:node_modules/murmurhash",
        "//:node_modules/prosemirror-model",
        "//:node_modules/stemmer",
        "//server/access",
        "//server/accounts",
        "//server/chat/data",
        "//server/content",
        "//server/context",
        "//server/documents/data",
        "//server/files/data",
        "//server/forum/data",
        "//server/language_models/all_mini_lm_l6_v2",
        "//server/language_models/cohere_embed_english_v3",
        "//server/language_models/core",
        "//server/messaging/helpers",
        "//server/opensearch",
        "//server/search/core",
        "//server/search/data/table",
        "//server/sites/data",
        "//server/spaces",
        "//server/tasks/data",
        "//server/tokens",
        "//shared/access",
        "//shared/accounts",
        "//shared/api/content",
        "//shared/content",
        "//shared/context",
        "//shared/design:design_core",
        "//shared/documents",
        "//shared/error:error_core",
        "//shared/files",
        "//shared/forum",
        "//shared/helpers",
        "//shared/helpers:helpers_core",
        "//shared/id",
        "//shared/messaging",
        "//shared/opensearch",
        "//shared/schema",
        "//shared/search",
        "//shared/spaces",
        "//shared/tasks",
        "//shared/tasks/title",
        "//shared/tracer",
    ],
)
