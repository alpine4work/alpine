"use strict";

const crypto = require("crypto");
const http = require("http");
const https = require("https");

const keepAliveAgent = new https.Agent({keepAlive: true});

// eslint-disable-next-line no-commit-blockers
// NOCOMMIT: Delete `admin/vendor/bazel-remote` and `BAZEL_REMOTE_GRPC_PORT` if
// this works. Also document what this file does. Also that it runs in
// Node.js v12.

async function getRequest(url) {
    return new Promise(resolve => {
        http.get(url, res => {
            res.setEncoding("utf8");

            let data = "";
            res.on("data", chunk => {
                data += chunk;
            });

            res.on("end", () => {
                // eslint-disable-next-line no-commit-blockers
                // NOCOMMIT: Remove this
                // eslint-disable-next-line no-console
                console.log("[DEBUG] get request finished", data);
                resolve(data);
            });
        });
    });
}

async function main() {
    const [iamRoleCredentials, instanceIdentity] = await Promise.all([
        (async () => {
            const iamRoleName = (
                await getRequest("http://169.254.169.254/latest/meta-data/iam/security-credentials")
            ).trim();

            return JSON.parse(
                await getRequest(
                    `http://169.254.169.254/latest/meta-data/iam/security-credentials/${iamRoleName}`,
                ),
            );
        })(),
        (async () => {
            return JSON.parse(
                await getRequest(
                    "http://169.254.169.254/latest/dynamic/instance-identity/document",
                ),
            );
        })(),
    ]);

    const {region} = instanceIdentity;
    if (!region) throw new Error("EC2 instance region not found");

    const server = http.createServer((req1, res1) => {
        try {
            if (!req1.path.startsWith("/")) throw new Error('Expected path to start with "/"');

            const req2Headers = {...req1.headers};

            if (!req2Headers["date"]) req2Headers["date"] = new Date().toUTCString();

            const signatureString = [
                req1.method,
                req2Headers["content-md5"] || "",
                req2Headers["content-type"] || "",
                req2Headers["date"] || "",
                `/cyberworlds-bazel-remote${req1.path}`,
            ].join("\n");

            const signature = crypto
                .createHmac("sha1", iamRoleCredentials.SecretAccessKey, {encoding: "utf8"})
                .update(signatureString, "utf8")
                .digest("base64");

            req2Headers["authorization"] = `AWS ${iamRoleCredentials.AccessKeyId}:${signature}`;

            const req2 = https.request({
                agent: keepAliveAgent,
                hostname: `cyberworlds-bazel-remote.s3.${region}.amazonaws.com`,
                path: req1.path,
                method: req1.method,
                headers: req2Headers,
            });

            req2.on("error", error => {
                // eslint-disable-next-line no-console
                console.error(error);

                res1.writeHead(500, {"content-type": "text/plain"});
                res1.end("500 Internal Server Error");
            });

            req2.on("response", res2 => {
                res1.writeHead(res2.statusCode, res2.headers);
                res2.pipe(res1, {end: true});
            });

            req1.pipe(req2, {end: true});
        } catch (error) {
            // eslint-disable-next-line no-console
            console.error("Unexpected error:", error);

            if (!res1.headersSent) {
                res1.writeHead(500, {"content-type": "text/plain"});
                res1.end("500 Internal Server Error");
            }
        }
    });

    await new Promise((resolve, reject) => {
        // Manually inline `BAZEL_REMOTE_PORT` from `.env.development`. We can't have
        // any third-party dependencies in this file.
        server.listen(3501, error => {
            if (error) reject(error);
            else resolve();
        });
    });

    // eslint-disable-next-line no-console
    console.log("Bazel remote cache server listening on port 3501");
}

main().catch(error => {
    // eslint-disable-next-line no-console
    console.error(error);
    process.exitCode = 1;
});
