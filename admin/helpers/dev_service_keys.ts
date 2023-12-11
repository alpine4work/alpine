import {generateKeyPair} from "crypto";
import fs from "fs-extra";
import {join as joinPath} from "path";
import {devEnvPaths} from "~/admin/helpers/dev_env_paths.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";

const devKeysDirectoryPath = joinPath(devEnvPaths.config, "keys");

export const devAppServicePrivateKeyPath = joinPath(devKeysDirectoryPath, "app_service_rsa");
export const devAppServicePublicKeyPath = joinPath(devKeysDirectoryPath, "app_service_rsa.pub");

export const devEdgeServiceFamilyPrivateKeyPath = joinPath(
    devKeysDirectoryPath,
    "edge_service_family_rsa",
);
export const devEdgeServiceFamilyPublicKeyPath = joinPath(
    devKeysDirectoryPath,
    "edge_service_family_rsa.pub",
);

export const devTaskRealtimeServicePrivateKeyPath = joinPath(
    devKeysDirectoryPath,
    "task_realtime_service_rsa",
);
export const devTaskRealtimeServicePublicKeyPath = joinPath(
    devKeysDirectoryPath,
    "task_realtime_service_rsa.pub",
);

export const devJobQueueServicePrivateKeyPath = joinPath(
    devKeysDirectoryPath,
    "job_queue_service_rsa",
);
export const devJobQueueServicePublicKeyPath = joinPath(
    devKeysDirectoryPath,
    "job_queue_service_rsa.pub",
);

/**
 * Make sure our development key files exist. If our key files do not exist
 * then we generate new keys. Otherwise this function does nothing.
 */
export async function ensureDevServiceKeys() {
    await runAllPromises([
        (async () => {
            if (await fs.pathExists(devAppServicePrivateKeyPath)) return;
            await fs.ensureDir(devKeysDirectoryPath);

            const {publicKey, privateKey} = await new Promise<{
                publicKey: string;
                privateKey: string;
            }>((resolve, reject) =>
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
            );

            await runAllPromises([
                fs.writeFile(devAppServicePrivateKeyPath, privateKey),
                fs.writeFile(devAppServicePublicKeyPath, publicKey),
            ]);
        })(),
        (async () => {
            if (await fs.pathExists(devEdgeServiceFamilyPrivateKeyPath)) return;
            await fs.ensureDir(devKeysDirectoryPath);

            const {publicKey, privateKey} = await new Promise<{
                publicKey: string;
                privateKey: string;
            }>((resolve, reject) =>
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
            );

            await runAllPromises([
                fs.writeFile(devEdgeServiceFamilyPrivateKeyPath, privateKey),
                fs.writeFile(devEdgeServiceFamilyPublicKeyPath, publicKey),
            ]);
        })(),
        (async () => {
            if (await fs.pathExists(devTaskRealtimeServicePrivateKeyPath)) return;
            await fs.ensureDir(devKeysDirectoryPath);

            const {publicKey, privateKey} = await new Promise<{
                publicKey: string;
                privateKey: string;
            }>((resolve, reject) =>
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
            );

            await runAllPromises([
                fs.writeFile(devTaskRealtimeServicePrivateKeyPath, privateKey),
                fs.writeFile(devTaskRealtimeServicePublicKeyPath, publicKey),
            ]);
        })(),
        (async () => {
            if (await fs.pathExists(devJobQueueServicePrivateKeyPath)) return;
            await fs.ensureDir(devKeysDirectoryPath);

            const {publicKey, privateKey} = await new Promise<{
                publicKey: string;
                privateKey: string;
            }>((resolve, reject) =>
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
            );

            await runAllPromises([
                fs.writeFile(devJobQueueServicePrivateKeyPath, privateKey),
                fs.writeFile(devJobQueueServicePublicKeyPath, publicKey),
            ]);
        })(),
    ]);
}
