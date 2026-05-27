load("//admin/playwright:playwright.bzl", "ts_playwright_tests")

# TODO(calebmer): I want to develop a design catalog using Playwright. The
# catalog's goal will be to take a screenshot of every single feature in the
# product. So we can test for visual changes across commits. If a screenshot
# changes in a commit, it should send a post to a channel of design catalog
# changes that designers and me (@calebmer) can review.
#
# The catalog will also be used to produce marketing screenshots. That way we
# can reliably reproduce marketing screenshots in case the design changes or
# we need a new format.
#
# Running list of surfaces I want to make sure we have screenshots for:
#
# - Marketing materials
# - All routes across desktop, mobile, and peeks
# - All routes scrolled down where both the navigation bar is revealed and
#   hidden
# - All route shimmers (preferably in debug mode so we can clearly see if
#   the shimmer lines up with the underlying design)
# - The preview, desktop viewer, and mobile viewer of all file types
# - Remember to screenshot as many overlays and modals as possible (e.g.
#   delete confirmation modals, right click context menus, etc.)
# - Inline editing states for channel name, channel description, post, task
#   collection name, etc.
# - All task filters and sorts.
# - Editing a post that ends with a file that has an "(edited)" note. We want
#   to exercise that has the same layout as `<ContentView>`.

ts_playwright_tests(
    name = "integration_tests",
    data = [
        "//admin/environment/test/integration:integration_data",
        "//server/files/processor:test_fixtures/py_pdf_sample_google_doc_document.pdf",
        "//server/files/processor:test_fixtures/undraw_landscape_photographer.svg",
        "//server/files/processor:test_fixtures/unsplash_annie_spratt_0ArJET2aSIQ.jpeg",
        "//server/files/processor:test_fixtures/wikimedia_france_vs_czech_republic_2013_09_21.avif",
        "//server/files/processor:test_fixtures/wikimedia_png_transparency_demonstration.png",
        "//server/importer/notion:test_fixtures/audio.mp3",
        "//server/importer/notion:test_fixtures/image.png",
        "//server/importer/notion:test_fixtures/video.mp4",
    ],
    deps = [
        "//:node_modules/@types/fs-extra",
        "//:node_modules/@types/node",
        "//:node_modules/@types/set-cookie-parser",
        "//:node_modules/@types/ws",
        "//:node_modules/fs-extra",
        "//:node_modules/get-port",
        "//:node_modules/set-cookie-parser",
        "//:node_modules/sharp",
        "//:node_modules/ws",
        "//admin/environment/test/integration",
        "//admin/helpers",
        "//app:app_lib",
        "//server/accounts",
        "//server/chat/test_helpers",
        "//server/documents/test_helpers",
        "//server/dynamo/test_helpers",
        "//server/feed",
        "//server/forum/test_helpers",
        "//server/helpers/node",
        "//server/importer/notion/test_helpers",
        "//server/remix",
        "//server/sites/test_helpers",
        "//server/spaces/test_helpers",
        "//server/tasks/test_helpers",
        "//server/tokens",
        "//shared/test_helpers",
    ],
)
