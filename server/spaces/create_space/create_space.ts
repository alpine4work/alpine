import {ServerSessionActionContext} from "~/server/context/server_action_context.js";
import {DynamoTableSchema} from "~/server/dynamo/core/dynamo_table_schema.js";
import {internalDangerouslyCreateWelcomeChannelTransactionEntries} from "~/server/forum/data/internal_dangerously_create_welcome_channel_transaction_entries.js";
import {internalCreateSpaceTransactionEntries} from "~/server/spaces/internal_create_space_transaction_entries.js";
import {
    addSpaceAccountWithoutAuthorization,
    getOurAccountSpaceIds,
    internalGetSpaceAccountItemIfExistsWithoutAuthorization,
} from "~/server/spaces/spaces_actions.js";
import {InvalidArgumentError} from "~/shared/error/error.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {generateId} from "~/shared/id/id.js";
import {ChannelId, SpaceId} from "~/shared/id/types/id_types.js";
import {hasSpaceRole} from "~/shared/spaces/space_model.js";

/**
 * Creates a space and adds the current user as the `Owner` of the space.
 * This creates all resources associated with a new account, including:
 *
 * - A Welcome channel
 */
export async function createSpace(
    context: ServerSessionActionContext,
    {
        name: originalName,
    }: {
        name: string;
    },
) {
    const name = originalName.trim().replace(/\s+/g, " ");
    if (name.length > 50) {
        throw new InvalidArgumentError("Space name cannot be more than 50 characters");
    }

    const ownerAccountId = context.actor.getAccountId();
    const spaceId = generateId<SpaceId>();
    const welcomeChannelId = generateId<ChannelId>();
    const createdTime = new Date();

    const {spaceIds} = await getOurAccountSpaceIds(context);
    const spaces = await runAllPromises(
        spaceIds
            .values()
            .map(spaceId =>
                internalGetSpaceAccountItemIfExistsWithoutAuthorization(
                    context,
                    spaceId,
                    ownerAccountId,
                ),
            ),
    );

    const hasAdminRoleInAnySpace = spaces.some(space =>
        space ? hasSpaceRole(space.role, "Admin") : false,
    );

    const createWelcomeChannelTransactionEntries =
        internalDangerouslyCreateWelcomeChannelTransactionEntries(context, {
            ownerAccountId,
            spaceId,
            welcomeChannelId,
            createdTime,
        });

    // TODO(#onboarding): Implement onboarding tasks.
    const createOnboardingTasksTransactionEntries = hasAdminRoleInAnySpace ? [] : [];

    const {newItem: space, transactionEntries: createSpaceTransactionEntries} =
        internalCreateSpaceTransactionEntries({
            spaceId,
            name,
            createdTime,
        });

    await DynamoTableSchema.executeTransaction(context, [
        ...createSpaceTransactionEntries,
        ...createWelcomeChannelTransactionEntries,
        ...createOnboardingTasksTransactionEntries,
    ]);

    // NOTE(imjoshin): The "addSpaceAccount" logic is isolated in a single function, and requires
    // existence of a space. We should have this step added to the transaction execution above,
    // but that would require a significant refactor of the "addSpaceAccount" logic. The end
    // result of this could be some memberless spaces. The user will have the same experience
    // when an error occurs.
    await addSpaceAccountWithoutAuthorization(context, {
        spaceId,
        accountId: ownerAccountId,
        role: "Owner",
    });

    return space;
}
