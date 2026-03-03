import {BillingContextModuleBase} from "~/server/billing/billing_context_module_base.js";
import {
    ServerAccountActionContextModules,
    ServerActionContextModules,
    ServerAnonymousActionContextModules,
    ServerBotActionContextModules,
    ServerImpersonatedAccountActionContextModules,
    ServerSessionActionContextModules,
    ServerSystemActionContextModules,
    ServerUnknownActionContextModules,
} from "~/server/context/server_action_context.js";
import {ServerProcessContextModules} from "~/server/context/server_process_context.js";
import {SlackContextModuleBase} from "~/server/context/slack_context_module_base.js";
import {EmailContextModuleBase} from "~/server/emails/email_context_module_base.js";
import {ActorContextModule, ActorServiceName} from "~/server/helpers/actor_context_module.js";
import {ImporterContextModuleBase} from "~/server/importer/importer_context_module_base.js";
import {LogoDevContextModuleBase} from "~/server/spaces/logo_dev_context_module.js";
import {BotTokenPayloadScope} from "~/server/tokens/token_payload.js";
import {BatchContextModule} from "~/shared/context/batch_context_module.js";
import {CacheContextModule} from "~/shared/context/cache_context_module.js";
import {Context, ContextWithDestroy} from "~/shared/context/context.js";
import {ContextModuleBase} from "~/shared/context/context_module_base.js";
import {ForkActionContextModule} from "~/shared/context/fork_action_context_module.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {Replace} from "~/shared/helpers/types/replace.js";
import {AccountId, SessionId, SpaceId} from "~/shared/id/types/id_types.js";

type TestContextExtraModules = {
    email: EmailContextModuleBase;
    billing: BillingContextModuleBase;
    importer: ImporterContextModuleBase;
    slack: SlackContextModuleBase;
    logoDev: LogoDevContextModuleBase;
};

export type TestContextModules = ServerProcessContextModules & TestContextExtraModules;

export type TestContext = Context<TestContextModules> & TestContextHelpers<TestContextModules>;

export type TestActionContextModules = ServerActionContextModules & TestContextExtraModules;

export type TestActionContext = Context<TestActionContextModules>;

export type TestSessionActionContextModules = ServerSessionActionContextModules &
    TestContextExtraModules & {
        fork: ForkActionContextModule;
    };

export type TestSessionActionContext = Context<TestSessionActionContextModules>;

export type TestSystemActionContextModules = ServerSystemActionContextModules &
    TestContextExtraModules;

export type TestSystemActionContext = Context<TestSystemActionContextModules>;

export type TestAnonymousActionContextModules = ServerAnonymousActionContextModules &
    TestContextExtraModules;

export type TestAnonymousActionContext = Context<TestAnonymousActionContextModules>;

export type TestImpersonatedAccountActionContextModules =
    ServerImpersonatedAccountActionContextModules & TestContextExtraModules;

export type TestImpersonatedAccountActionContext =
    Context<TestImpersonatedAccountActionContextModules>;

export type TestBotActionContextModules = ServerBotActionContextModules & TestContextExtraModules;

export type TestBotActionContext = Context<TestBotActionContextModules>;

export type TestAccountActionContext = Context<TestAccountActionContextModules>;

export type TestAccountActionContextModules = ServerAccountActionContextModules &
    TestContextExtraModules;

export type TestUnknownActionContextModules = ServerUnknownActionContextModules &
    TestContextExtraModules;

export type TestUnknownActionContext = Context<TestUnknownActionContextModules>;

export type TestContextWithDestroy<Modules extends {[key: string]: ContextModuleBase}> =
    ContextWithDestroy<Modules> & TestContextHelpers<Modules>;

export type TestContextHelpers<Modules extends {[key: string]: ContextModuleBase}> = {
    /**
     * An action with an authenticated session.
     */
    action(
        session:
            | {id: SessionId; account: {id: AccountId}}
            | {sessionId: SessionId; accountId: AccountId},
        options?: {serviceName?: ActorServiceName},
    ): TestSessionActionContext;

    /**
     * An authenticated system action.
     */
    systemAction(
        spaceId: SpaceId,
        options?: {serviceName?: ActorServiceName},
    ): TestSystemActionContext;

    /**
     * An anonymous action.
     */
    anonymousAction(options?: {serviceName?: ActorServiceName}): TestAnonymousActionContext;

    /**
     * An authenticated impersonated account action.
     */
    impersonatedAccountAction(
        spaceId: SpaceId,
        accountId: AccountId,
        options?: {serviceName?: ActorServiceName},
    ): TestImpersonatedAccountActionContext;

    /**
     * An action for a bot in some specified scope.
     *
     * This function assumes you've already validated that `botAccountId` is actually
     * an `AccountId` for a bot account.
     */
    botAction(
        spaceId: SpaceId,
        botAccountId: AccountId,
        scope?: BotTokenPayloadScope,
        options?: {serviceName?: ActorServiceName},
    ): TestBotActionContext;

    /**
     * An action where we don't know whether we're authenticated or not. When
     * authenticated it'll be an anonymous actor.
     */
    unknownAnonymousAction(): TestUnknownActionContext;

    /**
     * Escalate one of our existing test contexts to a system context.
     */
    readonly escalateToSystemContext: <Value>(
        context: Context<{
            tracer: TracerContextModule;
            actor?: ActorContextModule;
            cache: CacheContextModule;
            batch: BatchContextModule;
        }>,
        spaceId: SpaceId,
        action: (context: TestSystemActionContext) => Promise<Value>,
    ) => Promise<Value>;

    /**
     * `Context.clone()` but preserves `TestContext`'s helper functions like
     * `context.action()` on the cloned context.
     */
    cloneWithHelpers<NewModules extends {[key: string]: ContextModuleBase}>(
        newModules: NewModules,
    ): TestContextWithDestroy<Replace<Modules, NewModules>>;
};
