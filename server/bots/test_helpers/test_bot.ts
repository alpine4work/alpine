import {
    createBotForTest,
    createScopedApiKeyForTest,
    createUnscopedApiKeyForTest,
    getBot,
    getBotItemForTest,
} from "~/server/bots/bots_table.js";
import {ActorServiceName} from "~/server/helpers/actor_context_module.js";
import {instantiateBotSpaceAccount} from "~/server/spaces/instantiate_bot_space_account.js";
import {TestAccount} from "~/server/spaces/test_helpers/test_account.js";
import {TestContext} from "~/server/spaces/test_helpers/test_context.js";
import {TestSession} from "~/server/spaces/test_helpers/test_session.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {TestSpaceSession} from "~/server/spaces/test_helpers/test_space_session.js";
import {BotTokenPayloadScope} from "~/server/tokens/token_payload.js";
import {ApiKey} from "~/shared/id/api_key.js";
import {generateId} from "~/shared/id/id.js";
import {AccountId, BotId} from "~/shared/id/types/id_types.js";

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
            name,
            webhookUrl,
        }: {
            name?: string;
            webhookUrl?: string;
        } = {},
    ) {
        const count = name === undefined || webhookUrl === undefined ? testBotCount++ : 0;

        const initialName = name ?? `Test Bot ${count}`;

        const {id} = await createBotForTest(context, {
            name: initialName,
            webhookUrl: webhookUrl ?? `https://bot.test.cyberworlds.dev/webhook${count}`,
        });

        return new TestBot(context, id, initialName);
    }

    /**
     * Get a `TestBot` instance for an existing bot instead of creating a new bot.
     */
    public static async get(context: TestContext, botId: BotId) {
        const bot = await getBot(context, botId);

        return new TestBot(context, botId, bot.name);
    }

    public getItem() {
        return getBotItemForTest(this.context, this.id);
    }

    public async instantiate(
        session: TestSpaceSession,
        {id = generateId<AccountId>()}: {id?: AccountId} = {},
    ) {
        const {name} = await instantiateBotSpaceAccount(session.action(), {
            spaceId: session.space.id,
            botId: this.id,
            accountId: id,
        });

        return TestBotAccount._new(this, session.space, id, name);
    }

    public static async createAndInstantiate(
        session: TestSpaceSession,
        {accountId, name}: {accountId?: AccountId; name?: string} = {},
    ) {
        const bot = await TestBot.create(session.context, {name});
        return bot.instantiate(session, {id: accountId});
    }

    public createUnscopedApiKey(): Promise<ApiKey> {
        return createUnscopedApiKeyForTest(this.context, this.id);
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
        scope: BotTokenPayloadScope | TestAccount | TestSession = {type: "Space"},
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
        scope: BotTokenPayloadScope | TestAccount | TestSession = {type: "Space"},
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
