import murmurhash from "murmurhash";
import {
    TaskNotesContent,
    TaskNotesContentSchema,
} from "~/shared/tasks/task_notes_content_schema.js";

/**
 * Stable hash of task notes content. Activity windows compare the hash at the
 * window start against the latest update's after-hash to detect fully reverted
 * edits. Not cryptographic — a collision only risks treating a real change as a
 * revert, which hides one feed entry.
 *
 * The hash is only ever compared for equality, never decoded, so the encoding is
 * opaque. Base 32 fits `murmurhash.v3()`'s 32 bit unsigned integer in 7
 * characters, zero padded so every stored hash is the same width.
 */
export function getTaskNotesContentHash(content: TaskNotesContent): string {
    return murmurhash
        .v3(JSON.stringify(TaskNotesContentSchema.serialize(content)))
        .toString(32)
        .padStart(7, "0");
}
