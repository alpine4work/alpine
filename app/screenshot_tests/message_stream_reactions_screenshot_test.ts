import {uploadDemoSpaceBotAvatar} from "~/admin/environment/demo_space/upload_demo_space_bot_avatar.js";
import {TestActualContext} from "~/admin/environment/test/unit/with_unit_test_environment.js";
import {clearAccountInbox} from "~/app/screenshot_tests/helpers/clear_account_inbox.js";
import {ScreenshotTestRunner} from "~/app/screenshot_tests/helpers/run_screenshot_test.js";
import {TestBot} from "~/server/bots/test_helpers/test_bot.js";
import {TestChat} from "~/server/chat/test_helpers/test_chat.js";
import {TestMessagingRoomBase} from "~/server/messaging/test_helpers/test_messaging_room_base.js";
import {createSimpleMessageContent} from "~/shared/content/message_content_schema.js";
import {unsafelyGenerateStableId} from "~/shared/id/id.open_source.js";
import {ChatId} from "~/shared/id/types/id_types.open_source.js";

const screenshotTime = new Date("2025-10-02T15:48:00-04:00");

export async function run(context: TestActualContext, runner: ScreenshotTestRunner) {
    const {accounts} = await runner.createDemoSpace(context);

    // Instantiate the bot before the first browser navigation so the initial space
    // account registry includes it.
    const bot = await TestBot.create(context, {
        name: "ChatGPT",
        webhookUrl: null,
    });
    const botAccount = await bot.instantiate(accounts.cassCade);
    await uploadDemoSpaceBotAvatar(
        runner.services.getAppServiceTokenAgent(),
        accounts.roseCompas,
        bot.id,
        "chatGpt",
    );

    const chat = await TestChat.createRoom(accounts.cassCade, {
        id: unsafelyGenerateStableId<ChatId>(runner.stableRandom, "messageStreamReactionsChat"),
        name: "Tables",
        access: "Public",
    });
    await chat.sendMessage(
        accounts.cassCade,
        "Can you give me the quick tables status? Especially what\u2019s still unresolved after Matt\u2019s review.",
        {
            overrideCreatedTime: new Date(screenshotTime.getTime() - 60_000),
        },
    );

    const streamPartContents = [
        createSimpleMessageContent("Here\u2019s the tables status as of this afternoon."),
        createSimpleMessageContent(
            "Mason has the core interactions working and is going through Matt\u2019s design review notes.",
        ),
        createSimpleMessageContent("Column resizing is still open: smooth drag or snap to a grid."),
    ];
    const botContext = botAccount.action(chat.getBotScope());

    // Stream parts can only be written while the stream is fresh. Mock `Date.now()` to
    // the seeded message time while creating and completing the stream.
    const realDateNow = Date.now;
    Date.now = () => screenshotTime.getTime();
    try {
        const message = await TestMessagingRoomBase.createMessage(
            chat,
            botContext,
            {isStream: true},
            {overrideCreatedTime: screenshotTime},
        );

        for (let index = 0; index < streamPartContents.length; index++) {
            await message.putStreamPart(botContext, index, streamPartContents[index]!, {
                overrideCreatedTime: screenshotTime,
            });
        }
        await message.completeStream(botContext);

        await message.setReaction(
            accounts.cassCade,
            "Celebrate",
            streamPartContents[0]!.content.size + streamPartContents[1]!.content.size,
        );
    } finally {
        Date.now = realDateNow;
    }

    await clearAccountInbox(accounts.cassCade, runner);

    await runner.goto(accounts.cassCade, `/chat/${chat.id}`, {
        fixedTime: screenshotTime,
    });
    await runner
        .getByText(
            "Mason has the core interactions working and is going through Matt\u2019s design review notes.",
        )
        .waitFor();
    await runner.screenshot(null, "message-reactions-in-middle");
}
