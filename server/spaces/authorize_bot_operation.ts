import {getHasInternalAccess} from "~/server/accounts/get_has_internal_access.js";
import {dangerouslyGetBotIfExistsWithoutAuthorization} from "~/server/bots/dangerously_get_bot_without_authorization.js";
import {ServerActionContext} from "~/server/context/server_action_context.js";
import {DynamoContextModules} from "~/server/dynamo/core/dynamo_context.js";
import {DynamoCacheReadConsistency} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {authorizeSpaceAccessIfPossible} from "~/server/spaces/authorize_space_access.js";
import {getSpaceAccountBotIdIfExistsWithoutAuthorization} from "~/server/spaces/get_space_account_bot_id_if_exists.js";
import {isAccountMemberOfSpaceWithoutAuthorization} from "~/server/spaces/is_account_member_of_space.js";
import {createBotNotFoundError} from "~/shared/bots/bot_error_messages.js";
import {BotOperation, BotOperationType} from "~/shared/bots/bot_operation.js";
import {BotOwnerEntity} from "~/shared/bots/owners/bot_owner_entity.js";
import {CacheContextModule, ContextCache} from "~/shared/context/cache_context_module.js";
import {Context} from "~/shared/context/context.js";
import {ProcessContextModule} from "~/shared/context/process_context_module.js";
import {PermissionDeniedError} from "~/shared/error/error.open_source.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.open_source.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.open_source.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";
import {AccountId, BotId, SpaceId} from "~/shared/id/types/id_types.open_source.js";
import {SpaceRole} from "~/shared/spaces/space_model.js";

/**
 * Returns whether an actor may perform an operation with an existing bot.
 *
 * We use a set of attributes to resolve permissions for the given operation. In
 * order, these are:
 *
 * 1. The actor type (Bot, Session, System, etc)
 * 2. The type of the bot's owner (Account, Space, System)
 * 3. The actor's role within the space where the operation is taking place
 *    (Member, Admin)
 */
export async function hasBotOperationAccess(
    context: ServerActionContext,
    botId: BotId,
    operation: BotOperation,
    {consistency = "Eventual"}: {consistency?: DynamoCacheReadConsistency} = {},
): Promise<boolean> {
    // Bot actors have different permissions than human actors, so we check a different
    // set of conditions to determine permissions
    if (context.actor.type === "Bot") {
        const spaceId = context.actor.getSpaceId();

        const actorBotId = await getSpaceAccountBotIdIfExistsWithoutAuthorization(
            context,
            spaceId,
            context.actor.getBotAccountId(),
        );
        if (actorBotId === null) return false;

        return await hasBotOperationAccessForBot(context, operation, {
            spaceId,
            actorBotId,
            botId,
            consistency,
        });
    }

    const bot = await dangerouslyGetBotIfExistsWithoutAuthorization(context, botId, {consistency});
    if (!bot) return false;

    return await hasBotOperationAccessForOwnerEntity(context, bot.ownerEntity, operation);
}

/**
 * Returns the set of operations the actor may perform with an existing bot in a
 * space. Returns an empty set if the bot doesn't exist.
 *
 * The actor always comes from `context.actor`. Without a `forTarget.spaceId` only
 * the operations that aren't scoped to a space (`View` and `Manage`) are resolved.
 *
 * The `forTarget.accountId` is the account the `ViewSpaceSettingsForActor` and
 * `ManageSpaceSettingsForActor` operations are checked against and defaults to the
 * actor's own account, which is the only account those operations can ever resolve
 * to for a human actor. Pass it explicitly only for a bot actor, which may resolve
 * its own settings for any account in its space.
 *
 * This resolves the actor's space roles once and shares them across every
 * operation, so it costs about as much as a single `hasBotOperationAccess()` call
 * rather than one per operation. See `BotOperationSpaceRoleCache`.
 */
export async function getAllowedBotOperations(
    context: ServerActionContext,
    botId: BotId,
    forTarget: {
        readonly spaceId?: SpaceId | null;
        readonly accountId?: AccountId | null;
    } = {},
    {consistency = "Eventual"}: {consistency?: DynamoCacheReadConsistency} = {},
): Promise<ReadonlySet<BotOperationType>> {
    // Destructured so an explicit `accountId: null` still means "no account" while a
    // missing one falls back to the actor.
    const {spaceId = null, accountId = context.actor.getPossiblyBotAccountIdIfExists()} = forTarget;

    const operations = getAllBotOperations(spaceId, accountId);

    // Bot actors resolve permissions against the acting bot instead of the bot's
    // owner, so they take the same path as `hasBotOperationAccess()`.
    if (context.actor.type === "Bot") {
        const actorSpaceId = context.actor.getSpaceId();

        const actorBotId = await getSpaceAccountBotIdIfExistsWithoutAuthorization(
            context,
            actorSpaceId,
            context.actor.getBotAccountId(),
        );
        if (actorBotId === null) return new Set();

        return await filterToAllowedBotOperationTypes(
            operations,
            async operation =>
                await hasBotOperationAccessForBot(context, operation, {
                    spaceId: actorSpaceId,
                    actorBotId,
                    botId,
                    consistency,
                }),
        );
    }

    const bot = await dangerouslyGetBotIfExistsWithoutAuthorization(context, botId, {consistency});
    if (!bot) return new Set();

    return await filterToAllowedBotOperationTypes(
        operations,
        async operation =>
            await hasBotOperationAccessForOwnerEntity(context, bot.ownerEntity, operation),
    );
}

/**
 * Every `BotOperation` an actor could perform against a bot, dropping the ones
 * there isn't enough of a target to resolve.
 */
function getAllBotOperations(
    spaceId: SpaceId | null,
    accountId: AccountId | null,
): ReadonlyArray<BotOperation> {
    // Keying by operation type makes TypeScript require an entry for every
    // `BotOperation` variant, so adding a new operation forces updating this list
    // instead of silently omitting it from the result.
    const botOperationByType: {
        [Type in BotOperationType]: Extract<BotOperation, {type: Type}> | null;
    } = {
        // The only two operations that aren't scoped to a space. A space-owned bot still
        // resolves these against its own owning space, not a target space.
        View: {type: "View"},
        Manage: {type: "Manage"},

        Install: spaceId === null ? null : {type: "Install", spaceId},
        ViewSpaceSettings: spaceId === null ? null : {type: "ViewSpaceSettings", spaceId},
        ManageSpaceSettings: spaceId === null ? null : {type: "ManageSpaceSettings", spaceId},
        Message: spaceId === null ? null : {type: "Message", spaceId},

        // The per-actor operations also need an account. Actors without one (System,
        // Anonymous) can never resolve them, since they require the account to equal the
        // actor's own.
        ViewSpaceSettingsForActor:
            spaceId === null || accountId === null
                ? null
                : {type: "ViewSpaceSettingsForActor", spaceId, accountId},
        ManageSpaceSettingsForActor:
            spaceId === null || accountId === null
                ? null
                : {type: "ManageSpaceSettingsForActor", spaceId, accountId},
    };

    return Object.values(botOperationByType).filter(operation => operation !== null);
}

async function filterToAllowedBotOperationTypes(
    operations: ReadonlyArray<BotOperation>,
    hasAccess: (operation: BotOperation) => Promise<boolean>,
): Promise<ReadonlySet<BotOperationType>> {
    const hasAccessByIndex = await runAllPromises(operations.map(hasAccess));

    return new Set(operations.filter((_, index) => hasAccessByIndex[index]).map(({type}) => type));
}

/** Authorizes that the actor may perform an operation with an existing bot. */
export async function authorizeBotOperation(
    context: ServerActionContext,
    botId: BotId,
    operation: BotOperation,
    {consistency = "Eventual"}: {consistency?: DynamoCacheReadConsistency} = {},
): Promise<void> {
    // Check that the bot exists up front so a missing bot is a not-found error instead
    // of a permission error.
    const bot = await dangerouslyGetBotIfExistsWithoutAuthorization(context, botId, {consistency});
    if (!bot) throw createBotNotFoundError(botId);

    if (await hasBotOperationAccess(context, botId, operation, {consistency})) return;

    throw createBotOperationPermissionDeniedError(operation);
}

/**
 * The error thrown when an actor may not perform an operation with a bot.
 */
function createBotOperationPermissionDeniedError(operation: BotOperation) {
    switch (operation.type) {
        case "View":
            return new PermissionDeniedError("Account may not view this bot", {
                displayMessage: errorDisplayMessage`You don\u2019t have access to this bot.`,
            });
        case "Manage":
            return new PermissionDeniedError("Account may not manage this bot", {
                displayMessage: errorDisplayMessage`You don\u2019t have permission to manage this bot.`,
            });
        case "Install":
            return new PermissionDeniedError("Account may not install this bot in this space", {
                displayMessage: errorDisplayMessage`You don\u2019t have permission to install this bot in this space.`,
            });
        case "ViewSpaceSettings":
            return new PermissionDeniedError(
                "Account may not view the space settings for this bot",
                {
                    displayMessage: errorDisplayMessage`You don\u2019t have permission to view the space settings for this bot.`,
                },
            );
        case "ManageSpaceSettings":
            return new PermissionDeniedError(
                "Account may not manage the space settings for this bot",
                {
                    displayMessage: errorDisplayMessage`You don\u2019t have permission to manage the space settings for this bot.`,
                },
            );
        case "ViewSpaceSettingsForActor":
            return new PermissionDeniedError(
                "Account may not view the settings for this bot for another account",
                {
                    displayMessage: errorDisplayMessage`You don\u2019t have permission to view the settings for this bot for another account.`,
                },
            );
        case "ManageSpaceSettingsForActor":
            return new PermissionDeniedError(
                "Account may not manage the settings for this bot for another account",
                {
                    displayMessage: errorDisplayMessage`You don\u2019t have permission to manage the settings for this bot for another account.`,
                },
            );
        case "Message":
            return new PermissionDeniedError("Account may not message this bot", {
                displayMessage: errorDisplayMessage`You don\u2019t have permission to message this bot.`,
            });
        default:
            throw exhaustive(operation);
    }
}

const botActorAllowedOperations = new Set<BotOperationType>([
    "View",
    "Message",
    "ViewSpaceSettings",
    "ViewSpaceSettingsForActor",
]);

/**
 * Returns whether one bot may perform an operation on another bot in a space.
 */
export async function hasBotOperationAccessForBot(
    context: Context<
        DynamoContextModules & {cache: CacheContextModule; process: ProcessContextModule}
    >,
    operation: BotOperation,
    {
        spaceId,
        actorBotId,
        botId,
        consistency = "Eventual",
    }: {
        readonly spaceId: SpaceId;
        readonly actorBotId: BotId;
        readonly botId: BotId;
        readonly consistency?: DynamoCacheReadConsistency;
    },
): Promise<boolean> {
    // Bots are only potentially allowed a subset of operations on other bots.
    if (!botActorAllowedOperations.has(operation.type)) return false;

    const [actorBot, bot] = await runAllPromises([
        dangerouslyGetBotIfExistsWithoutAuthorization(context, actorBotId, {consistency}),
        dangerouslyGetBotIfExistsWithoutAuthorization(context, botId, {consistency}),
    ]);
    if (!actorBot || !bot) return false;

    // Bots can view their own settings for any other account in their own space.
    if (operation.type === "ViewSpaceSettingsForActor") {
        if (operation.spaceId !== spaceId || actorBotId !== botId) return false;

        return await isAccountMemberOfSpaceWithoutAuthorization(
            context,
            spaceId,
            operation.accountId,
        );
    }

    switch (bot.ownerEntity.type) {
        // Personal bots are owner-only, so a bot may only use one when the two bots share
        // an owner.
        case "Account":
            return (
                actorBot.ownerEntity.type === "Account" &&
                actorBot.ownerEntity.accountId === bot.ownerEntity.accountId
            );
        // A space bot is only ever installed in the space that owns it, so any bot in that
        // space may use it, just like any member of the space.
        case "Space":
            return bot.ownerEntity.spaceId === spaceId;
        case "System":
            return true;
        default:
            throw exhaustive(bot.ownerEntity);
    }
}

/**
 * Authorizes creating a bot with the provided owner. If an `installSpaceId` is
 * provided, it also authorizes the actor can install the bot into the given space.
 */
export async function authorizeBotCreation(
    context: ServerActionContext,
    {ownerEntity, installSpaceId}: {ownerEntity: BotOwnerEntity; installSpaceId?: SpaceId},
): Promise<void> {
    // Uses the `Manage` operation type because we never want to allow an actor to
    // create a bot they cannot manage.
    if (!(await hasBotOperationAccessForOwnerEntity(context, ownerEntity, {type: "Manage"}))) {
        throw new PermissionDeniedError("Account cannot create a bot with the given owner entity", {
            displayMessage: errorDisplayMessage`You don\u2019t have permission to create a bot with this owner.`,
        });
    }

    if (
        installSpaceId !== undefined &&
        !(await hasBotOperationAccessForOwnerEntity(context, ownerEntity, {
            type: "Install",
            spaceId: installSpaceId,
        }))
    ) {
        throw createBotOperationPermissionDeniedError({type: "Install", spaceId: installSpaceId});
    }
}

/**
 * Caches whether the actor holds a role in a space for the lifetime of the action.
 *
 * Checking a role the actor doesn't hold is expensive:
 * `isAccountMemberOfSpaceWithoutAuthorization()` falls through to a strongly
 * consistent read whenever the eventually consistent read doesn't already prove
 * the role, and `DynamoContextCache` intentionally never serves strongly
 * consistent reads from its cache. So a member checked for `Admin` pays an
 * uncached read every single time. Caching collapses that to one read per
 * `(spaceId, role)` pair no matter how many operations we resolve.
 *
 * These values depend entirely on who the actor is, so the cache must reset when
 * the actor changes.
 */
const BotOperationSpaceRoleCache = new ContextCache<`${SpaceId}:${SpaceRole}`, boolean>({
    whenActorChanges: "SafelyReset",
});

async function actorHasSpaceRole(
    context: ServerActionContext,
    spaceId: SpaceId,
    role: SpaceRole,
): Promise<boolean> {
    return await BotOperationSpaceRoleCache.get(
        context,
        `${spaceId}:${role}`,
        async () => (await authorizeSpaceAccessIfPossible(context, spaceId, role)).ok,
    );
}

/**
 * Returns whether an actor may perform an operation with a bot owned by the given
 * entity.
 *
 * Prefer this over `hasBotOperationAccess()` when you already have the bot's owner
 * (e.g. from a bot account's `botOwner`), since it resolves the same rules without
 * reading the bot.
 */
export async function hasBotOperationAccessForOwnerEntity(
    context: ServerActionContext,
    ownerEntity: BotOwnerEntity,
    operation: BotOperation,
): Promise<boolean> {
    switch (ownerEntity.type) {
        case "Account": {
            return await hasBotOperationAccessForAccountOwnedBot(
                context,
                ownerEntity.accountId,
                operation,
            );
        }
        case "Space": {
            return await hasBotOperationAccessForSpaceOwnedBot(
                context,
                ownerEntity.spaceId,
                operation,
            );
        }
        case "System": {
            return await hasBotOperationAccessForSystemOwnedBot(context, operation);
        }
        default:
            throw exhaustive(ownerEntity);
    }
}

async function hasBotOperationAccessForAccountOwnedBot(
    context: ServerActionContext,
    ownerAccountId: AccountId,
    operation: BotOperation,
) {
    switch (operation.type) {
        // You can `View`, `Message`, `Manage`, and `ManageSpaceSettings` for any bot you
        // own
        case "View":
        case "Message":
        case "Manage":
        case "ViewSpaceSettings":
        case "ManageSpaceSettings":
            return (
                (context.actor.type === "Session" ||
                    context.actor.type === "ImpersonatedAccount") &&
                context.actor.getAccountId() === ownerAccountId
            );
        // You can only view or manage your own settings for your own account, and only in
        // a space you're still a member of
        case "ViewSpaceSettingsForActor":
        case "ManageSpaceSettingsForActor":
            return (
                operation.accountId === ownerAccountId &&
                (context.actor.type === "Session" ||
                    context.actor.type === "ImpersonatedAccount") &&
                context.actor.getAccountId() === ownerAccountId &&
                (await actorHasSpaceRole(context, operation.spaceId, "Member"))
            );
        // You can install the bot into any space you're a member of if you're the owner
        case "Install": {
            if (
                (context.actor.type === "Session" ||
                    context.actor.type === "ImpersonatedAccount") &&
                context.actor.getAccountId() === ownerAccountId
            ) {
                return await actorHasSpaceRole(context, operation.spaceId, "Member");
            }
            return false;
        }
        default:
            throw exhaustive(operation);
    }
}

async function hasBotOperationAccessForSpaceOwnedBot(
    context: ServerActionContext,
    ownerSpaceId: SpaceId,
    operation: BotOperation,
) {
    switch (operation.type) {
        // You can `View` or `Message` a bot if you're a member of the owning space
        case "View":
        case "Message":
            return await actorHasSpaceRole(context, ownerSpaceId, "Member");
        // You can `ViewSpaceSettings` for a space-owned bot if you're a member of the
        // space
        case "ViewSpaceSettings":
            return await actorHasSpaceRole(context, operation.spaceId, "Member");

        // You can `Manage` or `ManageSpaceSettings` if you're an admin of the owning space
        case "Manage":
        case "ManageSpaceSettings":
            return await actorHasSpaceRole(context, ownerSpaceId, "Admin");
        // You can only view or manage your own settings if you're a member of both the
        // owning space and the space the settings belong to
        case "ViewSpaceSettingsForActor":
        case "ManageSpaceSettingsForActor":
            return (
                operation.accountId === context.actor.getPossiblyBotAccountIdIfExists() &&
                (await actorHasSpaceRole(context, ownerSpaceId, "Member")) &&
                (await actorHasSpaceRole(context, operation.spaceId, "Member"))
            );
        // You can `Install` the bot if you're an admin of the owning space
        case "Install":
            return (
                ownerSpaceId === operation.spaceId &&
                (await actorHasSpaceRole(context, operation.spaceId, "Admin"))
            );
        default:
            throw exhaustive(operation);
    }
}

async function hasBotOperationAccessForSystemOwnedBot(
    context: ServerActionContext,
    operation: BotOperation,
) {
    switch (operation.type) {
        // Anyone can `View` or `Message` System bots
        case "View":
        case "Message":
            return true;
        // You can `Manage` a System bot if you're an internal user (aka Alpine employee)
        case "Manage":
            return await getHasInternalAccess(context);
        // You can `ViewSpaceSettings` for a System bot if you're a member of the space
        case "ViewSpaceSettings":
            return await actorHasSpaceRole(context, operation.spaceId, "Member");
        // You can `Install` or `ManageSpaceSettings` for a System bot within a space if
        // you're an Admin for that space
        case "Install":
        case "ManageSpaceSettings":
            return await actorHasSpaceRole(context, operation.spaceId, "Admin");
        // You can only view or manage your own bot settings, and only in a space you're a
        // member of
        case "ViewSpaceSettingsForActor":
        case "ManageSpaceSettingsForActor":
            return (
                operation.accountId === context.actor.getPossiblyBotAccountIdIfExists() &&
                (await actorHasSpaceRole(context, operation.spaceId, "Member"))
            );
        default:
            throw exhaustive(operation);
    }
}
