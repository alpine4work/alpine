load("//admin/typescript:typescript.bzl", "ts_project")

ts_project(
    name = "test_helpers",
    testonly = True,
    test_data = [
        "//server/importer/notion:test_fixtures/image.png",
        "//server/importer/notion:test_fixtures/video.mp4",
        "//server/importer/notion:test_fixtures/audio.mp3",
    ],
    visibility = ["//visibility:public"],
    deps = [
        "//:node_modules/@types/node",
        "//:node_modules/fflate",
        "//server/importer/notion",
        "//shared/helpers",
    ],
)
