import {InternalFileChatAuthorizer} from "~/server/chat/data/internal/chat_table.js";

// Authorizers must be declared next to their respective Tables, so we must
// re-export from this accessible module.
export const FileChatAuthorizer = InternalFileChatAuthorizer;
