import {addDays} from "date-fns";
import {authorizeInternalAccess} from "~/server/accounts/accounts_actions.js";
import {BotWebhookContextModule} from "~/server/bots/bot_webhook_context_module.js";
import {
    ServerActionContext,
    ServerSessionActionContext,
    ServerSystemActionContextModules,
} from "~/server/context/server_action_context.js";
import {DynamoContext} from "~/server/dynamo/core/dynamo_context.js";
import {DynamoKeyAttributeSchema} from "~/server/dynamo/core/dynamo_key_attribute_schema.js";
import {DynamoReadConsistency} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {getDynamoSeedConstants} from "~/server/dynamo/core/dynamo_seed_constants.js";
import {DynamoTableItemType, DynamoTableSchema} from "~/server/dynamo/core/dynamo_table_schema.js";
import {isTestNodeEnvOrAdminScenariosScript} from "~/server/helpers/node/is_test_node_env_or_admin_scenarios_script.js";
import {CallBotWebhookJobDescription} from "~/server/jobs/core/job_description.js";
import {BotTokenPayloadScope} from "~/server/tokens/token_payload.js";
import {parseApiMessageRoomPath} from "~/shared/api/parse_api_path.js";
import {
    ApiBotWebhookEvent,
    ApiBotWebhookRequestBody,
} from "~/shared/api/types/api_specification_convenience_types.js";
import {AvatarSchema} from "~/shared/avatar/avatar_schema.js";
import {createAvatarModelFromItem} from "~/shared/avatar/create_avatar_model_from_item.js";
import {Bot, BotForAdmin} from "~/shared/bots/bot_schema.js";
import {Context} from "~/shared/context/context.js";
import {DeadlineExceededError, NotFoundError, UnknownError} from "~/shared/error/error.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {createTimeout} from "~/shared/helpers/async/timeout.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {arrayFromAsyncIterable} from "~/shared/helpers/iterable/array_from_async_iterable.js";
import {findMapIterable} from "~/shared/helpers/iterable/find_map_iterable.js";
import {ApiKey, assertApiKey, generateApiKey} from "~/shared/id/api_key.js";
import {generateId} from "~/shared/id/id.js";
import {
    AccountId,
    AvatarId,
    BotId,
    BotWebhookEventId,
    SpaceId,
} from "~/shared/id/types/id_types.js";
import {LabelStringSchema} from "~/shared/schema/helpers/label_string_schema.js";
import {Schema} from "~/shared/schema/schema.js";
import {fetchWithTracer} from "~/shared/tracer/fetch_with_tracer.js";

const BotsTable = DynamoTableSchema.new({
    name: "Bots",
    partitions: [
        {
            name: "Bot",
            partitionKeyAttributes: {
                botId: DynamoKeyAttributeSchema.id<BotId>(),
            },
            sortRanges: [
                {
                    name: "Attributes",
                    sortKeyAttributes: {},
                    attributes: Schema.object({
                        /**
                         * When was the bot created?
                         */
                        createdTime: Schema.date,

                        /**
                         * Name of the bot. This name will be used for all of the bot's accounts.
                         */
                        name: Schema.string,

                        /**
                         * When the bot is mentioned, send an event to this webhook.
                         *
                         * Bot webhooks should be null when the bot is "uni-directional". A
                         * good example of a uni-directional bot is our "Alerts" bot, whose
                         * sole function is to send alerts into Alpine - it should never listen
                         * to Alpine events.
                         */
                        webhookUrl: Schema.string.nullable(),
                    }),
                },
                /**
                 * The avatar for the bot. For normal (non-bot) accounts, the Avatar is stored with
                 * the Account data in the Accounts table, because Accounts are space-agnostic.
                 *
                 * Bots are a little different. The Bot item in the Bots table is space-agnostic,
                 * but the Account item for a bot is space dependent. Data that is singular and
                 * unique to a bot should be defined here within the Bot table (name, avatar,
                 * etc.). This means that the Bot table is the source of truth for bot data.
                 *
                 * Bot Account items will be eventually consistent with the data in the Bot table.
                 */
                {
                    name: "Avatar",
                    sortKeyAttributes: {},
                    attributes: AvatarSchema,
                },
            ],
        },
        {
            name: "ApiKey",
            partitionKeyAttributes: {
                apiKey: DynamoKeyAttributeSchema.labelString<ApiKey>(),
            },
            sortRanges: [
                {
                    name: "Attributes",
                    sortKeyAttributes: {},
                    attributes: Schema.object({
                        /**
                         * What bot does the API key grant access to?
                         */
                        botId: Schema.id<BotId>(),

                        /**
                         * The `SpaceId` this token is scoped to. Or if null then this is an unscoped
                         * token. If `spaceId` is non-null then `space` is also non-null.
                         *
                         * There are two types of API keys:
                         *
                         * - Scoped: API keys that are scoped to some resource in an individual space.
                         *   Individual developers at companies typically use these API keys. The API
                         *   key can't access anything outside of the space.
                         *
                         * - Unscoped: API keys that aren't associated with any resource. To use
                         *   unscoped API keys you need an access token that provides a scope.
                         *   Integration authors use unscoped API keys and they get an access tokens
                         *   when called from a bot webhook.
                         *
                         *   I'm also imagining we have an API endpoint called `/request-access-token`
                         *   or something that returns an access token for an unscoped API key. This
                         *   forces integrators to take basic security measures to make sure they're
                         *   only requesting data from one space at a time.
                         */
                        spaceId: Schema.id<SpaceId>().nullable(),

                        /**
                         * See the comment on `spaceId` for more information.
                         *
                         * Ideally `spaceId` would be inside this object but we don't currently support
                         * indexing nested properties so we have to keep `spaceId` outside.
                         */
                        space: Schema.object({
                            accountId: Schema.id<AccountId>(),
                            scope: Schema.unknown<BotTokenPayloadScope>(),
                        }).nullable(),

                        /**
                         * When was the API key created?
                         */
                        createdTime: Schema.date,

                        /**
                         * What is the API key used for?
                         */
                        name: LabelStringSchema.nullable().default(null),
                    }).validation(
                        "If `spaceId` is non-null then `space` is also non-null",
                        item => (item.spaceId === null) === (item.space === null),
                    ),
                },
            ],
        },
    ],
});

type BotItem = DynamoTableItemType<typeof BotsTable, "Bot", "Attributes">;
type BotAvatarItem = DynamoTableItemType<typeof BotsTable, "Bot", "Avatar">;

type BotWithAvatarItem = {
    readonly id: BotId;
    readonly name: string;
    readonly hasWebhookUrl: boolean;
    readonly avatar: BotAvatarItem | null;
};

// NOTE(calebmer, 2025-08-21): We don't currently use this index but something
// we'll definitely someday is the ability to list all of a bot's API keys.
// Since it's hard to add an index to an existing table right now, we're
// setting up this index on table creation.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const BotApiKeysIndex = BotsTable.addIndex({
    name: "BotApiKeys",
    itemTypes: [{partitionType: "ApiKey", sortRangeType: "Attributes"}],
    partitionKeyAttributes: {
        botId: DynamoKeyAttributeSchema.id<BotId>(),
    },
    sortKeyAttributes: {
        spaceId: DynamoKeyAttributeSchema.id<SpaceId>().nullable(),
    },
});

const botWebhookMaxRetryCount = 3;
const botWebhookRequestTimeoutMs = 10 * 1000;
const botWebhookRetryDelayIncrementMs = 2 * 1000;

function getBotWebhookRetryTime(attemptNumber: number, endTime: Date) {
    return endTime.getTime() + botWebhookRetryDelayIncrementMs * attemptNumber;
}

const BotWebhookEventsTable = DynamoTableSchema.new({
    name: "BotWebhookEvents",
    partitions: [
        {
            name: "BotSpace",
            partitionKeyAttributes: {
                botId: DynamoKeyAttributeSchema.id<BotId>(),
                spaceId: DynamoKeyAttributeSchema.id<SpaceId>(),
            },
            sortRanges: [
                {
                    name: "Event",
                    sortKeyAttributes: {
                        eventId: DynamoKeyAttributeSchema.id<BotWebhookEventId>(),
                    },
                    withExpirationTime: "Required",
                    attributes: Schema.object({
                        /**
                         * The event we're sending to the webhook.
                         */
                        event: Schema.unknown<ApiBotWebhookEvent>(),

                        /**
                         * Information about what attempt we're on for this event. We'll retry events
                         * a couple times if they fail.
                         */
                        attempt: Schema.object({
                            number: Schema.integer.min(1).max(botWebhookMaxRetryCount),
                            startTime: Schema.date,
                            status: Schema.union({
                                Pending: Schema.object({type: Schema.value("Pending")}),
                                Rejected: Schema.object({
                                    type: Schema.value("Rejected"),
                                    endTime: Schema.date,
                                    reason: Schema.enum([
                                        "DeadlineExceeded",
                                        "Unavailable",
                                        "Internal",
                                        "ServerErrorStatusCode",
                                    ]),
                                }),
                                Resolved: Schema.object({
                                    type: Schema.value("Resolved"),
                                    endTime: Schema.date,
                                }),
                            }),
                        }),
                    }),
                },
            ],
        },
    ],
});

type BotWebhookEventItem = DynamoTableItemType<typeof BotWebhookEventsTable, "BotSpace", "Event">;

export async function seedTestBots(
    context: DynamoContext,
    {
        agentServiceLocalPort,
        chatGptLocalUnscopedApiKey,
        chatGptLocalScopedApiKey,
        mockChatGptLocalUnscopedApiKey,
    }: {
        agentServiceLocalPort: string;
        chatGptLocalUnscopedApiKey: string;
        chatGptLocalScopedApiKey: string;
        mockChatGptLocalUnscopedApiKey: string;
    },
) {
    assert(process.env.NODE_ENV !== "production");
    const {
        adminAccountId,
        defaultSpaceId,
        chatGptBotId,
        chatGptBotAccountIdForDefaultSpace,
        mockChatGptBotId,
    } = getDynamoSeedConstants();

    const currentTime = new Date();

    await runAllPromises([
        // Seed the ChatGPT bot.
        BotsTable.updateItem(
            context,
            {
                partitionType: "Bot",
                sortRangeType: "Attributes",
                botId: chatGptBotId,
            },
            item => {
                const webhookUrl = `http://localhost:${agentServiceLocalPort}/chat-gpt/webhook`;

                // Noop if the webhook URL is correct.
                if (item?.webhookUrl === webhookUrl) return item;

                if (item) {
                    return {...item, webhookUrl};
                } else {
                    return {
                        partitionType: "Bot",
                        sortRangeType: "Attributes",
                        botId: chatGptBotId,
                        createdTime: currentTime,
                        name: "ChatGPT",
                        webhookUrl,
                    };
                }
            },
        ),
        BotsTable.createItemIfNoneExists(context, {
            partitionType: "ApiKey",
            sortRangeType: "Attributes",
            apiKey: assertApiKey(chatGptLocalUnscopedApiKey),
            botId: chatGptBotId,
            spaceId: null,
            space: null,
            createdTime: currentTime,
            name: "Unscoped API Key",
        }),
        BotsTable.createItemIfNoneExists(context, {
            partitionType: "ApiKey",
            sortRangeType: "Attributes",
            apiKey: assertApiKey(chatGptLocalScopedApiKey),
            botId: chatGptBotId,
            spaceId: defaultSpaceId,
            space: {
                accountId: chatGptBotAccountIdForDefaultSpace,
                scope: {type: "Account", accountId: adminAccountId},
            },
            createdTime: currentTime,
            name: "Scoped API Key",
        }),

        // Seed the mock ChatGPT bot.
        BotsTable.updateItem(
            context,
            {
                partitionType: "Bot",
                sortRangeType: "Attributes",
                botId: mockChatGptBotId,
            },
            item => {
                const webhookUrl = `http://localhost:${agentServiceLocalPort}/mock/webhook`;

                // Noop if the webhook URL is correct.
                if (item?.webhookUrl === webhookUrl) return item;

                if (item) {
                    return {...item, webhookUrl};
                } else {
                    return {
                        partitionType: "Bot",
                        sortRangeType: "Attributes",
                        botId: mockChatGptBotId,
                        createdTime: currentTime,
                        name: "ChatGPT",
                        webhookUrl,
                    };
                }
            },
        ),
        BotsTable.createItemIfNoneExists(context, {
            partitionType: "ApiKey",
            sortRangeType: "Attributes",
            apiKey: assertApiKey(mockChatGptLocalUnscopedApiKey),
            botId: mockChatGptBotId,
            spaceId: null,
            space: null,
            createdTime: currentTime,
            name: "Unscoped API Key",
        }),
    ]);
}

export async function createBotForTest(
    context: DynamoContext,
    {name, webhookUrl}: {name: string; webhookUrl: string},
) {
    assert(isTestNodeEnvOrAdminScenariosScript);

    const botId = generateId<BotId>();

    await BotsTable.createItem(context, {
        partitionType: "Bot",
        sortRangeType: "Attributes",
        botId,
        createdTime: new Date(),
        name,
        webhookUrl,
    });

    return {id: botId};
}

/**
 * Create an unscoped API key for a bot.
 */
export async function createUnscopedApiKeyForTest(
    context: DynamoContext,
    botId: BotId,
): Promise<ApiKey> {
    assert(import.meta.jest);

    const apiKey = generateApiKey();

    await BotsTable.createItem(context, {
        partitionType: "ApiKey",
        sortRangeType: "Attributes",
        apiKey,
        botId,
        spaceId: null,
        space: null,
        createdTime: new Date(),
        name: null,
    });

    return apiKey;
}

/**
 * Create a scoped API key for a bot. We assume the caller has validated that
 * the space and account is an instantiation of the `BotId` and that the
 * `scope` is a valid entity in the space.
 */
export async function createScopedApiKeyForTest(
    context: DynamoContext,
    botId: BotId,
    {
        spaceId,
        accountId,
        scope,
    }: {
        spaceId: SpaceId;
        accountId: AccountId;
        scope: BotTokenPayloadScope;
    },
): Promise<ApiKey> {
    assert(import.meta.jest);

    const apiKey = generateApiKey();

    await BotsTable.createItem(context, {
        partitionType: "ApiKey",
        sortRangeType: "Attributes",
        apiKey,
        botId,
        spaceId,
        space: {accountId, scope},
        createdTime: new Date(),
        name: null,
    });

    return apiKey;
}

/**
 * Get the information associated with a bot. Currently, basic information
 * about a bot is public globally (e.g. its name, presence of a webhook URL,
 * and avatar)!
 */
export async function getBot(context: DynamoContext, botId: BotId) {
    const botItem = await BotsTable.getItem(context, {
        partitionType: "Bot",
        sortRangeType: "Attributes",
        botId,
    });

    return {
        name: botItem.name,
        hasWebhookUrl: !!botItem.webhookUrl,
    };
}

/**
 * Get the information associated with a bot. Currently, basic information
 * about a bot is public globally (e.g. its name, presence of a webhook URL,
 * and avatar)! Importantly, excludes protected information like the
 * webhook URL and API keys.
 */
async function getBotWithAvatarItemIfExists(
    context: DynamoContext,
    botId: BotId,
    {consistency}: {consistency?: DynamoReadConsistency} = {},
): Promise<BotWithAvatarItem | null> {
    const items = await arrayFromAsyncIterable(
        BotsTable.query(context, {
            limit: 2,
            partitionKey: {
                partitionType: "Bot",
                botId,
            },
            startSortKey: {sortRangeType: "Attributes"},
            endSortKey: {sortRangeType: "Avatar"},
            consistency,
        }),
    );

    const attributesItem = findMapIterable(items, item =>
        item.sortRangeType === "Attributes" ? item : undefined,
    );
    if (!attributesItem) return null;

    const avatarItem = findMapIterable(items, item =>
        item.sortRangeType === "Avatar" ? item : undefined,
    );

    return {
        id: attributesItem.botId,
        name: attributesItem.name,
        hasWebhookUrl: !!attributesItem.webhookUrl,
        avatar: avatarItem ?? null,
    };
}

/**
 * Get the information associated with a bot. Currently, basic information
 * about a bot is public globally (e.g. its name, presence of a webhook URL,
 * and avatar)! Importantly, excludes protected information like the
 * webhook URL and API keys.
 */
async function getBotWithAvatarItem(
    context: DynamoContext,
    botId: BotId,
    {consistency}: {consistency?: DynamoReadConsistency} = {},
): Promise<BotWithAvatarItem> {
    const item = await getBotWithAvatarItemIfExists(context, botId, {consistency});
    if (!item) throw new NotFoundError("Bot not found");
    return item;
}

/**
 * Get the information associated with a bot. Currently, basic information
 * about a bot is public globally (e.g. its name, presence of a webhook URL,
 * and avatar)! Importantly, excludes protected information like the
 * webhook URL and API keys.
 */
export async function getBotWithAvatar(
    context: DynamoContext,
    botId: BotId,
    {consistency}: {consistency?: DynamoReadConsistency} = {},
): Promise<Bot> {
    const item = await getBotWithAvatarItem(context, botId, {consistency});
    return createBotFromItem(item);
}

/**
 * Allow loading the full bot item in tests.
 */
export async function getBotItemForTest(context: DynamoContext, botId: BotId): Promise<BotItem> {
    assert(isTestNodeEnvOrAdminScenariosScript);

    const botItem = await BotsTable.getItem(context, {
        partitionType: "Bot",
        sortRangeType: "Attributes",
        botId,
    });

    return botItem;
}

let isProcessCallBotWebhookJobCrashSimulatedForTest = false;

export function setIsProcessCallBotWebhookJobCrashSimulatedForTest(value: boolean) {
    assert(import.meta.jest);
    isProcessCallBotWebhookJobCrashSimulatedForTest = value;
}

/**
 * When processing a bot webhook job we'll retry failures up to three times
 * (after 2 seconds then 4 seconds). We time out requests after 10 seconds.
 */
export async function processCallBotWebhookJob(
    context: Context<ServerSystemActionContextModules & {botWebhook: BotWebhookContextModule}>,
    job: CallBotWebhookJobDescription,
) {
    let hasLease = false;

    const [botItem, eventItem] = await runAllPromises([
        BotsTable.getItem(context, {
            partitionType: "Bot",
            sortRangeType: "Attributes",
            botId: job.botId,
        }),
        BotWebhookEventsTable.updateItem(
            context,
            {
                partitionType: "BotSpace",
                sortRangeType: "Event",
                botId: job.botId,
                spaceId: job.spaceId,
                eventId: job.eventId,
            },
            oldEventItem => {
                let newEventItem;
                ({hasLease, eventItem: newEventItem} = leaseBotWebhookEventItem(job, oldEventItem));
                return newEventItem;
            },
        ),
    ]);

    // We always create an event item if one doesn't already exist.
    assert(eventItem);

    if (!botItem.webhookUrl) {
        // If the bot has no webhook URL then we shouldn't proceed with webhook event
        // processing.
        return;
    }

    if (hasLease) {
        await actuallyCallBotWebhook(context, botItem.webhookUrl, eventItem, job);
        return;
    }

    // If the request was rejected but we have more attempts then reschedule the
    // job and use `delaySeconds` to wait until the right time to retry.
    //
    // We need this since if status is `Rejected` there's no job in the SQS queue
    // which SQS will keep retrying. So we manually need to make sure we're
    // rescheduling retries. We don't need to reschedule `Pending` jobs because SQS
    // should manage retrying `Pending` jobs we lose track of (e.g. because of a
    // process crash).
    if (
        eventItem.attempt.status.type === "Rejected" &&
        eventItem.attempt.number < botWebhookMaxRetryCount
    ) {
        const retryTime = getBotWebhookRetryTime(
            eventItem.attempt.number,
            eventItem.attempt.status.endTime,
        );

        await context.jobs.sendAndWait(job, {
            delaySeconds: Math.max(0, Math.ceil((retryTime - Date.now()) / 1000)),
        });
    }
}

/**
 * Only one process in our distributed system is allowed to make a webhook call
 * for a given event at a time. So before we call the webhook claim a "lease"
 * using the webhook event item.
 *
 * Leasing is successful if the event item doesn't exist or is in a rejected
 * state and has more retries. We can make a new webhook call after this.
 * Leasing is unsuccessful if there's record of a pending attempt in the bot
 * webhook table.
 */
function leaseBotWebhookEventItem(
    job: CallBotWebhookJobDescription,
    eventItem: BotWebhookEventItem | null,
): {
    hasLease: boolean;
    eventItem: BotWebhookEventItem;
} {
    const currentTime = new Date();

    // If we haven't seen the event yet then we can call the webhook.
    if (!eventItem) {
        return {
            hasLease: true,
            eventItem: {
                partitionType: "BotSpace",
                sortRangeType: "Event",
                botId: job.botId,
                spaceId: job.spaceId,
                eventId: job.eventId,
                event: job.event,
                attempt: {
                    number: 1,
                    startTime: currentTime,
                    status: {type: "Pending"},
                },
                // Delete the event after 30 days. We don't need to keep a record longer
                // than that.
                expirationTime: addDays(currentTime, 30),
            },
        };
    }

    // Mark a timed out attempt as rejected.
    if (
        eventItem.attempt.status.type === "Pending" &&
        eventItem.attempt.startTime.getTime() + botWebhookRequestTimeoutMs <= currentTime.getTime()
    ) {
        eventItem = {
            ...eventItem,
            attempt: {
                ...eventItem.attempt,
                status: {
                    type: "Rejected",
                    endTime: new Date(
                        eventItem.attempt.startTime.getTime() + botWebhookRequestTimeoutMs,
                    ),
                    reason: "DeadlineExceeded",
                },
            },
        };
    }

    // If the previous attempt was rejected (time out counts as rejected) and our
    // retry wait time has passed then start a new attempt.
    if (
        eventItem.attempt.status.type === "Rejected" &&
        eventItem.attempt.number < botWebhookMaxRetryCount &&
        getBotWebhookRetryTime(eventItem.attempt.number, eventItem.attempt.status.endTime) <=
            currentTime.getTime()
    ) {
        return {
            hasLease: true,
            eventItem: {
                ...eventItem,
                attempt: {
                    number: eventItem.attempt.number + 1,
                    startTime: currentTime,
                    status: {type: "Pending"},
                },
            },
        };
    }

    return {
        hasLease: false,
        eventItem,
    };
}

/**
 * We're allowed to call the webhook! Leasing the event was successful, we're
 * the only process in our distributed system allowed to make a call, so go
 * ahead and make the call.
 */
async function actuallyCallBotWebhook(
    context: Context<ServerSystemActionContextModules & {botWebhook: BotWebhookContextModule}>,
    webhookUrl: string,
    eventItem: BotWebhookEventItem,
    job: CallBotWebhookJobDescription,
) {
    const attemptNumber = eventItem.attempt.number;
    const botWebhookUrl = new URL(webhookUrl);

    const roomPathObject = parseApiMessageRoomPath(job.event.roomPath);

    let scope: BotTokenPayloadScope;

    switch (roomPathObject.type) {
        case "Chat":
            scope = {type: "Chat", chatId: roomPathObject.id};
            break;
        case "DocumentCommentThread":
            scope = {type: "Document", documentId: roomPathObject.id};
            break;
        case "Post":
            scope = {type: "Post", postId: roomPathObject.id};
            break;
        case "Task":
            scope = {type: "Task", taskId: roomPathObject.id};
            break;
        default:
            throw exhaustive(roomPathObject);
    }

    // Signing this token grants the bot access to `roomPath`! We assume whoever
    // scheduled this job was certain the bot has access to `roomPath`.
    const accessToken = await context.botWebhook.dangerouslySignLongLivedToken({
        type: "Bot",
        spaceId: job.spaceId,
        accountId: job.botAccountId,
        scope,
    });

    const requestBody: ApiBotWebhookRequestBody = {
        spaceId: job.spaceId,
        accountId: job.botAccountId,
        accessToken,
        attempt: attemptNumber,
        eventId: job.eventId,
        event: job.event,
    };

    const abortController = new AbortController();

    // Rejected reason starts as `Unavailable`. Since if `fetch()` throws that's
    // usually a network failure.
    let rejectedReason: "DeadlineExceeded" | "Unavailable" | "Internal" | "ServerErrorStatusCode" =
        "Unavailable";

    const timeout = createTimeout(() => {
        rejectedReason = "DeadlineExceeded";
        abortController.abort(new DeadlineExceededError(`Webhook request timed out`));
    }, botWebhookRequestTimeoutMs);

    try {
        // TODO(calebmer, #public-api): When we start making requests to third-parties
        // we don't want to expose the IP address of our AWS EC2 instances. Right now
        // our AWS EC2 instances lives in a public VPC so if you have the IP address
        // you'll be able to make requests to our servers which might be a problem.
        //
        // TODO(calebmer, #public-api): Tracing needs to behave differently when
        // calling third-party services. We shouldn't use `AgentService` as the
        // `serviceName` and maybe the route should be `/*` since we don't know the
        // route structure of third-party services.
        await fetchWithTracer(
            context.tracer.getTracer(),
            botWebhookUrl,
            {
                serviceName: "AgentService",
                route: botWebhookUrl.pathname,
                signal: abortController.signal,
                method: "POST",
                headers: {
                    // 1.0.0 is the same version number that's in `api_specification.yaml`. If we
                    // change the API version we should consider changing the user agent here too.
                    "user-agent": "Alpine-API/1.0.0",
                    "content-type": "application/json",
                },
                body: JSON.stringify(requestBody),
            },
            async response => {
                // We don't use the response body. Cancel the stream so if the server returns a
                // big response payload we don't pay for it.
                //
                // The webhook is responsible for calling any write methods on the API (e.g.
                // `POST /chats/{id}/messages`) to update the app in response to the webhook
                // event.
                await response.body?.cancel();

                // Only retry 5xx errors. We consider 2xx, 3xx, and 4xx status codes as
                // successful delivery. Status codes like 400 and 401 (unauthorized) probably
                // mean the recipient server is misconfigured.
                if (response.status >= 500) {
                    rejectedReason = "ServerErrorStatusCode";
                    throw new UnknownError(`Webhook request failed with status ${response.status}`);
                }
            },
        );

        timeout.clear();

        // If we throw after this point, it's an internal error due to a bug in
        // our code.
        rejectedReason = "Internal";

        // Unit test helper for simulating a process crash.
        if (import.meta.jest && isProcessCallBotWebhookJobCrashSimulatedForTest) return;

        await BotWebhookEventsTable.updateItem(
            context,
            eventItem,
            eventItem => {
                // Make sure the event is still in our expected state.
                //
                // Defends against another `processCallBotWebhookJob()` running, deciding the
                // call has timed out (maybe because of clock skew), and updating to a
                // `Rejected` state or `Pending` state with a new `attemptNumber`.
                if (eventItem.attempt.status.type !== "Pending") return eventItem;
                if (eventItem.attempt.number !== attemptNumber) return eventItem;

                return {
                    ...eventItem,
                    attempt: {
                        ...eventItem.attempt,
                        status: {type: "Resolved", endTime: new Date()},
                    },
                };
            },
            {initialItem: eventItem},
        );
    } catch {
        timeout.clear();

        // Unit test helper for simulating a process crash.
        if (import.meta.jest && isProcessCallBotWebhookJobCrashSimulatedForTest) return;

        await BotWebhookEventsTable.updateItem(
            context,
            eventItem,
            eventItem => {
                // Make sure the event is still in our expected state.
                //
                // Defends against another `processCallBotWebhookJob()` running, deciding the
                // call has timed out (maybe because of clock skew), and updating to a
                // `Rejected` state or `Pending` state with a new `attemptNumber`.
                if (eventItem.attempt.status.type !== "Pending") return eventItem;
                if (eventItem.attempt.number !== attemptNumber) return eventItem;

                return {
                    ...eventItem,
                    attempt: {
                        ...eventItem.attempt,
                        status: {type: "Rejected", endTime: new Date(), reason: rejectedReason},
                    },
                };
            },
            {initialItem: eventItem},
        );

        // If we have more retries then send the job back to the queue with a delay so
        // we can try again.
        if (attemptNumber < botWebhookMaxRetryCount) {
            await context.jobs.sendAndWait(job, {
                delaySeconds: Math.ceil((botWebhookRetryDelayIncrementMs * attemptNumber) / 1000),
            });
        }
    }
}

/**
 * Get the information associated with an `ApiKey`. Like what bot the `ApiKey`
 * is for and what `SpaceId` the `ApiKey` is for. If null then there's no
 * `ApiKey` and our API shouldn't grant access for the `ApiKey`.
 *
 * This isn't dangerous since if an attacker has a user's `ApiKey` then the
 * user is already cooked. Every user has access, through the API, to know
 * whether their API key is valid or not.
 */
export async function getApiKeyAttributesIfExists(
    context: DynamoContext,
    apiKey: ApiKey,
    {consistency}: {consistency?: DynamoReadConsistency} = {},
): Promise<{
    readonly botId: BotId;
    readonly space: {
        readonly spaceId: SpaceId;
        readonly accountId: AccountId;
        readonly scope: BotTokenPayloadScope;
    } | null;
} | null> {
    const botApiKeyItem = await BotsTable.getItemIfExists(
        context,
        {partitionType: "ApiKey", sortRangeType: "Attributes", apiKey},
        {consistency},
    );
    if (!botApiKeyItem) return null;

    return {
        botId: botApiKeyItem.botId,
        space:
            botApiKeyItem.space !== null
                ? {
                      spaceId: assertExists(botApiKeyItem.spaceId),
                      accountId: botApiKeyItem.space.accountId,
                      scope: botApiKeyItem.space.scope,
                  }
                : null,
    };
}

function createBotFromItem(botItem: BotWithAvatarItem): Bot {
    return {
        id: botItem.id,
        name: botItem.name,
        avatar: createAvatarModelFromItem(botItem.avatar),
    };
}

export async function finishUploadingBotAvatar(
    context: ServerSessionActionContext,
    {botId, avatarContent, avatarId}: {botId: BotId; avatarContent: Uint8Array; avatarId: AvatarId},
): Promise<Bot> {
    await authorizeInternalAccess(context);

    return context.dynamo.retryTransaction(async context => {
        const oldBotItem = await getBotWithAvatarItem(context, botId);
        const oldBotAvatar = oldBotItem.avatar;

        // NOTE(ifitzsimmons, #2025-12-15): When we update a Bot's avatar, we create an
        // async job to update the// `Account#Avatar` item for each Account associated with
        // the bot. This operation needs to be idempotent. When the job runs, it fetches
        // the most recent Avatar from the `Bot#Avatar` item and copies it into the
        // `Account#Avatar` item for every bot `Account`. If a user were to change the
        // bot's avatar twice in quick succession, we would end up with two async jobs
        // running in parallel. Without this check, it's possible that the job associated
        // with the second update runs first for some or all accounts. This would result in
        // the second update being lost.
        //
        // Since we guarantee idempotency when copying a bot's avatar into the
        // `Account#Avatar` item, we need to make sure that we don't overwrite new bot
        // avatars with old ones.
        if (oldBotAvatar?.avatarId && oldBotAvatar.avatarId >= avatarId) {
            return createBotFromItem(oldBotItem);
        }

        const botAvatarItem = await BotsTable.directlyUpdateItem(context, {
            ...oldBotAvatar,
            partitionType: "Bot",
            sortRangeType: "Avatar",
            botId,
            avatarId,
            content: avatarContent,
        });

        await context.jobs.dangerouslySendMaintenance({
            type: "UpdateBotAccounts",
            botId,
            update: {
                type: "Avatar",
            },
        });

        return createBotFromItem({
            ...oldBotItem,
            avatar: botAvatarItem,
        });
    });
}

// NOTE(ifitzsimmons, #bots): In order to support an internal bot management page, we need to
// load all bots (with their avatars). Eventually, we should introduce an ownership model for
// bots that enables indexing bots by owner. However, we don't have a really strong product
// use case for bot "ownership" yet. Since the only bots are the ones that we've created, it's
// okay to just get all the bots in the table with their avatars and API keys.
export async function expensivelyGetAllBotsForAdminSettingsPage(
    context: ServerActionContext,
): Promise<Array<BotForAdmin>> {
    // NOTE(ifitzsimmons, #bots): For now, only internal accounts (alpine engineers)
    // can update bot avatars. Eventually, we'll need to decide on some type of
    // "ownership" model when it comes to bots.
    await authorizeInternalAccess(context);

    const botIdsToBotData: Map<
        BotId,
        {
            item?: BotItem;
            avatar?: BotAvatarItem | null;
            apiKeys?: Array<{
                apiKey: ApiKey;
                name: string | null;
            }>;
        }
    > = new Map();

    for await (const item of BotsTable.expensiveScan(context, {})) {
        const botData = botIdsToBotData.get(item.botId);

        if (item.partitionType === "Bot" && item.sortRangeType === "Attributes") {
            botIdsToBotData.set(item.botId, {
                ...botData,
                item,
            });
        }

        if (item.partitionType === "Bot" && item.sortRangeType === "Avatar") {
            botIdsToBotData.set(item.botId, {
                ...botData,
                avatar: item ?? null,
            });
        }

        if (item.partitionType === "ApiKey" && item.sortRangeType === "Attributes") {
            botIdsToBotData.set(item.botId, {
                ...botData,
                apiKeys: [...(botData?.apiKeys ?? []), {apiKey: item.apiKey, name: item.name}],
            });
        }
    }

    return Array.from(botIdsToBotData.values()).map(botData => {
        assert(botData.item, "Bot item was not found");

        return {
            ...createBotFromItem({
                id: botData.item.botId,
                name: botData.item.name,
                hasWebhookUrl: !!botData.item.webhookUrl,
                avatar: botData.avatar ?? null,
            }),
            webhookUrl: botData.item.webhookUrl ?? null,
            apiKeys: botData.apiKeys ?? [],
        };
    });
}
