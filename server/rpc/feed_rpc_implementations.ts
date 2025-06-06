import {getFeedEntries} from "~/server/feed/read/feed_read.js";
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
