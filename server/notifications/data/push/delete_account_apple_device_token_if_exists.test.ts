import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {deleteAccountAppleDeviceTokenIfExists} from "~/server/notifications/data/push/delete_account_apple_device_token_if_exists.js";
import {getRegisteredAppleDevicesForAccount} from "~/server/notifications/data/push/get_registered_apple_devices_for_account.js";
import {registerOurAccountAppleDeviceToken} from "~/server/notifications/data/push/register_our_account_apple_device_token.js";
import {spacesInjection} from "~/server/spaces/spaces_injection.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {PermissionDeniedError, UnauthenticatedError} from "~/shared/error/error.js";
import {compareArrays} from "~/shared/helpers/array/compare_arrays.js";
import {createArrayWithLength} from "~/shared/helpers/array/create_array_with_length.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {randomInteger} from "~/shared/helpers/number/random_integer.js";

const context = createTestContext({
    spacesInjection,
});

test("can delete an account’s registered apple devices", async () => {
    const space = await TestSpace.create(context);

    const [session1, session2] = await runAllPromises([
        space.createSession(),
        space.createSession(),
    ]);

    const deviceToken1A = new Uint8Array(createArrayWithLength(32, () => randomInteger(0, 255)));
    const deviceToken1B = new Uint8Array(createArrayWithLength(32, () => randomInteger(0, 255)));
    const deviceToken1C = new Uint8Array(createArrayWithLength(32, () => randomInteger(0, 255)));
    const deviceToken1D = new Uint8Array(createArrayWithLength(32, () => randomInteger(0, 255)));

    expect(deviceToken1A).toEqual(deviceToken1A);
    expect(deviceToken1A).not.toEqual(deviceToken1B);
    expect(deviceToken1A).not.toEqual(deviceToken1C);
    expect(deviceToken1A).not.toEqual(deviceToken1D);

    await registerOurAccountAppleDeviceToken(session1.action(), deviceToken1A);
    await registerOurAccountAppleDeviceToken(session1.action(), deviceToken1B);
    await registerOurAccountAppleDeviceToken(session1.action(), deviceToken1C);
    await registerOurAccountAppleDeviceToken(session1.action(), deviceToken1D);

    await expect(
        getRegisteredAppleDevicesForAccount(space.systemAction(), session1.account.id).then(
            devices =>
                Array.from(devices).sort((a, b) =>
                    compareArrays(
                        Array.from(a.deviceToken),
                        Array.from(b.deviceToken),
                        (a, b) => a - b,
                    ),
                ),
        ),
    ).resolves.toEqual(
        [
            {type: "Apple", deviceToken: deviceToken1A},
            {type: "Apple", deviceToken: deviceToken1B},
            {type: "Apple", deviceToken: deviceToken1C},
            {type: "Apple", deviceToken: deviceToken1D},
        ].sort((a, b) =>
            compareArrays(Array.from(a.deviceToken), Array.from(b.deviceToken), (a, b) => a - b),
        ),
    );

    await expect(
        deleteAccountAppleDeviceTokenIfExists(session2.action(), {
            accountId: session1.account.id,
            deviceToken: deviceToken1A,
        }),
    ).rejects.toThrow(PermissionDeniedError);

    await expect(
        deleteAccountAppleDeviceTokenIfExists(context.anonymousAction(), {
            accountId: session1.account.id,
            deviceToken: deviceToken1A,
        }),
    ).rejects.toThrow(UnauthenticatedError);

    await expect(
        deleteAccountAppleDeviceTokenIfExists(
            context.impersonatedAccountAction(space.id, session2.account.id),
            {
                accountId: session1.account.id,
                deviceToken: deviceToken1A,
            },
        ),
    ).rejects.toThrow(PermissionDeniedError);

    await expect(
        getRegisteredAppleDevicesForAccount(space.systemAction(), session1.account.id).then(
            devices =>
                Array.from(devices).sort((a, b) =>
                    compareArrays(
                        Array.from(a.deviceToken),
                        Array.from(b.deviceToken),
                        (a, b) => a - b,
                    ),
                ),
        ),
    ).resolves.toEqual(
        [
            {type: "Apple", deviceToken: deviceToken1A},
            {type: "Apple", deviceToken: deviceToken1B},
            {type: "Apple", deviceToken: deviceToken1C},
            {type: "Apple", deviceToken: deviceToken1D},
        ].sort((a, b) =>
            compareArrays(Array.from(a.deviceToken), Array.from(b.deviceToken), (a, b) => a - b),
        ),
    );

    await deleteAccountAppleDeviceTokenIfExists(space.systemAction(), {
        accountId: session1.account.id,

        deviceToken: deviceToken1A,
    });

    await expect(
        getRegisteredAppleDevicesForAccount(space.systemAction(), session1.account.id).then(
            devices =>
                Array.from(devices).sort((a, b) =>
                    compareArrays(
                        Array.from(a.deviceToken),
                        Array.from(b.deviceToken),
                        (a, b) => a - b,
                    ),
                ),
        ),
    ).resolves.toEqual(
        [
            {type: "Apple", deviceToken: deviceToken1B},
            {type: "Apple", deviceToken: deviceToken1C},
            {type: "Apple", deviceToken: deviceToken1D},
        ].sort((a, b) =>
            compareArrays(Array.from(a.deviceToken), Array.from(b.deviceToken), (a, b) => a - b),
        ),
    );

    // Run twice to test idempotence.
    await deleteAccountAppleDeviceTokenIfExists(space.systemAction(), {
        accountId: session1.account.id,

        deviceToken: deviceToken1A,
    });

    await expect(
        getRegisteredAppleDevicesForAccount(space.systemAction(), session1.account.id).then(
            devices =>
                Array.from(devices).sort((a, b) =>
                    compareArrays(
                        Array.from(a.deviceToken),
                        Array.from(b.deviceToken),
                        (a, b) => a - b,
                    ),
                ),
        ),
    ).resolves.toEqual(
        [
            {type: "Apple", deviceToken: deviceToken1B},
            {type: "Apple", deviceToken: deviceToken1C},
            {type: "Apple", deviceToken: deviceToken1D},
        ].sort((a, b) =>
            compareArrays(Array.from(a.deviceToken), Array.from(b.deviceToken), (a, b) => a - b),
        ),
    );

    await deleteAccountAppleDeviceTokenIfExists(session1.action(), {
        accountId: session1.account.id,
        deviceToken: deviceToken1B,
    });

    await expect(
        getRegisteredAppleDevicesForAccount(space.systemAction(), session1.account.id).then(
            devices =>
                Array.from(devices).sort((a, b) =>
                    compareArrays(
                        Array.from(a.deviceToken),
                        Array.from(b.deviceToken),
                        (a, b) => a - b,
                    ),
                ),
        ),
    ).resolves.toEqual(
        [
            {type: "Apple", deviceToken: deviceToken1C},
            {type: "Apple", deviceToken: deviceToken1D},
        ].sort((a, b) =>
            compareArrays(Array.from(a.deviceToken), Array.from(b.deviceToken), (a, b) => a - b),
        ),
    );

    await deleteAccountAppleDeviceTokenIfExists(
        context.impersonatedAccountAction(space.id, session1.account.id),
        {
            accountId: session1.account.id,

            deviceToken: deviceToken1C,
        },
    );

    await expect(
        getRegisteredAppleDevicesForAccount(space.systemAction(), session1.account.id).then(
            devices =>
                Array.from(devices).sort((a, b) =>
                    compareArrays(
                        Array.from(a.deviceToken),
                        Array.from(b.deviceToken),
                        (a, b) => a - b,
                    ),
                ),
        ),
    ).resolves.toEqual(
        [{type: "Apple", deviceToken: deviceToken1D}].sort((a, b) =>
            compareArrays(Array.from(a.deviceToken), Array.from(b.deviceToken), (a, b) => a - b),
        ),
    );
});
