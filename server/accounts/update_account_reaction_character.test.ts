import {updateAccountReactionCharacter} from "~/server/accounts/update_account_reaction_character.js";
import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {TestAccount} from "~/server/spaces/test_helpers/test_account.js";
import {TestSession} from "~/server/spaces/test_helpers/test_session.js";

const context = createTestContext();

test("can update the reaction character for the account", async () => {
    const account = await TestAccount.create(context);
    const session = await TestSession.create(account);

    expect((await account.get()).initialData.reactionCharacter).toEqual(expect.any(Object));

    await updateAccountReactionCharacter(session.action(), {type: "Cat", variant: "Pink"});

    expect((await account.get()).initialData.reactionCharacter).toEqual({
        type: "Cat",
        variant: "Pink",
    });

    await updateAccountReactionCharacter(session.action(), {type: "Tree", variant: "Green"});

    expect((await account.get()).initialData.reactionCharacter).toEqual({
        type: "Tree",
        variant: "Green",
    });
});
