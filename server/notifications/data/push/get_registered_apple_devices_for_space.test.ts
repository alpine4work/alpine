import {createTestContext} from "~/server/dynamo/test_helpers/create_test_context.js";
import {getRegisteredAppleDevicesForAccount} from "~/server/notifications/data/push/get_registered_apple_devices_for_account.js";
import {registerOurAccountAppleDeviceToken} from "~/server/notifications/data/push/register_our_account_apple_device_token.js";
import {spacesInjection} from "~/server/spaces/spaces_injection.js";
import {TestSpace} from "~/server/spaces/test_helpers/test_space.js";
import {PermissionDeniedError, UnauthenticatedError} from "~/shared/error/error.open_source.js";
import {compareArrays} from "~/shared/helpers/array/compare_arrays.js";
import {createArrayWithLength} from "~/shared/helpers/array/create_array_with_length.open_source.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.open_source.js";
import {randomInteger} from "~/shared/helpers/number/random_integer.js";

const context = createTestContext({
    spacesInjection,
});

test("can get an account\u2019s registered apple devices", async () => {
    const [space1, space2] = await runAllPromises([
        TestSpace.create(context),
        TestSpace.create(context),
    ]);

    const [session1A, session1B, session2A, sharedSession] = await runAllPromises([
        space1.createSession(),
        space1.createSession(),
        space2.createSession(),
        space1.createSession(),
    ]);

    await space2.addAccount(sharedSession.account);

    await expect(
        getRegisteredAppleDevicesForAccount(session1A.action(), session1A.account.id),
    ).resolves.toEqual([]);

    await expect(
        getRegisteredAppleDevicesForAccount(session1B.action(), session1A.account.id),
    ).rejects.toThrow(PermissionDeniedError);

    await expect(
        getRegisteredAppleDevicesForAccount(session2A.action(), session1A.account.id),
    ).rejects.toThrow(PermissionDeniedError);

    await expect(
        getRegisteredAppleDevicesForAccount(sharedSession.action(), session1A.account.id),
    ).rejects.toThrow(PermissionDeniedError);

    await expect(
        getRegisteredAppleDevicesForAccount(space1.systemAction(), session1A.account.id),
    ).resolves.toEqual([]);

    await expect(
        getRegisteredAppleDevicesForAccount(space2.systemAction(), session1A.account.id),
    ).rejects.toThrow(PermissionDeniedError);

    await expect(
        getRegisteredAppleDevicesForAccount(context.anonymousAction(), session1A.account.id),
    ).rejects.toThrow(UnauthenticatedError);

    await expect(
        getRegisteredAppleDevicesForAccount(session1B.action(), session1B.account.id),
    ).resolves.toEqual([]);

    await expect(
        getRegisteredAppleDevicesForAccount(session1A.action(), session1B.account.id),
    ).rejects.toThrow(PermissionDeniedError);

    await expect(
        getRegisteredAppleDevicesForAccount(session2A.action(), session1B.account.id),
    ).rejects.toThrow(PermissionDeniedError);

    await expect(
        getRegisteredAppleDevicesForAccount(sharedSession.action(), session1B.account.id),
    ).rejects.toThrow(PermissionDeniedError);

    await expect(
        getRegisteredAppleDevicesForAccount(space1.systemAction(), session1B.account.id),
    ).resolves.toEqual([]);

    await expect(
        getRegisteredAppleDevicesForAccount(space2.systemAction(), session1B.account.id),
    ).rejects.toThrow(PermissionDeniedError);

    await expect(
        getRegisteredAppleDevicesForAccount(context.anonymousAction(), session1B.account.id),
    ).rejects.toThrow(UnauthenticatedError);

    await expect(
        getRegisteredAppleDevicesForAccount(sharedSession.action(), sharedSession.account.id),
    ).resolves.toEqual([]);

    await expect(
        getRegisteredAppleDevicesForAccount(session1A.action(), sharedSession.account.id),
    ).rejects.toThrow(PermissionDeniedError);

    await expect(
        getRegisteredAppleDevicesForAccount(session1B.action(), sharedSession.account.id),
    ).rejects.toThrow(PermissionDeniedError);

    await expect(
        getRegisteredAppleDevicesForAccount(session2A.action(), sharedSession.account.id),
    ).rejects.toThrow(PermissionDeniedError);

    await expect(
        getRegisteredAppleDevicesForAccount(space1.systemAction(), sharedSession.account.id),
    ).resolves.toEqual([]);

    await expect(
        getRegisteredAppleDevicesForAccount(space2.systemAction(), sharedSession.account.id),
    ).resolves.toEqual([]);

    await expect(
        getRegisteredAppleDevicesForAccount(context.anonymousAction(), sharedSession.account.id),
    ).rejects.toThrow(UnauthenticatedError);

    const deviceToken1A = new Uint8Array(createArrayWithLength(32, () => randomInteger(0, 255)));
    const deviceToken1B1 = new Uint8Array(createArrayWithLength(32, () => randomInteger(0, 255)));
    const deviceToken1B2 = new Uint8Array(createArrayWithLength(32, () => randomInteger(0, 255)));
    const deviceToken1B3 = new Uint8Array(createArrayWithLength(32, () => randomInteger(0, 255)));
    const sharedDeviceToken = new Uint8Array(
        createArrayWithLength(32, () => randomInteger(0, 255)),
    );

    expect(deviceToken1A).toEqual(deviceToken1A);
    expect(deviceToken1A).not.toEqual(deviceToken1B1);
    expect(deviceToken1A).not.toEqual(sharedDeviceToken);
    expect(deviceToken1B1).not.toEqual(deviceToken1B2);

    // Run twice intentionally to test idempotence.
    await registerOurAccountAppleDeviceToken(session1A.action(), deviceToken1A);
    await registerOurAccountAppleDeviceToken(session1A.action(), deviceToken1A);

    await registerOurAccountAppleDeviceToken(session1B.action(), deviceToken1B1);
    await registerOurAccountAppleDeviceToken(session1B.action(), deviceToken1B2);
    await registerOurAccountAppleDeviceToken(session1B.action(), deviceToken1B3);

    await registerOurAccountAppleDeviceToken(sharedSession.action(), sharedDeviceToken);

    await expect(
        getRegisteredAppleDevicesForAccount(session1A.action(), session1A.account.id),
    ).resolves.toEqual([{type: "AppleDevice", deviceToken: deviceToken1A}]);

    await expect(
        getRegisteredAppleDevicesForAccount(session1B.action(), session1A.account.id),
    ).rejects.toThrow(PermissionDeniedError);

    await expect(
        getRegisteredAppleDevicesForAccount(session2A.action(), session1A.account.id),
    ).rejects.toThrow(PermissionDeniedError);

    await expect(
        getRegisteredAppleDevicesForAccount(sharedSession.action(), session1A.account.id),
    ).rejects.toThrow(PermissionDeniedError);

    await expect(
        getRegisteredAppleDevicesForAccount(space1.systemAction(), session1A.account.id),
    ).resolves.toEqual([{type: "AppleDevice", deviceToken: deviceToken1A}]);

    await expect(
        getRegisteredAppleDevicesForAccount(space2.systemAction(), session1A.account.id),
    ).rejects.toThrow(PermissionDeniedError);

    await expect(
        getRegisteredAppleDevicesForAccount(context.anonymousAction(), session1A.account.id),
    ).rejects.toThrow(UnauthenticatedError);

    await expect(
        getRegisteredAppleDevicesForAccount(session1B.action(), session1B.account.id).then(
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
            {type: "AppleDevice", deviceToken: deviceToken1B1},
            {type: "AppleDevice", deviceToken: deviceToken1B2},
            {type: "AppleDevice", deviceToken: deviceToken1B3},
        ].sort((a, b) =>
            compareArrays(Array.from(a.deviceToken), Array.from(b.deviceToken), (a, b) => a - b),
        ),
    );

    await expect(
        getRegisteredAppleDevicesForAccount(session1A.action(), session1B.account.id),
    ).rejects.toThrow(PermissionDeniedError);

    await expect(
        getRegisteredAppleDevicesForAccount(session2A.action(), session1B.account.id),
    ).rejects.toThrow(PermissionDeniedError);

    await expect(
        getRegisteredAppleDevicesForAccount(sharedSession.action(), session1B.account.id),
    ).rejects.toThrow(PermissionDeniedError);

    await expect(
        getRegisteredAppleDevicesForAccount(space1.systemAction(), session1B.account.id).then(
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
            {type: "AppleDevice", deviceToken: deviceToken1B1},
            {type: "AppleDevice", deviceToken: deviceToken1B2},
            {type: "AppleDevice", deviceToken: deviceToken1B3},
        ].sort((a, b) =>
            compareArrays(Array.from(a.deviceToken), Array.from(b.deviceToken), (a, b) => a - b),
        ),
    );

    await expect(
        getRegisteredAppleDevicesForAccount(space2.systemAction(), session1B.account.id),
    ).rejects.toThrow(PermissionDeniedError);

    await expect(
        getRegisteredAppleDevicesForAccount(context.anonymousAction(), session1B.account.id),
    ).rejects.toThrow(UnauthenticatedError);

    await expect(
        getRegisteredAppleDevicesForAccount(sharedSession.action(), sharedSession.account.id),
    ).resolves.toEqual([{type: "AppleDevice", deviceToken: sharedDeviceToken}]);

    await expect(
        getRegisteredAppleDevicesForAccount(session1A.action(), sharedSession.account.id),
    ).rejects.toThrow(PermissionDeniedError);

    await expect(
        getRegisteredAppleDevicesForAccount(session1B.action(), sharedSession.account.id),
    ).rejects.toThrow(PermissionDeniedError);

    await expect(
        getRegisteredAppleDevicesForAccount(session2A.action(), sharedSession.account.id),
    ).rejects.toThrow(PermissionDeniedError);

    await expect(
        getRegisteredAppleDevicesForAccount(space1.systemAction(), sharedSession.account.id),
    ).resolves.toEqual([{type: "AppleDevice", deviceToken: sharedDeviceToken}]);

    await expect(
        getRegisteredAppleDevicesForAccount(space2.systemAction(), sharedSession.account.id),
    ).resolves.toEqual([{type: "AppleDevice", deviceToken: sharedDeviceToken}]);

    await expect(
        getRegisteredAppleDevicesForAccount(context.anonymousAction(), sharedSession.account.id),
    ).rejects.toThrow(UnauthenticatedError);
});
