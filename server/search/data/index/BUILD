load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "index",
    test_deps = [
        "//server/accounts/update_name",
        "//server/documents/test_helpers",
        "//server/dynamo/test_helpers",
        "//server/chat/test_helpers",
        "//server/forum/test_helpers",
        "//server/spaces/test_helpers",
        "//server/spaces/with_search",
        "//server/tasks/test_helpers",
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
    },
    visibility = [
        "//admin/crawl:__pkg__",
        "//admin/opensearch/deploy_script:__pkg__",
        "//server/content/context_module:__pkg__",
        "//server/jobs/queue:__pkg__",
        "//server/rpc:__pkg__",
    ],
    deps = [
        "//:node_modules/@types/damerau-levenshtein",
        "//:node_modules/@types/fs-extra",
        "//:node_modules/@types/mdast",
        "//:node_modules/compromise",
        "//:node_modules/compromise-dates",
        "//:node_modules/damerau-levenshtein",
        "//:node_modules/date-fns",
        "//:node_modules/fs-extra",
        "//:node_modules/mdast-util-from-markdown",
        "//:node_modules/mdast-util-gfm-strikethrough",
        "//:node_modules/micromark-extension-gfm-strikethrough",
        "//:node_modules/murmurhash",
        "//:node_modules/prosemirror-model",
        "//:node_modules/stemmer",
        "//server/chat/data",
        "//server/documents/data",
        "//server/forum/data",
        "//server/helpers/node",
        "//server/language_models/all_mini_lm_l6_v2",
        "//server/language_models/cohere_embed_english_v3",
        "//server/opensearch",
        "//server/search/core",
        "//server/search/data/table",
        "//server/tasks/data",
        "//shared/error",
        "//shared/helpers",
        "//shared/schema",
        "//shared/search",
    ],
)
