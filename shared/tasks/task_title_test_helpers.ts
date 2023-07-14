import {decodeBase64} from "~/shared/helpers/binary/base64.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {TaskTitle, TaskTitleUpdate} from "~/shared/tasks/task_title.js";

assert(process.env.NODE_ENV === "test");

/**
 * Some example `TaskTitle`s and `TaskTitleUpdate`s to use in tests.
 */
export const taskTitleTestScenario = {
    // ""
    title0: decodeBase64("AAAAAAAAAQAAAAAAAA==") as TaskTitle,

    // "" -> "h"
    update0: decodeBase64("AAAG6cGihw8AAQAAAwcABAcEZG9jaAMBAwEAAAEGAAECAAA=") as TaskTitleUpdate,

    // "h"
    title1: decodeBase64("AAAG6cGihw8AAQAAAwcABAcEZG9jaAMBAwEAAAEGAAECAAA=") as TaskTitle,

    // "h" -> "he"
    update1: decodeBase64("AAAG6cGihw8AAQIAAYQDAWUBAAAAAQECAA==") as TaskTitleUpdate,

    // "he"
    title2: decodeBase64("AAAG6cGihw8AAQAAAwcABAgFZG9jaGUDAgMBAAABBgABAgAA") as TaskTitle,

    // "he" -> "hello"
    update2: decodeBase64("AAAG6cGihw8AAQQAAYQFA2xsbwMAAAABAQMA") as TaskTitleUpdate,

    // "hello"
    title3: decodeBase64("AAAG6cGihw8AAQAAAwcABAsIZG9jaGVsbG8DBQMBAAABBgABAgAA") as TaskTitle,

    // "hello" -> "Hello"
    update3: decodeBase64("AAAG6cGihw8BAQIBBAHEAwFIAQAAAAEBBgHpoNHDBwEBAA==") as TaskTitleUpdate,

    // "Hello"
    title4: decodeBase64(
        "AAAG6cGihw8DAwACAAEEBwcAAQCEAMQMCGRvY2VsbG9IAwQBAwEAAAEGAQEBBAAB6aDRwwcBAQA=",
    ) as TaskTitle,
};
