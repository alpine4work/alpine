import {requestAlphaAccess} from "~/server/dynamo/alpha_access_table";
import {FailedPreconditionError} from "~/shared/error/error";
import {generateId} from "~/shared/id/id";

test("can not request alpha access twice", async () => {
    const id = generateId();

    await requestAlphaAccess({
        name: "Test",
        emailAddress: `test.${id}@test.cyberworlds.dev`,
        message: "Hello, world!",
    });

    await expect(async () => {
        await requestAlphaAccess({
            name: "Test 2",
            emailAddress: `test.${id}@test.cyberworlds.dev`,
            message: "Hello, world!",
        });
    }).rejects.toThrowError(FailedPreconditionError);
});

test('can not request alpha twice with "+" extension email trick', async () => {
    const id = generateId();

    await requestAlphaAccess({
        name: "Test",
        emailAddress: `test.${id}@test.cyberworlds.dev`,
        message: "Hello, world!",
    });

    await requestAlphaAccess({
        name: "Test 2",
        emailAddress: `test.${id}+2@test.cyberworlds.dev`,
        message: "Hello, world!",
    });
});
