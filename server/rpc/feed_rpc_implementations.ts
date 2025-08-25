import {getFeedEntries} from "~/server/feed/feed_actions.js";
import {implementRpcs} from "~/server/rpc/internal/implement_rpcs.js";
import * as definitions from "~/shared/rpc/feed_rpc_definitions.js";

export default implementRpcs(definitions, {
    getFeedEntries: {
        visibility: ["AppClient"],
        execute: async (context, input) => {
            return getFeedEntries(context.actor.authorizeSession(), input);
        },
    },
});
