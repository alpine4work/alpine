import {authorizeInternalAccess} from "~/server/accounts/accounts_actions.js";
import {ServerSessionActionContext} from "~/server/context/server_action_context.js";
import {DynamoTableSchema} from "~/server/dynamo/core/dynamo_table_schema.js";
import {internalDangerouslyCreateWelcomeChannelTransactionEntries} from "~/server/forum/data/internal_dangerously_create_welcome_channel_transaction_entries.js";
import {internalCreateSpaceTransactionEntries} from "~/server/spaces/internal_create_space_transaction_entries.js";
import {
    addSpaceAccountWithoutAuthorization,
    internalGetAccountSpaceIdsWithoutAuthorization,
    internalGetSpaceAccountItemIfExistsWithoutAuthorization,
} from "~/server/spaces/spaces_actions.js";
import {internalDangerouslyCreateTasksForAccountWithoutAuthorization} from "~/server/tasks/data/task_table.js";
import {InvalidArgumentError} from "~/shared/error/error.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {
    HybridLogicalClock,
    HybridLogicalTime,
} from "~/shared/helpers/clock/hybrid_logical_clock.js";
import {unsynchronizedSystemClock} from "~/shared/helpers/clock/unsynchronized_system_clock.js";
import {TimeZone, defaultTimeZone} from "~/shared/helpers/intl/time_zone.js";
import {generateId} from "~/shared/id/id.js";
import {AccountId, ChannelId, SpaceId, TaskId} from "~/shared/id/types/id_types.js";
import {hasSpaceRole} from "~/shared/spaces/space_model.js";

export async function createSpaceForCurrentAccount(
    context: ServerSessionActionContext,
    {
        name,
        actionTime,
        timeZone,
    }: {
        name: string;
        actionTime: HybridLogicalTime;
        timeZone: TimeZone;
    },
) {
    const accountId = context.actor.getAccountId();

    return createSpace(context, {
        name,
        ownerAccountId: accountId,
        actionTime,
        timeZone,
    });
}

export async function internalDangerouslyCreateSpaceForAccountAsAdmin(
    context: ServerSessionActionContext,
    {
        name,
        ownerAccountId,
        spaceId,
        welcomeChannelId,
    }: {
        name: string;
        ownerAccountId: AccountId;
        spaceId?: SpaceId;
        welcomeChannelId?: ChannelId;
    },
) {
    await authorizeInternalAccess(context);
    return createSpace(context, {
        name,
        ownerAccountId,
        actionTime: new HybridLogicalClock(unsynchronizedSystemClock).now(),
        timeZone: defaultTimeZone,
        spaceId,
        welcomeChannelId,
    });
}

/**
 * Creates a space and adds the current user as the `Owner` of the space.
 * This creates all resources associated with a new account, including:
 *
 * - A Welcome channel
 */
async function createSpace(
    context: ServerSessionActionContext,
    {
        name: originalName,
        ownerAccountId,
        actionTime,
        timeZone,
        spaceId: givenSpaceId,
        welcomeChannelId: givenWelcomeChannelId,
    }: {
        name: string;
        ownerAccountId: AccountId;
        actionTime: HybridLogicalTime;
        timeZone: TimeZone;
        spaceId?: SpaceId;
        welcomeChannelId?: ChannelId;
    },
) {
    const name = originalName.trim().replace(/\s+/g, " ");
    if (name.length > 50) {
        throw new InvalidArgumentError("Space name cannot be more than 50 characters");
    }

    const currentAccountId = context.actor.getAccountId();
    const spaceId = givenSpaceId || generateId<SpaceId>();
    const welcomeChannelId = givenWelcomeChannelId || generateId<ChannelId>();
    const createdTime = new Date();

    const spaceIds = await internalGetAccountSpaceIdsWithoutAuthorization(context, ownerAccountId);
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
    // We also only create tasks if the current user is the one creating
    // this space.
    if (!hasAdminRoleInAnySpace && currentAccountId === ownerAccountId) {
        const spaceSetupTaskId = generateId<TaskId>();
        await internalDangerouslyCreateTasksForAccountWithoutAuthorization(
            context,
            {
                spaceId,
                actionTime,
                timeZone,
                accountId: ownerAccountId,
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
