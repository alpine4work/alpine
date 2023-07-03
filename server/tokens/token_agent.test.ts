import {generateKeyPair} from "crypto";
import {AppServiceTokenAgent, EdgeServiceFamilyTokenAgent} from "~/server/tokens/token_agent.js";
import {PermissionDeniedError} from "~/shared/error/error.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {generateId} from "~/shared/id/id.js";
import {AccountId, SessionId} from "~/shared/id/types/id_types.js";

let appServiceTokenAgent: AppServiceTokenAgent;
let edgeServiceTokenAgent: EdgeServiceFamilyTokenAgent;
let documentCollaborationServiceTokenAgent: EdgeServiceFamilyTokenAgent;

beforeAll(async () => {
    const [appServiceKeyPair, edgeServiceFamilyKeyPair] = await runAllPromises([
        new Promise<{publicKey: string; privateKey: string}>((resolve, reject) =>
            generateKeyPair(
                "rsa",
                {
                    // IMPORTANT: 2048 bit length is not secure enough for production! Ok for tests.
                    modulusLength: 2048,
                    publicKeyEncoding: {type: "spki", format: "pem"},
                    privateKeyEncoding: {type: "pkcs8", format: "pem"},
                },
                (error, publicKey, privateKey) => {
                    if (error) reject(error);
                    else resolve({publicKey, privateKey});
                },
            ),
        ),
        new Promise<{publicKey: string; privateKey: string}>((resolve, reject) =>
            generateKeyPair(
                "rsa",
                {
                    // IMPORTANT: 2048 bit length is not secure enough for production! Ok for tests.
                    modulusLength: 2048,
                    publicKeyEncoding: {type: "spki", format: "pem"},
                    privateKeyEncoding: {type: "pkcs8", format: "pem"},
                },
                (error, publicKey, privateKey) => {
                    if (error) reject(error);
                    else resolve({publicKey, privateKey});
                },
            ),
        ),
    ]);

    [appServiceTokenAgent, edgeServiceTokenAgent, documentCollaborationServiceTokenAgent] =
        await runAllPromises([
            AppServiceTokenAgent.new({
                appServicePublicKey: appServiceKeyPair.publicKey,
                edgeServiceFamilyPublicKey: edgeServiceFamilyKeyPair.publicKey,
                appServicePrivateKey: appServiceKeyPair.privateKey,
            }),
            EdgeServiceFamilyTokenAgent.new({
                serviceName: "EdgeService",
                appServicePublicKey: appServiceKeyPair.publicKey,
                edgeServiceFamilyPublicKey: edgeServiceFamilyKeyPair.publicKey,
                edgeServiceFamilyPrivateKey: edgeServiceFamilyKeyPair.privateKey,
            }),
            EdgeServiceFamilyTokenAgent.new({
                serviceName: "DocumentCollaborationService",
                appServicePublicKey: appServiceKeyPair.publicKey,
                edgeServiceFamilyPublicKey: edgeServiceFamilyKeyPair.publicKey,
                edgeServiceFamilyPrivateKey: edgeServiceFamilyKeyPair.privateKey,
            }),
        ]);
});

test("app service can sign short lived tokens for app service", async () => {
    const sessionId = generateId<SessionId>();
    const accountId = generateId<AccountId>();

    const token = await appServiceTokenAgent.dangerouslySignShortLivedToken("AppService", {
        type: "Session",
        sessionId,
        accountId,
    });

    expect(await appServiceTokenAgent.verifyToken(token)).toEqual({
        issuer: "AppService",
        payload: {
            type: "Session",
            sessionId,
            accountId,
        },
    });

    expect(await appServiceTokenAgent.verifyTokenFromService("AppService", token)).toEqual({
        type: "Session",
        sessionId,
        accountId,
    });

    await expect(appServiceTokenAgent.verifyTokenFromService("EdgeService", token)).rejects.toThrow(
        PermissionDeniedError,
    );

    await expect(edgeServiceTokenAgent.verifyToken(token)).rejects.toThrow(PermissionDeniedError);
    await expect(edgeServiceTokenAgent.verifyTokenFromService("AppService", token)).rejects.toThrow(
        PermissionDeniedError,
    );
    await expect(
        edgeServiceTokenAgent.verifyTokenFromService("EdgeService", token),
    ).rejects.toThrow(PermissionDeniedError);

    await expect(documentCollaborationServiceTokenAgent.verifyToken(token)).rejects.toThrow(
        PermissionDeniedError,
    );
    await expect(
        documentCollaborationServiceTokenAgent.verifyTokenFromService("AppService", token),
    ).rejects.toThrow(PermissionDeniedError);
    await expect(
        documentCollaborationServiceTokenAgent.verifyTokenFromService("EdgeService", token),
    ).rejects.toThrow(PermissionDeniedError);
});

test("edge service can sign short lived tokens for edge service", async () => {
    const sessionId = generateId<SessionId>();
    const accountId = generateId<AccountId>();

    const token = await edgeServiceTokenAgent.dangerouslySignShortLivedToken("EdgeService", {
        type: "Session",
        sessionId,
        accountId,
    });

    expect(await edgeServiceTokenAgent.verifyToken(token)).toEqual({
        issuer: "EdgeService",
        payload: {
            type: "Session",
            sessionId,
            accountId,
        },
    });

    expect(await edgeServiceTokenAgent.verifyTokenFromService("EdgeService", token)).toEqual({
        type: "Session",
        sessionId,
        accountId,
    });

    await expect(edgeServiceTokenAgent.verifyTokenFromService("AppService", token)).rejects.toThrow(
        PermissionDeniedError,
    );

    await expect(appServiceTokenAgent.verifyToken(token)).rejects.toThrow(PermissionDeniedError);
    await expect(appServiceTokenAgent.verifyTokenFromService("AppService", token)).rejects.toThrow(
        PermissionDeniedError,
    );
    await expect(appServiceTokenAgent.verifyTokenFromService("EdgeService", token)).rejects.toThrow(
        PermissionDeniedError,
    );

    await expect(documentCollaborationServiceTokenAgent.verifyToken(token)).rejects.toThrow(
        PermissionDeniedError,
    );
    await expect(
        documentCollaborationServiceTokenAgent.verifyTokenFromService("AppService", token),
    ).rejects.toThrow(PermissionDeniedError);
    await expect(
        documentCollaborationServiceTokenAgent.verifyTokenFromService("EdgeService", token),
    ).rejects.toThrow(PermissionDeniedError);
});

test("document collaboration service can sign short lived tokens for app service", async () => {
    const sessionId = generateId<SessionId>();
    const accountId = generateId<AccountId>();

    const token = await documentCollaborationServiceTokenAgent.dangerouslySignShortLivedToken(
        "AppService",
        {
            type: "Session",
            sessionId,
            accountId,
        },
    );

    expect(await appServiceTokenAgent.verifyToken(token)).toEqual({
        issuer: "DocumentCollaborationService",
        payload: {
            type: "Session",
            sessionId,
            accountId,
        },
    });

    expect(
        await appServiceTokenAgent.verifyTokenFromService("DocumentCollaborationService", token),
    ).toEqual({
        type: "Session",
        sessionId,
        accountId,
    });

    await expect(appServiceTokenAgent.verifyTokenFromService("AppService", token)).rejects.toThrow(
        PermissionDeniedError,
    );

    await expect(edgeServiceTokenAgent.verifyToken(token)).rejects.toThrow(PermissionDeniedError);
    await expect(edgeServiceTokenAgent.verifyTokenFromService("AppService", token)).rejects.toThrow(
        PermissionDeniedError,
    );
    await expect(
        edgeServiceTokenAgent.verifyTokenFromService("EdgeService", token),
    ).rejects.toThrow(PermissionDeniedError);

    await expect(documentCollaborationServiceTokenAgent.verifyToken(token)).rejects.toThrow(
        PermissionDeniedError,
    );
    await expect(
        documentCollaborationServiceTokenAgent.verifyTokenFromService("AppService", token),
    ).rejects.toThrow(PermissionDeniedError);
    await expect(
        documentCollaborationServiceTokenAgent.verifyTokenFromService("EdgeService", token),
    ).rejects.toThrow(PermissionDeniedError);
});

test("app service can sign short lived tokens for app service and edge service", async () => {
    const sessionId = generateId<SessionId>();
    const accountId = generateId<AccountId>();

    const token = await appServiceTokenAgent.dangerouslySignShortLivedToken(
        ["AppService", "EdgeService"],
        {
            type: "Session",
            sessionId,
            accountId,
        },
    );

    expect(await appServiceTokenAgent.verifyToken(token)).toEqual({
        issuer: "AppService",
        payload: {
            type: "Session",
            sessionId,
            accountId,
        },
    });

    expect(await appServiceTokenAgent.verifyTokenFromService("AppService", token)).toEqual({
        type: "Session",
        sessionId,
        accountId,
    });

    await expect(appServiceTokenAgent.verifyTokenFromService("EdgeService", token)).rejects.toThrow(
        PermissionDeniedError,
    );

    expect(await edgeServiceTokenAgent.verifyToken(token)).toEqual({
        issuer: "AppService",
        payload: {
            type: "Session",
            sessionId,
            accountId,
        },
    });

    expect(await edgeServiceTokenAgent.verifyTokenFromService("AppService", token)).toEqual({
        type: "Session",
        sessionId,
        accountId,
    });

    await expect(
        edgeServiceTokenAgent.verifyTokenFromService("EdgeService", token),
    ).rejects.toThrow(PermissionDeniedError);

    await expect(documentCollaborationServiceTokenAgent.verifyToken(token)).rejects.toThrow(
        PermissionDeniedError,
    );
    await expect(
        documentCollaborationServiceTokenAgent.verifyTokenFromService("AppService", token),
    ).rejects.toThrow(PermissionDeniedError);
    await expect(
        documentCollaborationServiceTokenAgent.verifyTokenFromService("EdgeService", token),
    ).rejects.toThrow(PermissionDeniedError);
});

test("edge service can sign short lived tokens for app service and edge service", async () => {
    const sessionId = generateId<SessionId>();
    const accountId = generateId<AccountId>();

    const token = await edgeServiceTokenAgent.dangerouslySignShortLivedToken(
        ["AppService", "EdgeService"],
        {
            type: "Session",
            sessionId,
            accountId,
        },
    );

    expect(await appServiceTokenAgent.verifyToken(token)).toEqual({
        issuer: "EdgeService",
        payload: {
            type: "Session",
            sessionId,
            accountId,
        },
    });

    expect(await appServiceTokenAgent.verifyTokenFromService("EdgeService", token)).toEqual({
        type: "Session",
        sessionId,
        accountId,
    });

    await expect(appServiceTokenAgent.verifyTokenFromService("AppService", token)).rejects.toThrow(
        PermissionDeniedError,
    );

    expect(await edgeServiceTokenAgent.verifyToken(token)).toEqual({
        issuer: "EdgeService",
        payload: {
            type: "Session",
            sessionId,
            accountId,
        },
    });

    expect(await edgeServiceTokenAgent.verifyTokenFromService("EdgeService", token)).toEqual({
        type: "Session",
        sessionId,
        accountId,
    });

    await expect(edgeServiceTokenAgent.verifyTokenFromService("AppService", token)).rejects.toThrow(
        PermissionDeniedError,
    );

    await expect(documentCollaborationServiceTokenAgent.verifyToken(token)).rejects.toThrow(
        PermissionDeniedError,
    );
    await expect(
        documentCollaborationServiceTokenAgent.verifyTokenFromService("AppService", token),
    ).rejects.toThrow(PermissionDeniedError);
    await expect(
        documentCollaborationServiceTokenAgent.verifyTokenFromService("EdgeService", token),
    ).rejects.toThrow(PermissionDeniedError);
});

test("app service can sign eternal tokens for app service and edge service", async () => {
    const sessionId = generateId<SessionId>();
    const accountId = generateId<AccountId>();

    const token = await appServiceTokenAgent.dangerouslySignEternalSessionToken({
        type: "Session",
        sessionId,
        accountId,
    });

    expect(await appServiceTokenAgent.verifyToken(token)).toEqual({
        issuer: "AppService",
        payload: {
            type: "Session",
            sessionId,
            accountId,
        },
    });

    expect(await appServiceTokenAgent.verifyTokenFromService("AppService", token)).toEqual({
        type: "Session",
        sessionId,
        accountId,
    });

    await expect(appServiceTokenAgent.verifyTokenFromService("EdgeService", token)).rejects.toThrow(
        PermissionDeniedError,
    );

    expect(await edgeServiceTokenAgent.verifyToken(token)).toEqual({
        issuer: "AppService",
        payload: {
            type: "Session",
            sessionId,
            accountId,
        },
    });

    expect(await edgeServiceTokenAgent.verifyTokenFromService("AppService", token)).toEqual({
        type: "Session",
        sessionId,
        accountId,
    });

    await expect(
        edgeServiceTokenAgent.verifyTokenFromService("EdgeService", token),
    ).rejects.toThrow(PermissionDeniedError);

    await expect(documentCollaborationServiceTokenAgent.verifyToken(token)).rejects.toThrow(
        PermissionDeniedError,
    );
    await expect(
        documentCollaborationServiceTokenAgent.verifyTokenFromService("AppService", token),
    ).rejects.toThrow(PermissionDeniedError);
    await expect(
        documentCollaborationServiceTokenAgent.verifyTokenFromService("EdgeService", token),
    ).rejects.toThrow(PermissionDeniedError);
});

test("edge service can sign short lived tokens for edge service that actually expire", async () => {
    const sessionId = generateId<SessionId>();
    const accountId = generateId<AccountId>();

    const token = await edgeServiceTokenAgent.dangerouslySignShortLivedToken(
        "EdgeService",
        {
            type: "Session",
            sessionId,
            accountId,
        },
        {
            currentTimeForTest: new Date(Date.now() - 1000 * 60 * 5),
        },
    );

    await expect(appServiceTokenAgent.verifyToken(token)).rejects.toThrow(PermissionDeniedError);
    await expect(appServiceTokenAgent.verifyTokenFromService("AppService", token)).rejects.toThrow(
        PermissionDeniedError,
    );
    await expect(appServiceTokenAgent.verifyTokenFromService("EdgeService", token)).rejects.toThrow(
        PermissionDeniedError,
    );

    await expect(edgeServiceTokenAgent.verifyToken(token)).rejects.toThrow(PermissionDeniedError);
    await expect(edgeServiceTokenAgent.verifyTokenFromService("AppService", token)).rejects.toThrow(
        PermissionDeniedError,
    );
    await expect(
        edgeServiceTokenAgent.verifyTokenFromService("EdgeService", token),
    ).rejects.toThrow(PermissionDeniedError);

    await expect(documentCollaborationServiceTokenAgent.verifyToken(token)).rejects.toThrow(
        PermissionDeniedError,
    );
    await expect(
        documentCollaborationServiceTokenAgent.verifyTokenFromService("AppService", token),
    ).rejects.toThrow(PermissionDeniedError);
    await expect(
        documentCollaborationServiceTokenAgent.verifyTokenFromService("EdgeService", token),
    ).rejects.toThrow(PermissionDeniedError);
});

test("app service can sign short lived tokens for app service and edge service that actually expire", async () => {
    const sessionId = generateId<SessionId>();
    const accountId = generateId<AccountId>();

    const token = await appServiceTokenAgent.dangerouslySignShortLivedToken(
        ["AppService", "EdgeService"],
        {
            type: "Session",
            sessionId,
            accountId,
        },
        {
            currentTimeForTest: new Date(Date.now() - 1000 * 60 * 5),
        },
    );

    await expect(appServiceTokenAgent.verifyToken(token)).rejects.toThrow(PermissionDeniedError);
    await expect(appServiceTokenAgent.verifyTokenFromService("AppService", token)).rejects.toThrow(
        PermissionDeniedError,
    );
    await expect(appServiceTokenAgent.verifyTokenFromService("EdgeService", token)).rejects.toThrow(
        PermissionDeniedError,
    );

    await expect(edgeServiceTokenAgent.verifyToken(token)).rejects.toThrow(PermissionDeniedError);
    await expect(edgeServiceTokenAgent.verifyTokenFromService("AppService", token)).rejects.toThrow(
        PermissionDeniedError,
    );
    await expect(
        edgeServiceTokenAgent.verifyTokenFromService("EdgeService", token),
    ).rejects.toThrow(PermissionDeniedError);

    await expect(documentCollaborationServiceTokenAgent.verifyToken(token)).rejects.toThrow(
        PermissionDeniedError,
    );
    await expect(
        documentCollaborationServiceTokenAgent.verifyTokenFromService("AppService", token),
    ).rejects.toThrow(PermissionDeniedError);
    await expect(
        documentCollaborationServiceTokenAgent.verifyTokenFromService("EdgeService", token),
    ).rejects.toThrow(PermissionDeniedError);
});

test("document collaboration service can sign short lived tokens for app service that actually expire", async () => {
    const sessionId = generateId<SessionId>();
    const accountId = generateId<AccountId>();

    const token = await documentCollaborationServiceTokenAgent.dangerouslySignShortLivedToken(
        "AppService",
        {
            type: "Session",
            sessionId,
            accountId,
        },
        {
            currentTimeForTest: new Date(Date.now() - 1000 * 60 * 5),
        },
    );

    await expect(appServiceTokenAgent.verifyToken(token)).rejects.toThrow(PermissionDeniedError);
    await expect(appServiceTokenAgent.verifyTokenFromService("AppService", token)).rejects.toThrow(
        PermissionDeniedError,
    );
    await expect(appServiceTokenAgent.verifyTokenFromService("EdgeService", token)).rejects.toThrow(
        PermissionDeniedError,
    );

    await expect(edgeServiceTokenAgent.verifyToken(token)).rejects.toThrow(PermissionDeniedError);
    await expect(edgeServiceTokenAgent.verifyTokenFromService("AppService", token)).rejects.toThrow(
        PermissionDeniedError,
    );
    await expect(
        edgeServiceTokenAgent.verifyTokenFromService("EdgeService", token),
    ).rejects.toThrow(PermissionDeniedError);

    await expect(documentCollaborationServiceTokenAgent.verifyToken(token)).rejects.toThrow(
        PermissionDeniedError,
    );
    await expect(
        documentCollaborationServiceTokenAgent.verifyTokenFromService("AppService", token),
    ).rejects.toThrow(PermissionDeniedError);
    await expect(
        documentCollaborationServiceTokenAgent.verifyTokenFromService("EdgeService", token),
    ).rejects.toThrow(PermissionDeniedError);
});
