import {finishUploadingBotAvatar} from "~/server/bots/finish_uploading_bot_avatar.js";
import {getBotWithAvatar} from "~/server/bots/get_bot_with_avatar.js";
import {TestBot} from "~/server/bots/test_helpers/test_bot.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {PermissionDeniedError} from "~/shared/error/error.js";
import {
    generateChronologicalId,
    generateChronologicalIdWithTime,
} from "~/shared/id/chronological_id.js";
import {AvatarId} from "~/shared/id/types/id_types.js";

const context = createTestContext();

test("successfully uploads a bot avatar", async () => {
    const bot = await TestBot.create(context, {
        name: "Test Bot",
        webhookUrl: "https://example.com/webhook",
    });

    const space = await TestSpace.create(context);
    const session = await space.createSession({role: "Owner", hasInternalAccess: true});

    const avatarId = generateChronologicalId<AvatarId>();
    const avatarContent = new TextEncoder().encode("test-avatar-content");

    const result = await finishUploadingBotAvatar(session.action(), {
        botId: bot.id,
        avatarContent,
        avatarId,
    });

    expect(result.id).toEqual(bot.id);
    expect(result.name).toEqual("Test Bot");
    expect(result.avatar).toEqual({
        avatarId,
        content: avatarContent,
        version: 1,
    });

    // Verify the avatar was persisted
    const botWithAvatar = await getBotWithAvatar(context, bot.id);
    expect(botWithAvatar.avatar).toEqual({
        avatarId,
        content: expect.any(Uint8Array),
        version: 1,
    });
});

test("returns existing bot when avatar ID is not newer (idempotency)", async () => {
    const bot = await TestBot.create(context, {
        name: "Test Bot",
        webhookUrl: "https://example.com/webhook",
    });

    const space = await TestSpace.create(context);
    const session = await space.createSession({role: "Owner", hasInternalAccess: true});

    const olderAvatarId = generateChronologicalIdWithTime<AvatarId>(
        new Date("2025-01-01").getTime(),
    );
    const olderAvatarContent = new TextEncoder().encode("older-avatar-content");

    // Upload first avatar with newer ID
    const newerAvatarId = generateChronologicalIdWithTime<AvatarId>(
        new Date("2025-01-02").getTime(),
    );
    const newerAvatarContent = new TextEncoder().encode("newer-avatar-content");

    await finishUploadingBotAvatar(session.action(), {
        botId: bot.id,
        avatarContent: newerAvatarContent,
        avatarId: newerAvatarId,
    });
    const botWithNewerAvatar = await getBotWithAvatar(context, bot.id);

    const oldAvatarResult = await finishUploadingBotAvatar(session.action(), {
        botId: bot.id,
        avatarContent: olderAvatarContent,
        avatarId: olderAvatarId,
    });

    // Should return the bot with the newer avatar, not update it
    expect(oldAvatarResult.avatar).toEqual(botWithNewerAvatar.avatar);

    // Verify the bot hasn't changed
    const botWithAvatar = await getBotWithAvatar(context, bot.id);
    expect(botWithAvatar).toEqual(botWithNewerAvatar);
});

test("returns existing bot when avatar ID is equal (idempotency)", async () => {
    const bot = await TestBot.create(context, {
        name: "Test Bot",
        webhookUrl: "https://example.com/webhook",
    });

    const space = await TestSpace.create(context);
    const session = await space.createSession({role: "Owner", hasInternalAccess: true});

    const avatarId = generateChronologicalId<AvatarId>();
    const firstAvatarContent = new TextEncoder().encode("first-avatar-content");

    await finishUploadingBotAvatar(session.action(), {
        botId: bot.id,
        avatarContent: firstAvatarContent,
        avatarId,
    });
    const botAfterFirstAvatarUpload = await getBotWithAvatar(context, bot.id);

    // Try to upload with the same avatar ID but different content
    const secondAvatarContent = new TextEncoder().encode("second-avatar-content");

    // Upload second avatar
    await finishUploadingBotAvatar(session.action(), {
        botId: bot.id,
        avatarContent: secondAvatarContent,
        avatarId,
    });

    const botAfterSecondAvatarUpload = await getBotWithAvatar(context, bot.id);
    // Should return the bot with the first avatar
    expect(botAfterSecondAvatarUpload).toEqual(botAfterFirstAvatarUpload);
});

test("throws PermissionDeniedError when user doesn’t have internal access", async () => {
    const bot = await TestBot.create(context, {
        name: "Test Bot",
        webhookUrl: "https://example.com/webhook",
    });

    const space = await TestSpace.create(context);
    const session = await space.createSession({role: "Owner", hasInternalAccess: false});

    const avatarId = generateChronologicalId<AvatarId>();
    const avatarContent = new TextEncoder().encode("test-avatar-content");

    await expect(
        finishUploadingBotAvatar(session.action(), {
            botId: bot.id,
            avatarContent,
            avatarId,
        }),
    ).rejects.toThrow(PermissionDeniedError);
});

test("successfully uploads when bot has no previous avatar", async () => {
    const bot = await TestBot.create(context, {
        name: "Test Bot",
        webhookUrl: "https://example.com/webhook",
    });

    const space = await TestSpace.create(context);
    const session = await space.createSession({role: "Owner", hasInternalAccess: true});

    // Verify bot has no avatar initially
    const botBeforeUpload = await getBotWithAvatar(context, bot.id);
    expect(botBeforeUpload.avatar).toBeNull();

    const avatarId = generateChronologicalId<AvatarId>();
    const avatarContent = new TextEncoder().encode("test-avatar-content");

    await finishUploadingBotAvatar(session.action(), {
        botId: bot.id,
        avatarContent,
        avatarId,
    });

    const botAfterAvatarUpload = await getBotWithAvatar(context, bot.id);
    expect(botAfterAvatarUpload).toEqual({
        ...botBeforeUpload,
        avatar: expect.objectContaining({
            avatarId,
            version: 1,
        }),
    });
});
