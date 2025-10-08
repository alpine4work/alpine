import {ServerSessionActionContext} from "~/server/context/server_action_context.js";
import {DynamoTableSchema} from "~/server/dynamo/core/dynamo_table_schema.js";
import {internalDangerouslyCreateWelcomeChannelTransactionEntries} from "~/server/forum/data/internal_dangerously_create_welcome_channel_transaction_entries.js";
import {internalCreateSpaceTransactionEntries} from "~/server/spaces/internal_create_space_transaction_entries.js";
import {
    addSpaceAccountWithoutAuthorization,
    getOurAccountSpaceIds,
    internalGetSpaceAccountItemIfExistsWithoutAuthorization,
} from "~/server/spaces/spaces_actions.js";
import {internalCreateTasksForCurrentUser} from "~/server/tasks/data/task_table.js";
import {InvalidArgumentError} from "~/shared/error/error.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {HybridLogicalTime} from "~/shared/helpers/clock/hybrid_logical_clock.js";
import {TimeZone} from "~/shared/helpers/intl/time_zone.js";
import {generateId} from "~/shared/id/id.js";
import {ChannelId, SpaceId, TaskId} from "~/shared/id/types/id_types.js";
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
        actionTime,
        timeZone,
    }: {
        name: string;
        actionTime: HybridLogicalTime;
        timeZone: TimeZone;
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

    const {newItem: space, transactionEntries: createSpaceTransactionEntries} =
        internalCreateSpaceTransactionEntries({
            spaceId,
            name,
            createdTime,
        });

    await DynamoTableSchema.executeTransaction(context, [
        ...createSpaceTransactionEntries,
        ...createWelcomeChannelTransactionEntries,
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

    // If the user is not an admin in any space, we assume they're
    // a beginner user and create some starter tasks for them.
    if (!hasAdminRoleInAnySpace) {
        const spaceSetupTaskId = generateId<TaskId>();

        await internalCreateTasksForCurrentUser(
            context,
            {
                spaceId,
                actionTime,
                timeZone,
            },
            [
                {
                    title: "View your tasks",
                    active: true,
                },
                {
                    title: "Upload your profile picture",
                    active: false,
                    notes: "1. Click the avatar on the bottom left\n2. Click ‘Settings’\n3. Update your avatar",
                },
                {
                    title: "Set up your space",
                    active: false,
                    taskId: spaceSetupTaskId,
                    notes: "Check out the subtasks below to get your space ready for your team!",
                },
                {
                    title: "Upload your space logo",
                    active: false,
                    parentTaskId: spaceSetupTaskId,
                    assignUser: false,
                    notes: "1. Click the space logo on the top left\n2. Click ‘Settings’\n3. Update your logo",
                },
                {
                    title: "Invite team members",
                    active: false,
                    parentTaskId: spaceSetupTaskId,
                    assignUser: false,
                    notes: "1. Click the space logo on the top left\n2. Click ‘People’\n3. Click ‘Invite’",
                },
            ],
        );
    }

    return space;
}
