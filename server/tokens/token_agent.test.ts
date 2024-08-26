import {generateKeyPair} from "crypto";
import {TokenAgent} from "~/server/tokens/token_agent.js";
import {
    AppServiceTokenAgentPrivateSide,
    TokenAgentPrivateSide,
} from "~/server/tokens/token_agent_private_side.js";
import {TokenAgentPublicSide} from "~/server/tokens/token_agent_public_side.js";
import {PermissionDeniedError} from "~/shared/error/error.js";
import {createArrayWithLength} from "~/shared/helpers/array/create_array_with_length.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {generateId} from "~/shared/id/id.js";
import {AccountId, SessionId} from "~/shared/id/types/id_types.js";

let appServiceTokenAgent: TokenAgent<AppServiceTokenAgentPrivateSide>;
let edgeServiceTokenAgent: TokenAgent;
let documentCollaborationServiceTokenAgent: TokenAgent;

beforeAll(async () => {
    const [
        appServiceKeyPair,
        edgeServiceFamilyKeyPair,
        taskRealtimeServiceKeyPair,
        jobQueueServiceKeyPair,
        fileUploadServiceKeyPair,
    ] = await runAllPromises(
        createArrayWithLength(
            5,
            () =>
                new Promise<{publicKey: string; privateKey: string}>((resolve, reject) =>
                    generateKeyPair(
                        "rsa",
                        {
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
        ),
    );

    assert(appServiceKeyPair);
    assert(edgeServiceFamilyKeyPair);
    assert(taskRealtimeServiceKeyPair);
    assert(jobQueueServiceKeyPair);
    assert(fileUploadServiceKeyPair);

    [appServiceTokenAgent, edgeServiceTokenAgent, documentCollaborationServiceTokenAgent] =
        await runAllPromises([
            runAllPromises([
                TokenAgentPublicSide.new({
                    serviceName: "AppService",
                    appServicePublicKey: appServiceKeyPair.publicKey,
                    edgeServiceFamilyPublicKey: edgeServiceFamilyKeyPair.publicKey,
                    taskRealtimeServicePublicKey: taskRealtimeServiceKeyPair.publicKey,
                    jobQueueServicePublicKey: jobQueueServiceKeyPair.publicKey,
                    fileUploadServicePublicKey: fileUploadServiceKeyPair.publicKey,
                }),
                AppServiceTokenAgentPrivateSide.new({
                    serviceName: "AppService",
                    servicePrivateKey: appServiceKeyPair.privateKey,
                }),
            ]).then(([publicSide, privateSide]) => ({publicSide, privateSide})),
            runAllPromises([
                TokenAgentPublicSide.new({
                    serviceName: "EdgeService",
                    appServicePublicKey: appServiceKeyPair.publicKey,
                    edgeServiceFamilyPublicKey: edgeServiceFamilyKeyPair.publicKey,
                    taskRealtimeServicePublicKey: taskRealtimeServiceKeyPair.publicKey,
                    jobQueueServicePublicKey: jobQueueServiceKeyPair.publicKey,
                    fileUploadServicePublicKey: fileUploadServiceKeyPair.publicKey,
                }),
                TokenAgentPrivateSide.new({
                    serviceName: "EdgeService",
                    servicePrivateKey: edgeServiceFamilyKeyPair.privateKey,
                }),
            ]).then(([publicSide, privateSide]) => ({publicSide, privateSide})),
            runAllPromises([
                TokenAgentPublicSide.new({
                    serviceName: "DocumentCollaborationService",
                    appServicePublicKey: appServiceKeyPair.publicKey,
                    edgeServiceFamilyPublicKey: edgeServiceFamilyKeyPair.publicKey,
                    taskRealtimeServicePublicKey: taskRealtimeServiceKeyPair.publicKey,
                    jobQueueServicePublicKey: jobQueueServiceKeyPair.publicKey,
                    fileUploadServicePublicKey: fileUploadServiceKeyPair.publicKey,
                }),
                TokenAgentPrivateSide.new({
                    serviceName: "DocumentCollaborationService",
                    servicePrivateKey: edgeServiceFamilyKeyPair.privateKey,
                }),
            ]).then(([publicSide, privateSide]) => ({publicSide, privateSide})),
        ]);
});

test("app service can sign short lived tokens for app service", async () => {
    const sessionId = generateId<SessionId>();
    const accountId = generateId<AccountId>();

    const token = await appServiceTokenAgent.privateSide.dangerouslySignShortLivedToken(
        "AppService",
        {
            type: "Session",
            sessionId,
            accountId,
        },
    );

    expect(await appServiceTokenAgent.publicSide.verifyToken(token)).toEqual({
        serviceName: "AppService",
        payload: {
            type: "Session",
            sessionId,
            accountId,
        },
    });

    expect(
        await appServiceTokenAgent.publicSide.verifyTokenFromService("AppService", token),
    ).toEqual({
        type: "Session",
        sessionId,
        accountId,
    });

    await expect(
        appServiceTokenAgent.publicSide.verifyTokenFromService("EdgeService", token),
    ).rejects.toThrow(PermissionDeniedError);

    await expect(edgeServiceTokenAgent.publicSide.verifyToken(token)).rejects.toThrow(
        PermissionDeniedError,
    );
    await expect(
        edgeServiceTokenAgent.publicSide.verifyTokenFromService("AppService", token),
    ).rejects.toThrow(PermissionDeniedError);
    await expect(
        edgeServiceTokenAgent.publicSide.verifyTokenFromService("EdgeService", token),
    ).rejects.toThrow(PermissionDeniedError);

    await expect(
        documentCollaborationServiceTokenAgent.publicSide.verifyToken(token),
    ).rejects.toThrow(PermissionDeniedError);
    await expect(
        documentCollaborationServiceTokenAgent.publicSide.verifyTokenFromService(
            "AppService",
            token,
        ),
    ).rejects.toThrow(PermissionDeniedError);
    await expect(
        documentCollaborationServiceTokenAgent.publicSide.verifyTokenFromService(
            "EdgeService",
            token,
        ),
    ).rejects.toThrow(PermissionDeniedError);
});

test("edge service can sign short lived tokens for edge service", async () => {
    const sessionId = generateId<SessionId>();
    const accountId = generateId<AccountId>();

    const token = await edgeServiceTokenAgent.privateSide.dangerouslySignShortLivedToken(
        "EdgeService",
        {
            type: "Session",
            sessionId,
            accountId,
        },
    );

    expect(await edgeServiceTokenAgent.publicSide.verifyToken(token)).toEqual({
        serviceName: "EdgeService",
        payload: {
            type: "Session",
            sessionId,
            accountId,
        },
    });

    expect(
        await edgeServiceTokenAgent.publicSide.verifyTokenFromService("EdgeService", token),
    ).toEqual({
        type: "Session",
        sessionId,
        accountId,
    });

    await expect(
        edgeServiceTokenAgent.publicSide.verifyTokenFromService("AppService", token),
    ).rejects.toThrow(PermissionDeniedError);

    await expect(appServiceTokenAgent.publicSide.verifyToken(token)).rejects.toThrow(
        PermissionDeniedError,
    );
    await expect(
        appServiceTokenAgent.publicSide.verifyTokenFromService("AppService", token),
    ).rejects.toThrow(PermissionDeniedError);
    await expect(
        appServiceTokenAgent.publicSide.verifyTokenFromService("EdgeService", token),
    ).rejects.toThrow(PermissionDeniedError);

    await expect(
        documentCollaborationServiceTokenAgent.publicSide.verifyToken(token),
    ).rejects.toThrow(PermissionDeniedError);
    await expect(
        documentCollaborationServiceTokenAgent.publicSide.verifyTokenFromService(
            "AppService",
            token,
        ),
    ).rejects.toThrow(PermissionDeniedError);
    await expect(
        documentCollaborationServiceTokenAgent.publicSide.verifyTokenFromService(
            "EdgeService",
            token,
        ),
    ).rejects.toThrow(PermissionDeniedError);
});

test("document collaboration service can sign short lived tokens for app service", async () => {
    const sessionId = generateId<SessionId>();
    const accountId = generateId<AccountId>();

    const token =
        await documentCollaborationServiceTokenAgent.privateSide.dangerouslySignShortLivedToken(
            "AppService",
            {
                type: "Session",
                sessionId,
                accountId,
            },
        );

    expect(await appServiceTokenAgent.publicSide.verifyToken(token)).toEqual({
        serviceName: "DocumentCollaborationService",
        payload: {
            type: "Session",
            sessionId,
            accountId,
        },
    });

    expect(
        await appServiceTokenAgent.publicSide.verifyTokenFromService(
            "DocumentCollaborationService",
            token,
        ),
    ).toEqual({
        type: "Session",
        sessionId,
        accountId,
    });

    await expect(
        appServiceTokenAgent.publicSide.verifyTokenFromService("AppService", token),
    ).rejects.toThrow(PermissionDeniedError);

    await expect(edgeServiceTokenAgent.publicSide.verifyToken(token)).rejects.toThrow(
        PermissionDeniedError,
    );
    await expect(
        edgeServiceTokenAgent.publicSide.verifyTokenFromService("AppService", token),
    ).rejects.toThrow(PermissionDeniedError);
    await expect(
        edgeServiceTokenAgent.publicSide.verifyTokenFromService("EdgeService", token),
    ).rejects.toThrow(PermissionDeniedError);

    await expect(
        documentCollaborationServiceTokenAgent.publicSide.verifyToken(token),
    ).rejects.toThrow(PermissionDeniedError);
    await expect(
        documentCollaborationServiceTokenAgent.publicSide.verifyTokenFromService(
            "AppService",
            token,
        ),
    ).rejects.toThrow(PermissionDeniedError);
    await expect(
        documentCollaborationServiceTokenAgent.publicSide.verifyTokenFromService(
            "EdgeService",
            token,
        ),
    ).rejects.toThrow(PermissionDeniedError);
});

test("app service can sign short lived tokens for app service and edge service", async () => {
    const sessionId = generateId<SessionId>();
    const accountId = generateId<AccountId>();

    const token = await appServiceTokenAgent.privateSide.dangerouslySignShortLivedToken(
        ["AppService", "EdgeService"],
        {
            type: "Session",
            sessionId,
            accountId,
        },
    );

    expect(await appServiceTokenAgent.publicSide.verifyToken(token)).toEqual({
        serviceName: "AppService",
        payload: {
            type: "Session",
            sessionId,
            accountId,
        },
    });

    expect(
        await appServiceTokenAgent.publicSide.verifyTokenFromService("AppService", token),
    ).toEqual({
        type: "Session",
        sessionId,
        accountId,
    });

    await expect(
        appServiceTokenAgent.publicSide.verifyTokenFromService("EdgeService", token),
    ).rejects.toThrow(PermissionDeniedError);

    expect(await edgeServiceTokenAgent.publicSide.verifyToken(token)).toEqual({
        serviceName: "AppService",
        payload: {
            type: "Session",
            sessionId,
            accountId,
        },
    });

    expect(
        await edgeServiceTokenAgent.publicSide.verifyTokenFromService("AppService", token),
    ).toEqual({
        type: "Session",
        sessionId,
        accountId,
    });

    await expect(
        edgeServiceTokenAgent.publicSide.verifyTokenFromService("EdgeService", token),
    ).rejects.toThrow(PermissionDeniedError);

    await expect(
        documentCollaborationServiceTokenAgent.publicSide.verifyToken(token),
    ).rejects.toThrow(PermissionDeniedError);
    await expect(
        documentCollaborationServiceTokenAgent.publicSide.verifyTokenFromService(
            "AppService",
            token,
        ),
    ).rejects.toThrow(PermissionDeniedError);
    await expect(
        documentCollaborationServiceTokenAgent.publicSide.verifyTokenFromService(
            "EdgeService",
            token,
        ),
    ).rejects.toThrow(PermissionDeniedError);
});

test("edge service can sign short lived tokens for app service and edge service", async () => {
    const sessionId = generateId<SessionId>();
    const accountId = generateId<AccountId>();

    const token = await edgeServiceTokenAgent.privateSide.dangerouslySignShortLivedToken(
        ["AppService", "EdgeService"],
        {
            type: "Session",
            sessionId,
            accountId,
        },
    );

    expect(await appServiceTokenAgent.publicSide.verifyToken(token)).toEqual({
        serviceName: "EdgeService",
        payload: {
            type: "Session",
            sessionId,
            accountId,
        },
    });

    expect(
        await appServiceTokenAgent.publicSide.verifyTokenFromService("EdgeService", token),
    ).toEqual({
        type: "Session",
        sessionId,
        accountId,
    });

    await expect(
        appServiceTokenAgent.publicSide.verifyTokenFromService("AppService", token),
    ).rejects.toThrow(PermissionDeniedError);

    expect(await edgeServiceTokenAgent.publicSide.verifyToken(token)).toEqual({
        serviceName: "EdgeService",
        payload: {
            type: "Session",
            sessionId,
            accountId,
        },
    });

    expect(
        await edgeServiceTokenAgent.publicSide.verifyTokenFromService("EdgeService", token),
    ).toEqual({
        type: "Session",
        sessionId,
        accountId,
    });

    await expect(
        edgeServiceTokenAgent.publicSide.verifyTokenFromService("AppService", token),
    ).rejects.toThrow(PermissionDeniedError);

    await expect(
        documentCollaborationServiceTokenAgent.publicSide.verifyToken(token),
    ).rejects.toThrow(PermissionDeniedError);
    await expect(
        documentCollaborationServiceTokenAgent.publicSide.verifyTokenFromService(
            "AppService",
            token,
        ),
    ).rejects.toThrow(PermissionDeniedError);
    await expect(
        documentCollaborationServiceTokenAgent.publicSide.verifyTokenFromService(
            "EdgeService",
            token,
        ),
    ).rejects.toThrow(PermissionDeniedError);
});

test("app service can sign eternal tokens for app service and edge service", async () => {
    const sessionId = generateId<SessionId>();
    const accountId = generateId<AccountId>();

    const token = await appServiceTokenAgent.privateSide.dangerouslySignEternalSessionToken({
        type: "Session",
        sessionId,
        accountId,
    });

    expect(await appServiceTokenAgent.publicSide.verifyToken(token)).toEqual({
        serviceName: "AppService",
        payload: {
            type: "Session",
            sessionId,
            accountId,
        },
    });

    expect(
        await appServiceTokenAgent.publicSide.verifyTokenFromService("AppService", token),
    ).toEqual({
        type: "Session",
        sessionId,
        accountId,
    });

    await expect(
        appServiceTokenAgent.publicSide.verifyTokenFromService("EdgeService", token),
    ).rejects.toThrow(PermissionDeniedError);

    expect(await edgeServiceTokenAgent.publicSide.verifyToken(token)).toEqual({
        serviceName: "AppService",
        payload: {
            type: "Session",
            sessionId,
            accountId,
        },
    });

    expect(
        await edgeServiceTokenAgent.publicSide.verifyTokenFromService("AppService", token),
    ).toEqual({
        type: "Session",
        sessionId,
        accountId,
    });

    await expect(
        edgeServiceTokenAgent.publicSide.verifyTokenFromService("EdgeService", token),
    ).rejects.toThrow(PermissionDeniedError);

    await expect(
        documentCollaborationServiceTokenAgent.publicSide.verifyToken(token),
    ).rejects.toThrow(PermissionDeniedError);
    await expect(
        documentCollaborationServiceTokenAgent.publicSide.verifyTokenFromService(
            "AppService",
            token,
        ),
    ).rejects.toThrow(PermissionDeniedError);
    await expect(
        documentCollaborationServiceTokenAgent.publicSide.verifyTokenFromService(
            "EdgeService",
            token,
        ),
    ).rejects.toThrow(PermissionDeniedError);
});

test("edge service can sign short lived tokens for edge service that actually expire", async () => {
    const sessionId = generateId<SessionId>();
    const accountId = generateId<AccountId>();

    const token = await edgeServiceTokenAgent.privateSide.dangerouslySignShortLivedToken(
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

    await expect(appServiceTokenAgent.publicSide.verifyToken(token)).rejects.toThrow(
        PermissionDeniedError,
    );
    await expect(
        appServiceTokenAgent.publicSide.verifyTokenFromService("AppService", token),
    ).rejects.toThrow(PermissionDeniedError);
    await expect(
        appServiceTokenAgent.publicSide.verifyTokenFromService("EdgeService", token),
    ).rejects.toThrow(PermissionDeniedError);

    await expect(edgeServiceTokenAgent.publicSide.verifyToken(token)).rejects.toThrow(
        PermissionDeniedError,
    );
    await expect(
        edgeServiceTokenAgent.publicSide.verifyTokenFromService("AppService", token),
    ).rejects.toThrow(PermissionDeniedError);
    await expect(
        edgeServiceTokenAgent.publicSide.verifyTokenFromService("EdgeService", token),
    ).rejects.toThrow(PermissionDeniedError);

    await expect(
        documentCollaborationServiceTokenAgent.publicSide.verifyToken(token),
    ).rejects.toThrow(PermissionDeniedError);
    await expect(
        documentCollaborationServiceTokenAgent.publicSide.verifyTokenFromService(
            "AppService",
            token,
        ),
    ).rejects.toThrow(PermissionDeniedError);
    await expect(
        documentCollaborationServiceTokenAgent.publicSide.verifyTokenFromService(
            "EdgeService",
            token,
        ),
    ).rejects.toThrow(PermissionDeniedError);
});

test("app service can sign short lived tokens for app service and edge service that actually expire", async () => {
    const sessionId = generateId<SessionId>();
    const accountId = generateId<AccountId>();

    const token = await appServiceTokenAgent.privateSide.dangerouslySignShortLivedToken(
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

    await expect(appServiceTokenAgent.publicSide.verifyToken(token)).rejects.toThrow(
        PermissionDeniedError,
    );
    await expect(
        appServiceTokenAgent.publicSide.verifyTokenFromService("AppService", token),
    ).rejects.toThrow(PermissionDeniedError);
    await expect(
        appServiceTokenAgent.publicSide.verifyTokenFromService("EdgeService", token),
    ).rejects.toThrow(PermissionDeniedError);

    await expect(edgeServiceTokenAgent.publicSide.verifyToken(token)).rejects.toThrow(
        PermissionDeniedError,
    );
    await expect(
        edgeServiceTokenAgent.publicSide.verifyTokenFromService("AppService", token),
    ).rejects.toThrow(PermissionDeniedError);
    await expect(
        edgeServiceTokenAgent.publicSide.verifyTokenFromService("EdgeService", token),
    ).rejects.toThrow(PermissionDeniedError);

    await expect(
        documentCollaborationServiceTokenAgent.publicSide.verifyToken(token),
    ).rejects.toThrow(PermissionDeniedError);
    await expect(
        documentCollaborationServiceTokenAgent.publicSide.verifyTokenFromService(
            "AppService",
            token,
        ),
    ).rejects.toThrow(PermissionDeniedError);
    await expect(
        documentCollaborationServiceTokenAgent.publicSide.verifyTokenFromService(
            "EdgeService",
            token,
        ),
    ).rejects.toThrow(PermissionDeniedError);
});

test("document collaboration service can sign short lived tokens for app service that actually expire", async () => {
    const sessionId = generateId<SessionId>();
    const accountId = generateId<AccountId>();

    const token =
        await documentCollaborationServiceTokenAgent.privateSide.dangerouslySignShortLivedToken(
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

    await expect(appServiceTokenAgent.publicSide.verifyToken(token)).rejects.toThrow(
        PermissionDeniedError,
    );
    await expect(
        appServiceTokenAgent.publicSide.verifyTokenFromService("AppService", token),
    ).rejects.toThrow(PermissionDeniedError);
    await expect(
        appServiceTokenAgent.publicSide.verifyTokenFromService("EdgeService", token),
    ).rejects.toThrow(PermissionDeniedError);

    await expect(edgeServiceTokenAgent.publicSide.verifyToken(token)).rejects.toThrow(
        PermissionDeniedError,
    );
    await expect(
        edgeServiceTokenAgent.publicSide.verifyTokenFromService("AppService", token),
    ).rejects.toThrow(PermissionDeniedError);
    await expect(
        edgeServiceTokenAgent.publicSide.verifyTokenFromService("EdgeService", token),
    ).rejects.toThrow(PermissionDeniedError);

    await expect(
        documentCollaborationServiceTokenAgent.publicSide.verifyToken(token),
    ).rejects.toThrow(PermissionDeniedError);
    await expect(
        documentCollaborationServiceTokenAgent.publicSide.verifyTokenFromService(
            "AppService",
            token,
        ),
    ).rejects.toThrow(PermissionDeniedError);
    await expect(
        documentCollaborationServiceTokenAgent.publicSide.verifyTokenFromService(
            "EdgeService",
            token,
        ),
    ).rejects.toThrow(PermissionDeniedError);
});
