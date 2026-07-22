/* eslint-disable cyberworlds/no-global-error */

import {printAgentWebError} from "~/server/agents/web/print_agent_web_error.js";
import {defaultErrorDisplayMessage} from "~/shared/error/default_error_display_message.js";
import {InternalError, InvalidArgumentError, NotFoundError} from "~/shared/error/error.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";

test("prints every display message segment without the link URL", async () => {
    const error = new InvalidArgumentError("Internal message", {
        displayMessage: errorDisplayMessage`Couldn\u2019t update ${"Roadmap"}. ${errorDisplayMessage.link("Open the task", "/task/roadmap")} and try again.`,
    });

    await expect(printAgentWebError("Update failed", error)).resolves.toBe(`\
Error: Update failed. Couldn\u2019t update Roadmap. Open the task and try again.`);
});

test("prints every display message in an AggregateError", async () => {
    const error = new AggregateError(
        [
            new InvalidArgumentError("First internal message", {
                displayMessage: errorDisplayMessage`Fix the first task.`,
            }),
            new NotFoundError("Second internal message", {
                displayMessage: errorDisplayMessage`Restore ${"Launch plan"} and try again.`,
            }),
        ],
        "Aggregate internal message",
    );

    await expect(printAgentWebError("Update failed", error)).resolves.toBe(`\
Error: Update failed. (2 errors)

Fix the first task.

Restore Launch plan and try again.`);
});

test("prints every display message in an AggregateError with an empty title", async () => {
    const error = new AggregateError([
        new InvalidArgumentError("First internal message", {
            displayMessage: errorDisplayMessage`Fix the first task.`,
        }),
        new NotFoundError("Second internal message", {
            displayMessage: errorDisplayMessage`Restore the launch plan and try again.`,
        }),
    ]);

    await expect(printAgentWebError("", error)).resolves.toBe(`\
Error: (2 errors)

Fix the first task.

Restore the launch plan and try again.`);
});

test("prints one AggregateError display message as a single error", async () => {
    const error = new AggregateError([
        new InvalidArgumentError("Internal message", {
            displayMessage: errorDisplayMessage`Fix the task and try again.`,
        }),
    ]);

    await expect(printAgentWebError("", error)).resolves.toBe(`\
Error: Fix the task and try again.`);
});

test("hides all AggregateError display messages when one plain Error has none", async () => {
    const error = new AggregateError(
        [
            new InvalidArgumentError("First internal message", {
                displayMessage: errorDisplayMessage`Fix the first task.`,
            }),
            new Error("Second internal message"),
        ],
        "Couldn\u2019t update **two** tasks",
    );

    await expect(printAgentWebError("Update failed", error)).resolves.toBe(`\
Error: Update failed. An unexpected error occurred, please try again. If the problem continues, let us know at support@alpine.inc

> Internal error: Couldn\u2019t update \\*\\*two\\*\\* tasks`);
});

test("hides all AggregateError display messages when one ErrorBase has none", async () => {
    const error = new AggregateError(
        [
            new InvalidArgumentError("First internal message", {
                displayMessage: errorDisplayMessage`Fix the first task.`,
            }),
            new InvalidArgumentError("Second internal message"),
        ],
        "Couldn\u2019t update two tasks",
    );

    await expect(printAgentWebError("", error)).resolves.toBe(`\
Error: An unexpected error occurred, please try again. If the problem continues, let us know at support@alpine.inc

> Internal error: Couldn\u2019t update two tasks`);
});

test("prints an empty AggregateError as an unexpected internal error", async () => {
    const error = new AggregateError([], "No task errors were provided");

    await expect(printAgentWebError("Create failed", error)).resolves.toBe(`\
Error: Create failed. An unexpected error occurred, please try again. If the problem continues, let us know at support@alpine.inc

> Internal error: No task errors were provided`);
});

test("prints an ErrorBase without a display message as an unexpected internal error", async () => {
    const error = new InvalidArgumentError("Task ID is invalid");

    await expect(printAgentWebError("", error)).resolves.toBe(`\
Error: An unexpected error occurred, please try again. If the problem continues, let us know at support@alpine.inc

> Internal error: Task ID is invalid`);
});

test("prints the server error behind a generic API display message", async () => {
    const error = new InternalError("API request failed", {
        displayMessage: defaultErrorDisplayMessage,
        cause: {
            status: 500,
            error: {
                message:
                    "An unexpected error occurred, please try again. If the problem continues, let us know at support@alpine.inc",
                retry: {able: false},
                stack: "UnimplementedError: Creating room chats from the API isn\u2019t implemented yet\n    at createChat",
            },
        },
    });

    await expect(printAgentWebError("Couldn\u2019t create chat", error)).resolves.toBe(`\
Error: Couldn\u2019t create chat. An unexpected error occurred, please try again. If the problem continues, let us know at support@alpine.inc

> Internal error: Creating room chats from the API isn\u2019t implemented yet`);
});

test("prints a non-Error value without an internal error message", async () => {
    await expect(printAgentWebError("Update failed", "Task ID is invalid")).resolves.toBe(`\
Error: Update failed. An unexpected error occurred, please try again. If the problem continues, let us know at support@alpine.inc`);
});

test("escapes special characters in an internal error message", async () => {
    const error = new Error("First line\nSecond line\r\nTabbed\tNUL\0 quote \u201C backslash \\");

    await expect(printAgentWebError("", error)).resolves.toBe(`\
Error: An unexpected error occurred, please try again. If the problem continues, let us know at support@alpine.inc

> Internal error: First line\\nSecond line\\r\\nTabbed\\tNUL\\u0000 quote \u201C backslash \\\\\\\\`);
});

test("escapes Markdown formatting in an internal error message", async () => {
    const error = new Error("Markdown: **bold**, _italic_, `code`, [link], <tag>, &quot;.");

    await expect(printAgentWebError("Read failed", error)).resolves.toBe(`\
Error: Read failed. An unexpected error occurred, please try again. If the problem continues, let us know at support@alpine.inc

> Internal error: Markdown: \\*\\*bold\\*\\*, \\_italic\\_, \\\`code\\\`, \\[link], \\<tag>, \\&quot;.`);
});
