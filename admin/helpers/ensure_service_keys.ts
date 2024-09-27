import {generateKeyPair} from "crypto";
import fs from "fs-extra";
import {join as joinPath} from "path";
import {Mutex} from "~/shared/helpers/async/mutex.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {encodeBase64} from "~/shared/helpers/binary/base64.js";
import {DefaultMap} from "~/shared/helpers/map/default_map.js";

const mutexByDirectoryPath = new DefaultMap<string, Mutex>(() => new Mutex());

/**
 * Make sure our development key files exist. If our key files do not exist
 * then we generate new keys. Otherwise this function does nothing.
 */
export async function ensureServiceKeys(directoryPath: string) {
    await fs.ensureDir(directoryPath);
    directoryPath = await fs.realpath(directoryPath);

    // Use a mutex to prevent concurrency issues when we try to generate keys
    // multiple times in the same directory.
    await mutexByDirectoryPath.getOrSetDefault(directoryPath).withLock(async () => {
        await runAllPromises([
            (async () => {
                if (await fs.pathExists(joinPath(directoryPath, "token_agent_secret"))) return;

                const secretBytes = new Uint8Array(32);
                crypto.getRandomValues(secretBytes);
                const secret = encodeBase64(secretBytes);

                await fs.writeFile(joinPath(directoryPath, "token_agent_secret"), secret + "\n");
            })(),
            (async () => {
                if (await fs.pathExists(joinPath(directoryPath, "app_service_rsa"))) return;

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
                    fs.writeFile(joinPath(directoryPath, "app_service_rsa"), privateKey),
                    fs.writeFile(joinPath(directoryPath, "app_service_rsa.pub"), publicKey),
                ]);
            })(),
            (async () => {
                if (await fs.pathExists(joinPath(directoryPath, "edge_service_family_rsa"))) return;

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
                    fs.writeFile(joinPath(directoryPath, "edge_service_family_rsa"), privateKey),
                    fs.writeFile(joinPath(directoryPath, "edge_service_family_rsa.pub"), publicKey),
                ]);
            })(),
            (async () => {
                if (await fs.pathExists(joinPath(directoryPath, "task_realtime_service_rsa")))
                    return;

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
                    fs.writeFile(joinPath(directoryPath, "task_realtime_service_rsa"), privateKey),
                    fs.writeFile(
                        joinPath(directoryPath, "task_realtime_service_rsa.pub"),
                        publicKey,
                    ),
                ]);
            })(),
            (async () => {
                if (await fs.pathExists(joinPath(directoryPath, "job_queue_service_rsa"))) return;

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
                    fs.writeFile(joinPath(directoryPath, "job_queue_service_rsa"), privateKey),
                    fs.writeFile(joinPath(directoryPath, "job_queue_service_rsa.pub"), publicKey),
                ]);
            })(),
            (async () => {
                if (await fs.pathExists(joinPath(directoryPath, "file_upload_service_rsa"))) return;

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
                    fs.writeFile(joinPath(directoryPath, "file_upload_service_rsa"), privateKey),
                    fs.writeFile(joinPath(directoryPath, "file_upload_service_rsa.pub"), publicKey),
                ]);
            })(),
        ]);
    });
}
