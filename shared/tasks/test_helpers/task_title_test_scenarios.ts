import {decodeBase64} from "~/shared/helpers/binary/base64.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {TaskTitle, TaskTitleUpdate, emptyTaskTitleModel} from "~/shared/tasks/title/task_title.js";

assert(process.env.NODE_ENV === "test");

/**
 * Scenario where we type one letter at a time to form a word.
 */
export const wordTaskTitleTestScenario = {
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

/**
 * Scenario where we type one word at a time to form a sentence.
 *
 * The sentence comes from the [Unicode default word boundary
 * specification][1] example.
 *
 * [1]: https://unicode.org/reports/tr29/#Default_Word_Boundaries
 */
export const sentenceTaskTitleTestScenario = {
    // "The quick ("brown") fox can't jump 32.3 feet, right?"
    title: decodeBase64(
        "AAAG6cGihw8AAQAAAwcABEA9ZG9jVGhlIHF1aWNrICjigJxicm93buKAnSkgZm94IGNhbuKAmXQganVtcCAzMi4zIGZlZXQsIHJpZ2h0PwM0AwEAAAEGAAECAAA=",
    ) as TaskTitle,

    title0: decodeBase64("AAAAAAAAAQAAAAAAAA==") as TaskTitle,
    update0: decodeBase64(
        "AAAG6cGihw8AAQAAAwcABAoHZG9jVGhlIAMEAwEAAAEGAAECAAA=",
    ) as TaskTitleUpdate,
    title1: decodeBase64("AAAG6cGihw8AAQAAAwcABAoHZG9jVGhlIAMEAwEAAAEGAAECAAA=") as TaskTitle,
    update1: decodeBase64("AAAG6cGihw8AAQgAAYQIBnF1aWNrIAYAAAABAQUA") as TaskTitleUpdate,
    title2: decodeBase64(
        "AAAG6cGihw8AAQAAAwcABBANZG9jVGhlIHF1aWNrIAMKAwEAAAEGAAECAAA=",
    ) as TaskTitle,
    update2: decodeBase64(
        "AAAG6cGihw8AARQAAYQQDijigJxicm93buKAnSkgCgAAAAEBCwA=",
    ) as TaskTitleUpdate,
    title3: decodeBase64(
        "AAAG6cGihw8AAQAAAwcABB4bZG9jVGhlIHF1aWNrICjigJxicm93buKAnSkgAxQDAQAAAQYAAQIAAA==",
    ) as TaskTitle,
    update3: decodeBase64("AAAG6cGihw8AASgAAYQGBGZveCAEAAAAAQEVAA==") as TaskTitleUpdate,
    title4: decodeBase64(
        "AAAG6cGihw8AAQAAAwcABCIfZG9jVGhlIHF1aWNrICjigJxicm93buKAnSkgZm94IAMYAwEAAAEGAAECAAA=",
    ) as TaskTitle,
    update4: decodeBase64("AAAG6cGihw8AATAAAYQKCGNhbuKAmXQgBgAAAAEBGQA=") as TaskTitleUpdate,
    title5: decodeBase64(
        "AAAG6cGihw8AAQAAAwcABConZG9jVGhlIHF1aWNrICjigJxicm93buKAnSkgZm94IGNhbuKAmXQgAx4DAQAAAQYAAQIAAA==",
    ) as TaskTitle,
    update5: decodeBase64("AAAG6cGihw8AATwAAYQHBWp1bXAgBQAAAAEBHwA=") as TaskTitleUpdate,
    title6: decodeBase64(
        "AAAG6cGihw8AAQAAAwcABC8sZG9jVGhlIHF1aWNrICjigJxicm93buKAnSkgZm94IGNhbuKAmXQganVtcCADIwMBAAABBgABAgAA",
    ) as TaskTitle,
    update6: decodeBase64("AAAG6cGihw8AAoYBAAGEBwUzMi4zIAUAAAABASQA") as TaskTitleUpdate,
    title7: decodeBase64(
        "AAAG6cGihw8AAQAAAwcABDQxZG9jVGhlIHF1aWNrICjigJxicm93buKAnSkgZm94IGNhbuKAmXQganVtcCAzMi4zIAMoAwEAAAEGAAECAAA=",
    ) as TaskTitle,
    update7: decodeBase64("AAAG6cGihw8AApABAAGECAZmZWV0LCAGAAAAAQEpAA==") as TaskTitleUpdate,
    title8: decodeBase64(
        "AAAG6cGihw8AAQAAAwcABDo3ZG9jVGhlIHF1aWNrICjigJxicm93buKAnSkgZm94IGNhbuKAmXQganVtcCAzMi4zIGZlZXQsIAMuAwEAAAEGAAECAAA=",
    ) as TaskTitle,
    update8: decodeBase64("AAAG6cGihw8AApwBAAGECAZyaWdodD8GAAAAAQEvAA==") as TaskTitleUpdate,
    title9: decodeBase64(
        "AAAG6cGihw8AAQAAAwcABEA9ZG9jVGhlIHF1aWNrICjigJxicm93buKAnSkgZm94IGNhbuKAmXQganVtcCAzMi4zIGZlZXQsIHJpZ2h0PwM0AwEAAAEGAAECAAA=",
    ) as TaskTitle,
};

export const createTaskTitleFromText = (text: string) => {
    const title = emptyTaskTitleModel.get();
    const update = title.replace(0, 0, text);
    return title.apply(update);
};
