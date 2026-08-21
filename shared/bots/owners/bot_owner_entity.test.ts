import {
    botOwnerEntityIdForAccount,
    botOwnerEntityIdForSystem,
    isBotOwnerEntityKey,
    parseBotOwnerEntityId,
} from "~/shared/bots/owners/bot_owner_entity.js";
import {generateId} from "~/shared/id/id.open_source.js";
import {AccountId} from "~/shared/id/types/id_types.open_source.js";

test("recognizes a system owner entity key", () => {
    expect(isBotOwnerEntityKey(botOwnerEntityIdForSystem())).toBe(true);
});

test("rejects a system key that carries an entity id", () => {
    expect(isBotOwnerEntityKey(`System:${generateId()}`)).toBe(false);
});

test("parses a system owner entity into its union form", () => {
    expect(parseBotOwnerEntityId(botOwnerEntityIdForSystem())).toEqual({type: "System"});
});

test("parses an account owner entity into its union form", () => {
    const accountId = generateId<AccountId>();
    expect(parseBotOwnerEntityId(botOwnerEntityIdForAccount(accountId))).toEqual({
        type: "Account",
        accountId,
    });
});
