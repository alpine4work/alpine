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
    await mutexByDirectoryPath.getOrSetDefault(directoryPath).withLock(async () => {
        await fs.ensureDir(directoryPath);

        const serviceNames = [
            "app_service",
            "edge_service_family",
            "task_realtime_service",
            "job_queue_service",
            "file_processor_service",
            "api_service",
        ];

        await runAllPromises([
            (async () => {
                if (await fs.pathExists(joinPath(directoryPath, "token_agent_secret"))) return;

                const secretBytes = new Uint8Array(32);
                crypto.getRandomValues(secretBytes);
                const secret = encodeBase64(secretBytes);

                await fs.writeFile(joinPath(directoryPath, "token_agent_secret"), secret + "\n");
            })(),
            ...serviceNames.map(async serviceName => {
                const privateKeyPath = joinPath(directoryPath, `${serviceName}_rsa`);
                const publicKeyPath = joinPath(directoryPath, `${serviceName}_rsa.pub`);

                if (await fs.pathExists(privateKeyPath)) return;

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
                    fs.writeFile(privateKeyPath, privateKey),
                    fs.writeFile(publicKeyPath, publicKey),
                ]);
            }),
        ]);
    });
}
