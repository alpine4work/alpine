import {internalGetOurDefaultSpaceId} from "~/server/accounts/accounts_table.js";
import {DynamoSessionActorContextModule} from "~/server/accounts/dynamo_actor_context_module.js";
import {ServerSessionActionContext} from "~/server/context/server_action_context.js";
import {DynamoContextModules} from "~/server/dynamo/core/dynamo_context.js";
import {JobsContextModule} from "~/server/jobs/core/jobs_context_module.js";
import {getOurAccountSpaceIds} from "~/server/spaces/spaces_table.js";
import {Context} from "~/shared/context/context.js";
import {SpaceId} from "~/shared/id/types/id_types.js";

/**
 * Get our currently authenticated session actor account's lastOpenedSpaceId.
 */
export async function getOurLastOpenedSpaceId(
    context: ServerSessionActionContext &
        Context<
            DynamoContextModules & {
                actor: DynamoSessionActorContextModule;
                jobs: JobsContextModule;
            }
        >,
): Promise<SpaceId> {
    return internalGetOurDefaultSpaceId(context, {
        getOurAccountSpaceIds: () => {
            return getOurAccountSpaceIds(context);
        },
    });
}
