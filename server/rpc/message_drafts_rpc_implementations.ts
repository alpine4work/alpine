import {clearMessageDraft} from "~/server/messaging/drafts/clear_message_draft.js";
import {getMessageDraft} from "~/server/messaging/drafts/get_message_draft.js";
import {getMessageDraftFiles} from "~/server/messaging/drafts/get_message_draft_files.js";
import {updateMessageDraft} from "~/server/messaging/drafts/update_message_draft.js";
import {implementRpcs} from "~/server/rpc/internal/implement_rpcs.js";
import * as definitions from "~/shared/rpc/message_drafts_rpc_definitions.js";

export default implementRpcs(definitions, {
    getMessageDraft: {
        visibility: ["AppClient"],
        execute: async (context, input) => {
            const sessionContext = context.actor.authorizeSession();
            const draft = await getMessageDraft(sessionContext, input);
            return {draft};
        },
    },

    getMessageDraftFiles: {
        visibility: ["AppClient"],
        execute: async (context, input) => {
            const sessionContext = context.actor.authorizeSession();
            const files = await getMessageDraftFiles(sessionContext, input);
            return {files};
        },
    },

    updateMessageDraft: {
        visibility: ["AppClient"],
        execute: async (context, input) => {
            const sessionContext = context.actor.authorizeSession();
            await updateMessageDraft(sessionContext, input);
            return {};
        },
    },

    clearMessageDraft: {
        visibility: ["AppClient"],
        execute: async (context, input) => {
            const sessionContext = context.actor.authorizeSession();
            await clearMessageDraft(sessionContext, input);
            return {};
        },
    },
});
