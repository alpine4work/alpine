import {InternalFileTaskAuthorizer} from "~/server/tasks/data/internal/task_table.js";

// Authorizers must be declared next to their respective Tables, so we must
// re-export from this accessible module.
export const FileTaskAuthorizer = InternalFileTaskAuthorizer;
