import {addSeconds} from "date-fns";
import Mustache from "mustache";
import {DemoSpaceAccounts} from "~/admin/environment/demo_space/create_demo_space.js";
import {createDebug} from "~/admin/helpers/create_debug.js";
import {TestBotAccount} from "~/server/bots/test_helpers/test_bot.js";
import {TestChat} from "~/server/chat/test_helpers/test_chat.js";
import {TestDocument} from "~/server/documents/test_helpers/test_document.js";
import {parseTestMessageContent} from "~/server/messaging/test_helpers/test_messaging_room_base.js";
import {TestTask} from "~/server/tasks/data/test_helpers/test_task.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.open_source.js";
import {markdown} from "~/shared/helpers/string/markdown.js";

const debug = createDebug(import.meta.url);

export async function createFictionalAmbrookDemoAgents({
    cassCade,
    chatGpt,
    masonClay,
    elleKappaTan,
    mattRHorn,
    roseCompas,
}: DemoSpaceAccounts & {
    chatGpt: TestBotAccount;
}) {
    debug("Creating message");

    const {space} = cassCade;

    const tasksPromise = runAllPromises([
        TestTask.create(cassCade, {
            title: "Define the billing domain model & API",
        }),
        TestTask.create(cassCade, {
            title: "Document billing migration risks",
        }),
        TestTask.create(cassCade, {
            title: "Add a business impact & analytics section",
        }),
    ]);

    const [, document] = await runAllPromises([
        tasksPromise,
        (async () => {
            const document = await TestDocument.create(cassCade, {
                title: "Tech Spec: Billing Migration",
                access: "Public",
                /* eslint-disable cyberworlds/string-quotes */
                body: markdown`
Today, checking a user\u2019s current plan is hard because billing data is scattered across configs,
database flags, and our legacy payments API. Different parts of the app each “guess” the plan, which
makes it risky to change pricing or introduce new plans.

After the refactor, a single \`BillingService\` will be the source of truth for plans, limits, and
feature access. What our new code will look like:

~~~js
const plan = await billingService.getAccountPlan(accountId);
if (plan.code === "pro") enableProFeatures();
if (plan.includes("grants_navigator")) showGrantsTab();
if (plan.isTrial) showTrialBanner(plan.trialEndsAt);
~~~

This lets product code ask clear questions (“what plan is this account on?” or ”what can they use?”)
without knowing anything about the underlying payments vendor.

# Objectives

1. Establish a single source of truth for billing plans, pricing, and limits in our new payments
   vendor.

2. Expose a clear, type-safe API in our backend for:
    - Fetching a user/account\u2019s current plan.

    - Evaluating feature entitlements (e.g., “does this plan include Grants Navigator?”).

    - Enforcing usage limits (e.g., maximum number of entities, receipts, or users).

3. Reduce plan-related conditionals and environment-variable checks from product code; move them
   behind a well-documented billing service layer.

4. Make it easy to:
    - Introduce new plan types

    - Run migrations and experiments (e.g. promotional periods, grandfathered → new plan
      transitions).

5. Provide clear observability: log and monitor plan/entitlement decisions.

# Non-Goals

- Re-design public pricing or packaging (that\u2019s a PM responsibility; this spec only supports
  implementation).

- Replace all legacy subscriptions immediately. This spec covers:
    - Creating the new billing service,

    - Migrating new sign-ups and selected cohorts to the new vendor,

    - Defining patterns for gradual migration.

- Implement complex revenue analytics (MRR, churn, etc.). We will expose the primitives needed for
  future analytics work, but not build dashboards here.
                `,
                /* eslint-enable cyberworlds/string-quotes */
            });

            await runAllPromises([
                (async () => {
                    await document.createCommentThread(masonClay, {from: 286, to: 329}, "test");
                })(),
                (async () => {
                    const commentThread = await document.createCommentThread(
                        elleKappaTan,
                        {from: 513, to: 518},
                        "test",
                    );

                    await commentThread.createComment(elleKappaTan, "test");
                    await commentThread.createComment(masonClay, "test");
                    await commentThread.createComment(elleKappaTan, "test");
                    await commentThread.createComment(elleKappaTan, "test");
                    await commentThread.createComment(elleKappaTan, "test");
                    await commentThread.createComment(masonClay, "test");
                })(),
                (async () => {
                    const commentThread = await document.createCommentThread(
                        masonClay,
                        {from: 730, to: 753},
                        "test",
                    );

                    await commentThread.createComment(roseCompas, "test");
                    await commentThread.createComment(roseCompas, "test");
                    await commentThread.createComment(roseCompas, "test");
                    await commentThread.createComment(elleKappaTan, "test");
                })(),
                (async () => {
                    const commentThread = await document.createCommentThread(
                        elleKappaTan,
                        {from: 953, to: 966},
                        "test",
                    );

                    await commentThread.createComment(elleKappaTan, "test");
                })(),
                (async () => {
                    const commentThread = await document.createCommentThread(
                        mattRHorn,
                        {from: 1202, to: 1343},
                        "test",
                    );

                    await commentThread.createComment(mattRHorn, "test");
                    await commentThread.createComment(roseCompas, "test");
                })(),
            ]);

            return document;
        })(),
        (async () => {
            const chat = await TestChat.get(cassCade, chatGpt);

            await chat.sendMessage(
                cassCade,
                markdown`
Please read this document, summarize all the comments people have left (including comments from the
post I shared this in), and create followup tasks for me.
                `,
            );

            const streamMessage = await chat.sendMessage(chatGpt.action(chat.getBotScope()), "", {
                isStream: true,
            });

            await streamMessage.putStreamPart(chatGpt.action(chat.getBotScope()), 0, {
                type: "Reasoning",
                content: parseTestMessageContent("I\u2019m thinking here"),
            });

            const [task1, task2, task3] = await tasksPromise;

            await streamMessage.putStreamPart(
                chatGpt.action(chat.getBotScope()),
                1,
                Mustache.render(
                    markdown`
Here\u2019s how the feedback clusters and what to do with it:

- **Tighten the technical contract:** Engineers asked for a clear definition of the plan object and
  the \`BillingService\` API surface.

- **Cover concrete flows & risks:** PMs want an explicit \u201CRisks / Mitigations\u201D section for
  migration issues like double‑billing or wrong limits.

- **Articulate business impact:** Leadership wants a short, explicit statement of business impact,
  effects on revenue reporting and dashboards, and how this supports future pricing models and
  products.

Followup tasks:

- [Define the billing domain model & API](https://alpine.inc/task/{{task1Id}}#mention)

- [Document billing migration risks](https://alpine.inc/task/{{task2Id}}#mention)

- [Add a business impact & analytics section](https://alpine.inc/task/{{task3Id}}#mention)
                    `,
                    {
                        spaceId: space.id,
                        task1Id: task1.id,
                        task2Id: task2.id,
                        task3Id: task3.id,
                    },
                ),
                {
                    overrideCreatedTime: addSeconds(new Date(), 41),
                },
            );

            await streamMessage.completeStream(chatGpt.action(chat.getBotScope()));
        })(),
    ]);

    debug("Created message");

    return document;
}
