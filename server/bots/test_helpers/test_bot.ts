import {
    createScopedApiKeyForTest,
    createUnscopedApiKeyForTest,
} from "~/server/bots/create_api_key_for_test.js";
import {createBotForTest} from "~/server/bots/test_helpers/create_bot_for_test.js";
import {getBotItemForTest} from "~/server/bots/test_helpers/get_bot_item_for_test.js";
import {ActorServiceName} from "~/server/helpers/actor_context_module.js";
import {installBotInSpace} from "~/server/spaces/install_bot_in_space.js";
import {TestAccount} from "~/server/spaces/test_helpers/test_account.js";
import {TestContext} from "~/server/spaces/test_helpers/test_context.js";
import {TestSession} from "~/server/spaces/test_helpers/test_session.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {TestSpaceSession} from "~/server/spaces/test_helpers/test_space_session.js";
import {BotTokenScope} from "~/shared/bots/bot_token_scope.js";
import {BotOwnerEntity} from "~/shared/bots/owners/bot_owner_entity.js";
import {ApiKey} from "~/shared/id/api_key.js";
import {generateId} from "~/shared/id/id.open_source.js";
import {AccountId, BotId} from "~/shared/id/types/id_types.open_source.js";

let testBotCount = 1;

export class TestBot {
    public readonly context: TestContext;
    public readonly id: BotId;
    public readonly initialName: string;

    public constructor(context: TestContext, id: BotId, initialName: string) {
        this.context = context;
        this.id = id;
        this.initialName = initialName;
    }

    public withContext(context: TestContext) {
        return new TestBot(context, this.id, this.initialName);
    }

    public static async create(
        context: TestContext,
        {
            id,
            name,
            webhookUrl,
            webhookSecret,
            ownerEntity,
        }: {
            id?: BotId;
            name?: string;
            webhookUrl?: string | null;
            webhookSecret?: string | null;
            ownerEntity?: BotOwnerEntity;
        } = {},
    ) {
        const count = name === undefined || webhookUrl === undefined ? testBotCount++ : 0;

        const initialName = name ?? `Test Bot ${count}`;
        const webhook =
            webhookUrl === null
                ? null
                : {
                      url: webhookUrl ?? `https://bot.test.cyberworlds.dev/webhook${count}`,
                      secret: webhookSecret ?? null,
                  };

        const {id: createdId} = await createBotForTest(context, {
            id,
            name: initialName,
            webhook,
            ownerEntity,
        });

        return new TestBot(context, createdId, initialName);
    }

    /**
     * Get a `TestBot` instance for an existing bot instead of creating a new bot.
     */
    public static async get(context: TestContext, botId: BotId) {
        const {name} = await getBotItemForTest(context, botId);

        return new TestBot(context, botId, name);
    }

    public getItem() {
        return getBotItemForTest(this.context, this.id);
    }

    public async instantiate(
        session: TestSpaceSession,
        {id = generateId<AccountId>()}: {id?: AccountId} = {},
    ) {
        const account = await installBotInSpace(session.action(), {
            spaceId: session.space.id,
            botId: this.id,
            accountId: id,
        });

        return TestBotAccount._new(this, session.space, id, account.initialData.name);
    }

    public static async createAndInstantiate(
        session: TestSpaceSession,
        {accountId, name}: {accountId?: AccountId; name?: string} = {},
    ) {
        const bot = await TestBot.create(session.context, {name});
        return await bot.instantiate(session, {id: accountId});
    }

    public createUnscopedApiKey(apiKey?: ApiKey): Promise<ApiKey> {
        return createUnscopedApiKeyForTest(this.context, this.id, apiKey);
    }
}

export class TestBotAccount extends TestAccount {
    public readonly bot: TestBot;
    public readonly space: TestSpace;

    private constructor(bot: TestBot, space: TestSpace, id: AccountId, initialName: string) {
        super(bot.context, id, initialName);
        this.bot = bot;
        this.space = space;
    }

    public override withContext(context: TestContext): TestAccount {
        return new TestBotAccount(
            this.bot.withContext(context),
            this.space.withContext(context),
            this.id,
            this.initialName,
        );
    }

    // Should only be called by `TestBot`.
    public static _new(bot: TestBot, space: TestSpace, id: AccountId, initialName: string) {
        return new TestBotAccount(bot, space, id, initialName);
    }

    public action(
        scope: BotTokenScope | TestAccount | TestSession = {type: "Space"},
        options?: {serviceName?: ActorServiceName},
    ) {
        scope =
            scope instanceof TestAccount
                ? {type: "Account", accountId: scope.id}
                : scope instanceof TestSession
                  ? {type: "Account", accountId: scope.account.id}
                  : scope;

        return this.bot.context.botAction(this.space.id, this.id, scope, options);
    }

    public createUnscopedApiKey(): Promise<ApiKey> {
        return this.bot.createUnscopedApiKey();
    }

    public createApiKey(
        scope: BotTokenScope | TestAccount | TestSession = {type: "Space"},
    ): Promise<ApiKey> {
        scope =
            scope instanceof TestAccount
                ? {type: "Account", accountId: scope.id}
                : scope instanceof TestSession
                  ? {type: "Account", accountId: scope.account.id}
                  : scope;

        return createScopedApiKeyForTest(this.bot.context, this.bot.id, {
            spaceId: this.space.id,
            accountId: this.id,
            scope,
        });
    }
}
