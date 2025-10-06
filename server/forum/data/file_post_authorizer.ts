import {InternalFilePostAuthorizer} from "~/server/forum/data/internal/forum_realtime_table.js";

// Authorizers must be declared next to their respective Tables, so we must
// re-export from this accessible module.
export const FilePostAuthorizer = InternalFilePostAuthorizer;
