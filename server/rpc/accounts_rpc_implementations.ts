import {getInbox} from "~/server/dynamo/notifications_table";
import {authorizeSpaceAccess} from "~/server/dynamo/spaces_table";
import {implementRpc} from "~/server/rpc/internal/implement_rpc";
import * as definition from "~/shared/rpc/accounts_rpc_definitions";

implementRpc(definition.getInboxWithStrongReadConsistency, async (_context, input) => {
    const context = await _context.actor.authenticate();

    // Minor optimization: Authorize space access with eventual consistency.
    await authorizeSpaceAccess(context, input.spaceId);

    const inbox = await getInbox(context.dynamo.setDefaultReadConsistency("Strong"), input);
    return {inbox};
});
