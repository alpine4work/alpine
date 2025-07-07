import {TestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {ContentMention} from "~/shared/content/content_mention.js";
import {DynamoGeneralRealtimeIndexQueryResult} from "~/shared/dynamo/dynamo_general_realtime_types.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {cast} from "~/shared/helpers/control/cast.js";
import {
    MessageContentProsemirrorSchema,
    assertMessageContent,
} from "~/shared/messaging/message_content_schema.js";
import {InboxEntryModel} from "~/shared/notifications/inbox_model.js";

// Notification table test helpers can only be used in Jest.
assert(import.meta.jest);

// We create a new scenario for every test so the inbox isn't shared between
// test runs.
export async function createNotificationsScenario(context: TestContext) {
    const space = await TestSpace.create(context);
    const otherSpace = await TestSpace.create(context);

    const [session1, session2, session3, otherSession, sharedSession] = await runAllPromises([
        space.createSession(),
        space.createSession(),
        space.createSession(),
        otherSpace.createSession(),
        space.createSession(),
    ]);

    const sharedSessionInOtherSpace = await otherSpace.createSession(sharedSession.account);

    const mentionAccount1MessageContent = assertMessageContent(
        MessageContentProsemirrorSchema.node("doc", {}, [
            MessageContentProsemirrorSchema.node("paragraph", {}, [
                MessageContentProsemirrorSchema.text("Hello "),
                MessageContentProsemirrorSchema.node("mention", {
                    mention: cast<ContentMention>({
                        type: "Account",
                        accountId: session1.account.id,
                        isShort: false,
                    }),
                }),
                MessageContentProsemirrorSchema.text("!"),
            ]),
        ]),
    );

    const mentionAccount2MessageContent = assertMessageContent(
        MessageContentProsemirrorSchema.node("doc", {}, [
            MessageContentProsemirrorSchema.node("paragraph", {}, [
                MessageContentProsemirrorSchema.text("Hello "),
                MessageContentProsemirrorSchema.node("mention", {
                    mention: cast<ContentMention>({
                        type: "Account",
                        accountId: session2.account.id,
                        isShort: false,
                    }),
                }),
                MessageContentProsemirrorSchema.text("!"),
            ]),
        ]),
    );

    const mentionAccount3MessageContent = assertMessageContent(
        MessageContentProsemirrorSchema.node("doc", {}, [
            MessageContentProsemirrorSchema.node("paragraph", {}, [
                MessageContentProsemirrorSchema.text("Hello "),
                MessageContentProsemirrorSchema.node("mention", {
                    mention: cast<ContentMention>({
                        type: "Account",
                        accountId: session3.account.id,
                        isShort: false,
                    }),
                }),
                MessageContentProsemirrorSchema.text("!"),
            ]),
        ]),
    );

    const mentionSharedAccountMessageContent = assertMessageContent(
        MessageContentProsemirrorSchema.node("doc", {}, [
            MessageContentProsemirrorSchema.node("paragraph", {}, [
                MessageContentProsemirrorSchema.text("Hello "),
                MessageContentProsemirrorSchema.node("mention", {
                    mention: cast<ContentMention>({
                        type: "Account",
                        accountId: sharedSession.account.id,
                        isShort: false,
                    }),
                }),
                MessageContentProsemirrorSchema.text("!"),
            ]),
        ]),
    );

    return {
        space,
        otherSpace,
        session1,
        session2,
        session3,
        otherSession,
        sharedSession,
        sharedSessionInOtherSpace,
        mentionAccount1MessageContent,
        mentionAccount2MessageContent,
        mentionAccount3MessageContent,
        mentionSharedAccountMessageContent,
    };
}

export function massageInboxEntriesQuery(
    entriesQuery: DynamoGeneralRealtimeIndexQueryResult<InboxEntryModel>,
): Array<InboxEntryModel> {
    return entriesQuery.items.map(({model}) => model);
}
