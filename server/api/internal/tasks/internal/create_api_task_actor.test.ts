import {createApiTaskActor} from "~/server/api/internal/tasks/internal/create_api_task_actor.js";
import {generateId} from "~/shared/id/id.js";
import {AccountId} from "~/shared/id/types/id_types.js";

test("omits from when the effective actor is the bot", () => {
    const botAccountId = generateId<AccountId>();

    expect(createApiTaskActor({actorId: undefined, botAccountId})).toEqual({
        accountId: botAccountId,
        from: null,
    });
});

test("includes from when the bot acts as a different actor", () => {
    const actorId = generateId<AccountId>();
    const botAccountId = generateId<AccountId>();

    expect(createApiTaskActor({actorId, botAccountId})).toEqual({
        accountId: actorId,
        from: {type: "Bot", accountId: botAccountId},
    });
});
