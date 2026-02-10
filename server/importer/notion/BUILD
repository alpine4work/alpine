load("//admin/typescript:typescript.bzl", "ts_project")

exports_files([
    "test_fixtures/audio.mp3",
    "test_fixtures/image.png",
    "test_fixtures/video.mp4",
])

ts_project(
    name = "notion",
    test_data = glob(
        ["test_fixtures/**"],
    ),
    test_deps = [
        "//server/dynamo/test_helpers",
        "//server/importer/notion/test_helpers",
    ],
    visibility = [
        "//admin:__subpackages__",
        "//app:__subpackages__",
        "//server:__subpackages__",
    ],
    deps = [
        "//:node_modules/fflate",
        "//:node_modules/htmlparser2",
        "//server/accounts/with_spaces",
        "//server/api/content",
        "//server/api/markdown",
        "//server/context",
        "//server/documents/data",
        "//server/dynamo/core",
        "//server/helpers",
        "//server/importer",
        "//server/jobs/core",
        "//server/spaces",
        "//shared/access",
        "//shared/api",
        "//shared/documents",
        "//shared/error",
        "//shared/feed",
        "//shared/helpers",
        "//shared/id",
        "//shared/importer/notion",
        "//shared/schema",
    ],
)
