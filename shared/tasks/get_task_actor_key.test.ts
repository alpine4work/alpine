import {generateId} from "~/shared/id/id.open_source.js";
import {AccountId} from "~/shared/id/types/id_types.open_source.js";
import {getTaskActorKey} from "~/shared/tasks/get_task_actor_key.js";

test("task actor keys distinguish system, direct, and bot identities", () => {
    const accountId = generateId<AccountId>();
    const botAccountId1 = generateId<AccountId>();
    const botAccountId2 = generateId<AccountId>();

    expect([
        getTaskActorKey(null),
        getTaskActorKey({accountId, from: null}),
        getTaskActorKey({
            accountId,
            from: {type: "Bot", accountId: botAccountId1},
        }),
        getTaskActorKey({
            accountId,
            from: {type: "Bot", accountId: botAccountId2},
        }),
    ]).toEqual([
        "System",
        `Account:${accountId}`,
        `Bot:${accountId}:${botAccountId1}`,
        `Bot:${accountId}:${botAccountId2}`,
    ]);
});
