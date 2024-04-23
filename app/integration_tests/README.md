# Integration Tests

Integration tests are implemented with [Playwright][1]. If you're writing or debugging integration
tests, we recommend taking a look at Playwright's tooling capabilities.

## Tips

Some useful things to know when working with Playwright tests:

-   When a test fails Playwright generates videos, images, and traces you can view. These files are
    available in `bazel-testlogs/app/integration_tests/**/test.outputs`. On test failure we also
    will log a command you can run to quickly open the trace (e.g.
    `bazel run //app/integration_tests:tasks/task_notepad_chromium_test_show_trace -- tasks-task_notepad-can-create-new-notepad-pages-chromium/trace.zip`)

-   By default, when running a Playwright test the browser is hidden. If you want to see the browser
    while you may run a test in headed mode by adding the `--headed` flag. (e.g.
    `bazel run //app/integration_tests:chat/chat_peek_chromium_test -- --headed`)

-   If you're running a Playwright test in headed mode you may call `page.pause()` in your test and
    you may interact directly with the test in the browser. It also opens a debugger you may use to
    step through the test one command at a time.

    One useful trick we've found is if you're debugging an error you can pause at the point where
    the error ocurred by surrounding your test in `try`/`catch` and adding a `page.pause()` call in
    the `catch` block.

    For example:

    ```ts
    test("will remember the account being messaged in a chat peek", async () => {
        try {
            // ...
        } catch (error) {
            await page.pause();
            throw error;
        }
    });
    ```

[1]: https://playwright.dev/
