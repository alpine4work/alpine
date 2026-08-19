import {uploadDemoSpaceBotAvatar} from "~/admin/environment/demo_space/upload_demo_space_bot_avatar.js";
import {TestActualContext} from "~/admin/environment/test/unit/with_unit_test_environment.js";
import {clearAccountInbox} from "~/app/screenshot_tests/helpers/clear_account_inbox.js";
import {ScreenshotTestRunner} from "~/app/screenshot_tests/helpers/run_screenshot_test.js";
import {TestBot} from "~/server/bots/test_helpers/test_bot.js";
import {TestChat} from "~/server/chat/test_helpers/test_chat.js";
import {TestChannel} from "~/server/forum/test_helpers/test_channel.js";
import {
    TestMessageRoomBase,
    TestMessagingRoomBase,
} from "~/server/messaging/test_helpers/test_messaging_room_base.js";
import {TestSession} from "~/server/spaces/test_helpers/test_session.js";
import {TestSpaceSession} from "~/server/spaces/test_helpers/test_space_session.js";
import {createSimpleMessageContent} from "~/shared/content/message_content_schema.js";
import {
    MessageExperimentalApproval,
    MessageExperimentalApprovalDecisionOption,
    MessageStreamPartPayload,
} from "~/shared/messaging/message_schema.js";

// The duration the Claude agent puts on every session scoped option it offers, see
// `buildClaudeAgentApprovalDecisionOptions()`.
const sessionDurationMinutes = 4 * 60;

// The decision text screenshots show six approval cards at once which doesn't fit
// in the default 1024px tall viewport.
const decisionTextViewport = {width: 1366, height: 1200};

export async function run(context: TestActualContext, runner: ScreenshotTestRunner) {
    const {accounts} = await runner.createDemoSpace(context);

    // Create a bot without a webhook so it never responds to the messages we seed. We
    // seed the bot's approval requests ourselves.
    const bot = await TestBot.create(context, {name: "ChatGPT", webhookUrl: null});
    const botAccount = await bot.instantiate(accounts.cassCade);

    // Rose has internal access which allows her to upload the known bot avatar.
    await uploadDemoSpaceBotAvatar(
        runner.services.getAppServiceTokenAgent(),
        accounts.roseCompas,
        bot.id,
        "chatGpt",
    );

    // It's October 15, 2025: tables shipped today (universe week 6) and Cass is using
    // the agent to wrap up the launch.
    const launchDayTime = new Date("2025-10-15T18:00:00.000Z");
    const fixedTime = new Date("2025-10-15T18:30:00.000Z");

    let nextMessageTimeOffsetMinutes = 0;
    function nextMessageTime() {
        return new Date(launchDayTime.getTime() + nextMessageTimeOffsetMinutes++ * 60_000);
    }

    async function sendBotApprovalMessage(
        room: TestMessageRoomBase,
        {
            content,
            approvals,
            botScope,
        }: {
            content: string;
            approvals: ReadonlyArray<MessageExperimentalApproval>;

            /**
             * The bot writes with the room's scope by default which carries view-equivalent
             * access. Pass the session of the account the bot is acting for when the bot needs
             * that account's access to write (e.g. commenting in a view-only channel).
             */
            botScope?: TestSession;
        },
    ) {
        const botContext = botAccount.action(botScope ?? room.getBotScope());
        const messageTime = nextMessageTime();

        // Stream parts can only be written while the stream is fresh
        // (`hasMessageStreamDefinitelyTimedOut()`) and we seed messages in the past. Mock
        // `Date.now()` to the seeded time while writing the stream, the same way
        // `testMessagingImplementation()` tests do.
        const realDateNow = Date.now;
        Date.now = () => messageTime.getTime();
        try {
            const message = await TestMessagingRoomBase.createMessage(
                room,
                botContext,
                {isStream: true},
                {overrideCreatedTime: messageTime},
            );

            await message.putStreamPart(botContext, 0, content, {
                overrideCreatedTime: messageTime,
            });

            // An `ExperimentalApprovals` part must be the last part of the stream and putting
            // one completes the stream.
            const approvalsPart: MessageStreamPartPayload = {
                type: "ExperimentalApprovals",
                approvals,
            };
            await message.putStreamPart(botContext, 1, approvalsPart, {
                overrideCreatedTime: messageTime,
            });

            await runner.drainBackgroundWork();
            return message;
        } finally {
            Date.now = realDateNow;
        }
    }

    // A 1:1 chat between Cass and the agent with two undecided approval requests. The
    // first uses the default Approved/Rejected options ("Allow"/"Cancel" buttons). The
    // second has session scoped options which render as a checkbox with a dropdown.
    {
        const chat = await TestChat.get(accounts.cassCade, botAccount);

        await chat.sendMessage(
            accounts.cassCade,
            "tables is live! can you post the launch announcement to the forum? holly already published the help doc",
            {overrideCreatedTime: nextMessageTime()},
        );

        await sendBotApprovalMessage(chat, {
            content:
                "I drafted the announcement from Holly\u2019s help doc and Mason\u2019s ship " +
                "notes. It covers cell selection, keyboard navigation, and the new column " +
                "resizing behavior. Ready to post when you are.",
            approvals: [
                {
                    // Long enough to wrap onto a second line so the screenshot covers the summary's
                    // hanging indent (wrapped lines align with the text, not the badge).
                    summary: createSimpleMessageContent(
                        "Post \u201CTables are here\u201D to the forum with the launch " +
                            "summary, the keyboard shortcuts, and a link to Holly\u2019s " +
                            "help doc",
                    ),
                    decision: {
                        schema: {options: [{type: "Approved"}, {type: "Rejected"}]},
                    },
                },
            ],
        });

        await screenshotMessages(accounts.cassCade, runner, "pending", {
            path: `/chat/${chat.id}`,
            orderKey: "a0",
            fixedTime,
        });

        await chat.sendMessage(
            accounts.cassCade,
            "perfect. also can you clean up the sprint board? lots of stale tasks left over from the tables work",
            {overrideCreatedTime: nextMessageTime()},
        );

        await sendBotApprovalMessage(chat, {
            content:
                "There are 6 tasks in the Tables sprint that haven\u2019t been touched in over " +
                "two weeks. I can archive them once, or you can approve archiving for a while " +
                "and I\u2019ll keep the board tidy as the launch wraps up.",
            approvals: [
                {
                    summary: createSimpleMessageContent(
                        "Archive 6 stale tasks in the Tables sprint",
                    ),
                    decision: {
                        schema: {
                            options: [
                                {type: "Approved"},
                                {
                                    type: "ApprovedForSession",
                                    scope: {value: "tasks.archive"},
                                    durationMinutes: null,
                                },
                                {
                                    type: "ApprovedForSession",
                                    scope: {value: "tasks.archive"},
                                    durationMinutes: 30,
                                },
                                {type: "Rejected"},
                            ],
                        },
                    },
                },
            ],
        });

        await screenshotMessages(accounts.cassCade, runner, "pending-session-options", {
            path: `/chat/${chat.id}`,
            orderKey: "a1",
            fixedTime,
        });

        await runner.getByRole("button", {name: "More approval options"}).click();
        await runner.mouse.move(0, 0);
        await screenshotMessages(accounts.cassCade, runner, "pending-session-options-menu", {
            orderKey: "a2",
            fixedTime,
        });
    }

    // A group chat where approvals have already been decided. From Cass's perspective
    // one approval was approved by Holly and another was rejected by Cass herself ("by
    // you").
    {
        const chat = await TestChat.get(accounts.cassCade, accounts.hollyEvergreen, botAccount);

        await chat.sendMessage(
            accounts.hollyEvergreen,
            "Asked ChatGPT to schedule the launch thread so we don\u2019t have to babysit it tomorrow",
            {overrideCreatedTime: nextMessageTime()},
        );

        await sendBotApprovalMessage(chat, {
            content:
                "Scheduled. The thread will go out tomorrow at 9am ET — I\u2019ll post " +
                "engagement numbers here once it\u2019s live.",
            approvals: [
                {
                    summary: createSimpleMessageContent(
                        "Schedule the launch thread for Oct 16, 9:00 AM ET",
                    ),
                    decision: {
                        schema: {options: [{type: "Approved"}, {type: "Rejected"}]},
                        value: {
                            type: "Approved",
                            decider: {account: {id: accounts.hollyEvergreen.account.id}},
                        },
                    },
                },
            ],
        });

        await chat.sendMessage(
            accounts.cassCade,
            "can you also add the beta customers to the tables rollout list?",
            {overrideCreatedTime: nextMessageTime()},
        );

        await sendBotApprovalMessage(chat, {
            content:
                "I can add the 12 beta customers to the rollout list. This changes who gets " +
                "the feature immediately, so I need a sign-off first.",
            approvals: [
                {
                    summary: createSimpleMessageContent(
                        "Add 12 beta customers to the Tables rollout",
                    ),
                    decision: {
                        schema: {options: [{type: "Approved"}, {type: "Rejected"}]},
                        value: {
                            type: "Rejected",
                            decider: {account: {id: accounts.cassCade.account.id}},
                        },
                    },
                },
            ],
        });

        await screenshotMessages(accounts.cassCade, runner, "decided", {
            path: `/chat/${chat.id}`,
            orderKey: "a3",
            fixedTime,
        });
    }

    // Back in the 1:1 chat: one agent message asking for sign-off on three launch
    // wrap-up actions. Multiple approvals page inside a single card. Cass already
    // approved the first, so the card opens on the first undecided approval (2 of 3)
    // and the header arrows page between them.
    {
        const chat = await TestChat.get(accounts.cassCade, botAccount);

        await chat.sendMessage(
            accounts.cassCade,
            "last thing — can you wrap up the launch? changelog, support heads up, and close out the war room",
            {overrideCreatedTime: nextMessageTime()},
        );

        await sendBotApprovalMessage(chat, {
            content:
                "Three things left to wrap up the launch. Sign off on each and " +
                "I\u2019ll get going.",
            approvals: [
                {
                    summary: createSimpleMessageContent("Publish the Tables changelog entry"),
                    decision: {
                        schema: {options: [{type: "Approved"}, {type: "Rejected"}]},
                        value: {
                            type: "Approved",
                            decider: {account: {id: accounts.cassCade.account.id}},
                        },
                    },
                },
                {
                    // Long enough to wrap next to the pagination controls.
                    summary: createSimpleMessageContent(
                        "Post a heads-up in the support channel about the launch " +
                            "and the new keyboard shortcuts help doc",
                    ),
                    decision: {
                        schema: {options: [{type: "Approved"}, {type: "Rejected"}]},
                    },
                },
                {
                    summary: createSimpleMessageContent("Archive the launch war room chat"),
                    decision: {
                        schema: {options: [{type: "Approved"}, {type: "Rejected"}]},
                    },
                },
            ],
        });

        await screenshotMessages(accounts.cassCade, runner, "paginated-first-undecided", {
            path: `/chat/${chat.id}`,
            orderKey: "a4",
            fixedTime,
        });

        await runner.getByRole("button", {name: "Next approval"}).click();
        await runner.mouse.move(0, 0);
        await screenshotMessages(accounts.cassCade, runner, "paginated-last", {
            orderKey: "a5",
            fixedTime,
        });

        await runner.getByRole("button", {name: "Previous approval"}).click();
        await runner.getByRole("button", {name: "Previous approval"}).click();
        await runner.mouse.move(0, 0);

        await screenshotMessages(accounts.cassCade, runner, "paginated-decided", {
            orderKey: "a6",
            fixedTime,
        });
    }

    // An announcements channel where only Rose can write: everyone else gets read-only
    // access. From Cass's perspective the bot's approval cards have no decision
    // buttons — one approval was already allowed by Rose and the other renders as
    // "Waiting for approval".
    {
        const channel = await TestChannel.create(accounts.roseCompas, {
            name: "Announcements",
            access: {
                type: "Local",
                accountGrantById: new Map([
                    [accounts.roseCompas.account.id, {level: "Manage", generation: 0}],
                ]),
                defaultGrant: {level: "View"},
                urlGrant: null,
            },
        });

        const post = await channel.createPost(
            accounts.roseCompas,
            "Tables is live. Six weeks from first commit to launch — congratulations to " +
                "Mason, Elle, and Matt for the build and to Holly for the docs and the " +
                "announcement. Investor update goes out Friday.",
            {overrideCreatedTime: nextMessageTime()},
        );

        await post.sendMessage(
            accounts.roseCompas,
            "ChatGPT, handle the follow-ups: draft the investor update and keep this post " +
                "pinned through launch week",
            {overrideCreatedTime: nextMessageTime()},
        );

        await sendBotApprovalMessage(post, {
            botScope: accounts.roseCompas,
            content:
                "Drafted the investor update from the launch metrics and the week 6 ship " +
                "notes. It leads with tables adoption in the beta cohort.",
            approvals: [
                {
                    summary: createSimpleMessageContent(
                        "Send the investor update draft to Rose for review",
                    ),
                    decision: {
                        schema: {options: [{type: "Approved"}, {type: "Rejected"}]},
                        value: {
                            type: "Approved",
                            decider: {account: {id: accounts.roseCompas.account.id}},
                        },
                    },
                },
            ],
        });

        await sendBotApprovalMessage(post, {
            botScope: accounts.roseCompas,
            content: "I can also pin this announcement to the top of the channel.",
            approvals: [
                {
                    summary: createSimpleMessageContent(
                        "Pin this announcement until Friday, Oct 17",
                    ),
                    decision: {
                        schema: {options: [{type: "Approved"}, {type: "Rejected"}]},
                    },
                },
            ],
        });

        await screenshotMessages(accounts.cassCade, runner, "read-only-post", {
            path: `/post/${post.id}`,
            orderKey: "a7",
            fixedTime,
        });
    }

    // A decided approval that picked a session scoped option. `optionSummary` is the
    // summary on the option that was picked (e.g. "all writes"), which is what makes
    // the decided text name the decider up front instead of trailing "by Cass".
    //
    // `scope`, `optionSummary`, and `sessionDurationMinutes` mirror what the Claude
    // agent offers today, see `buildClaudeAgentApprovalDecisionOptions()`: a `Write`
    // scope summarized as "all writes" or a `Web` scope summarized as "all web
    // access", always time boxed to four hours. Rows that leave `optionSummary` out or
    // pass a null duration cover shapes the schema allows and this card renders but
    // that the agent doesn't currently produce.
    function decidedSessionApproval({
        summary,
        optionSummary,
        durationMinutes,
        scope,
        decider,
    }: {
        summary: string;
        optionSummary?: string;
        durationMinutes: number | null;
        scope: string;
        decider: TestSpaceSession;
    }): MessageExperimentalApproval {
        const sessionOption: MessageExperimentalApprovalDecisionOption =
            optionSummary === undefined
                ? {type: "ApprovedForSession", scope: {value: scope}, durationMinutes}
                : {
                      type: "ApprovedForSession",
                      scope: {value: scope},
                      summary: createSimpleMessageContent(optionSummary),
                      durationMinutes,
                  };

        return {
            summary: createSimpleMessageContent(summary),
            decision: {
                schema: {
                    options: [{type: "Approved"}, sessionOption, {type: "Rejected"}],
                },
                value: {
                    type: "ApprovedForSession",
                    scope: {value: scope},
                    durationMinutes,
                    decider: {account: {id: decider.account.id}},
                },
            },
        };
    }

    // Every shape the decided approval text can take, one approval per message so each
    // one gets its own card. The text varies with the decision type, whether the
    // option that was picked carries a summary, and whether it was time boxed. Cass
    // decides all six here so they read "by you" — the next chat covers deciding as
    // someone else, which is where the wording differs beyond swapping the name.
    {
        const chat = await TestChat.get(accounts.cassCade, botAccount);

        await chat.sendMessage(
            accounts.cassCade,
            "heading into the retro — work through the rest of the punch list and i\u2019ll sign off as you go",
            {overrideCreatedTime: nextMessageTime()},
        );

        await sendBotApprovalMessage(chat, {
            content: "The changelog entry is drafted and ready to publish.",
            approvals: [
                {
                    summary: createSimpleMessageContent("Publish the Tables changelog entry"),
                    decision: {
                        schema: {options: [{type: "Approved"}, {type: "Rejected"}]},
                        value: {
                            type: "Approved",
                            decider: {account: {id: accounts.cassCade.account.id}},
                        },
                    },
                },
            ],
        });

        await sendBotApprovalMessage(chat, {
            content: "I can let the beta cohort know about the new keyboard shortcuts too.",
            approvals: [
                {
                    summary: createSimpleMessageContent("Email the 12 beta customers about tables"),
                    decision: {
                        schema: {options: [{type: "Approved"}, {type: "Rejected"}]},
                        value: {
                            type: "Rejected",
                            decider: {account: {id: accounts.cassCade.account.id}},
                        },
                    },
                },
            ],
        });

        await sendBotApprovalMessage(chat, {
            content: "The sprint collection still reads as in progress.",
            approvals: [
                decidedSessionApproval({
                    summary: "Rename the Tables sprint to \u201CTables (shipped)\u201D",
                    durationMinutes: null,
                    scope: "Write",
                    decider: accounts.cassCade,
                }),
            ],
        });

        await sendBotApprovalMessage(chat, {
            content: "Six tasks from the tables sprint never got closed out.",
            approvals: [
                decidedSessionApproval({
                    summary: "Move 6 stale tables tasks to the backlog",
                    durationMinutes: sessionDurationMinutes,
                    scope: "Write",
                    decider: accounts.cassCade,
                }),
            ],
        });

        await sendBotApprovalMessage(chat, {
            content:
                "There\u2019s a long tail of small cleanups left on the board — descriptions " +
                "that still describe tables as in flight, a few duplicate tasks from the " +
                "sprint, and some assignees who have rolled off.",
            approvals: [
                decidedSessionApproval({
                    summary: "Close the remaining tables tasks",
                    optionSummary: "all writes",
                    durationMinutes: null,
                    scope: "Write",
                    decider: accounts.cassCade,
                }),
            ],
        });

        await sendBotApprovalMessage(chat, {
            content: "Matt\u2019s audit follow-ups should move to next sprint.",
            approvals: [
                decidedSessionApproval({
                    summary: "Reassign Matt\u2019s audit follow-ups to next sprint",
                    optionSummary: "all writes",
                    durationMinutes: sessionDurationMinutes,
                    scope: "Write",
                    decider: accounts.cassCade,
                }),
            ],
        });

        await screenshotMessages(accounts.cassCade, runner, "decided-text-by-you", {
            path: `/chat/${chat.id}`,
            orderKey: "a8",
            fixedTime,
            // Taller than the default viewport so all six cards fit in one image.
            viewport: decisionTextViewport,
        });
    }

    // The same six shapes decided by Holly instead of Cass. Worth its own screenshot
    // because the decider isn't just a different name: the rows whose option carries a
    // summary put the decider at the start of the sentence, so this is where we see
    // someone else's name lead the sentence rather than a capitalized "You".
    {
        const chat = await TestChat.get(accounts.cassCade, accounts.hollyEvergreen, botAccount);

        await chat.sendMessage(
            accounts.hollyEvergreen,
            "Having ChatGPT check our references while I finish the announcement",
            {overrideCreatedTime: nextMessageTime()},
        );

        await sendBotApprovalMessage(chat, {
            content: "The help doc is formatted and ready.",
            approvals: [
                {
                    summary: createSimpleMessageContent("Publish the tables help doc"),
                    decision: {
                        schema: {options: [{type: "Approved"}, {type: "Rejected"}]},
                        value: {
                            type: "Approved",
                            decider: {account: {id: accounts.hollyEvergreen.account.id}},
                        },
                    },
                },
            ],
        });

        await sendBotApprovalMessage(chat, {
            content: "I can push the announcement to the customer newsletter as well.",
            approvals: [
                {
                    summary: createSimpleMessageContent(
                        "Send the tables announcement to the newsletter list",
                    ),
                    decision: {
                        schema: {options: [{type: "Approved"}, {type: "Rejected"}]},
                        value: {
                            type: "Rejected",
                            decider: {account: {id: accounts.hollyEvergreen.account.id}},
                        },
                    },
                },
            ],
        });

        await sendBotApprovalMessage(chat, {
            content: "The announcement draft links out to four external references.",
            approvals: [
                decidedSessionApproval({
                    summary: "Read the four links cited in the announcement draft",
                    durationMinutes: null,
                    scope: "Web",
                    decider: accounts.hollyEvergreen,
                }),
            ],
        });

        await sendBotApprovalMessage(chat, {
            content: "Some of the docs we link to may have moved since we wrote them.",
            approvals: [
                decidedSessionApproval({
                    summary: "Check every outbound link in the tables help doc",
                    durationMinutes: sessionDurationMinutes,
                    scope: "Web",
                    decider: accounts.hollyEvergreen,
                }),
            ],
        });

        await sendBotApprovalMessage(chat, {
            content:
                "The case study quotes two customers and cites their public pricing pages, " +
                "and I\u2019d like to confirm all of it still reads the way we wrote it " +
                "before this goes out.",
            approvals: [
                decidedSessionApproval({
                    summary: "Verify the sources the case study cites",
                    optionSummary: "all web access",
                    durationMinutes: null,
                    scope: "Web",
                    decider: accounts.hollyEvergreen,
                }),
            ],
        });

        await sendBotApprovalMessage(chat, {
            content: "The announcement mentions integrations I should double check.",
            approvals: [
                decidedSessionApproval({
                    summary: "Look up the integrations the announcement mentions",
                    optionSummary: "all web access",
                    durationMinutes: sessionDurationMinutes,
                    scope: "Web",
                    decider: accounts.hollyEvergreen,
                }),
            ],
        });

        await screenshotMessages(accounts.cassCade, runner, "decided-text-by-other-account", {
            path: `/chat/${chat.id}`,
            orderKey: "a9",
            fixedTime,
            viewport: decisionTextViewport,
        });
    }
}

async function screenshotMessages(
    session: TestSpaceSession,
    runner: ScreenshotTestRunner,
    name: string,
    {
        path,
        orderKey,
        fixedTime,
        viewport,
    }: {
        path?: string;
        orderKey: string;
        fixedTime: Date;
        viewport?: "wide" | {width: number; height: number};
    },
) {
    await clearAccountInbox(session, runner);

    if (path) {
        await runner.goto(session, path, {fixedTime, viewport});
    }
    await runner.screenshot(orderKey, name);
}
