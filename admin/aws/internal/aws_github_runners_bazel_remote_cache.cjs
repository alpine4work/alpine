/**
 * This file runs a small proxy server we can pass to Bazel's `--remote_cache`
 * option in our GitHub runner. The proxy server adds an `Authorization` header
 * and redirects the request to our S3 remote cache bucket.
 *
 * This file can't use any third-party dependencies since it runs before Bazel
 * downloads our npm dependencies from `package.json`. It also runs before
 * Bazel installs Node.js so we have to use an Node.js v12 which is what's
 * installed by Ubuntu's package manager (`apt-get install nodejs`). Make sure
 * to only use JavaScript features and Node.js APIs supported by Node.js 12.
 *
 * How to sign requests to S3 is documented in “[Signing and authenticating
 * REST requests][1].” There's a pretty thorough specification we follow in
 * this file.
 *
 * [1]: https://docs.aws.amazon.com/AmazonS3/latest/userguide/RESTAuthentication.html
 */

"use strict";

const path = require("path");
const crypto = require("crypto");
const url = require("url");
const http = require("http");
const https = require("https");

process.title = `node ${path.basename(__filename)}`;

const keepAliveAgent = new https.Agent({keepAlive: true});

async function httpRequest(urlString, options) {
    return new Promise((resolve, reject) => {
        const parsedUrl = url.parse(urlString);

        if (parsedUrl.protocol !== "http:") throw new Error("Unexpected protocol");

        const req = http.request(
            {
                hostname: parsedUrl.hostname,
                path: parsedUrl.path,
                method: options && options.method ? options.method : "GET",
                headers: options && options.headers ? options.headers : undefined,
            },
            res => {
                res.setEncoding("utf8");

                let data = "";
                res.on("data", chunk => {
                    data += chunk;
                });

                res.on("end", () => {
                    if (res.statusCode !== 200) {
                        reject(new Error(`Request failed with status code ${res.statusCode}`));
                    } else {
                        resolve(data);
                    }
                });
            },
        );

        req.end();
    });
}

async function main() {
    const metadataToken = (
        await httpRequest("http://169.254.169.254/latest/api/token", {
            method: "PUT",
            headers: {"x-aws-ec2-metadata-token-ttl-seconds": "60"},
        })
    ).trim();

    const [roleCredentials, instanceIdentity] = await Promise.all([
        (async () => {
            const roleName = (
                await httpRequest(
                    "http://169.254.169.254/latest/meta-data/iam/security-credentials",
                    {headers: {"x-aws-ec2-metadata-token": metadataToken}},
                )
            ).trim();

            return JSON.parse(
                await httpRequest(
                    `http://169.254.169.254/latest/meta-data/iam/security-credentials/${roleName}`,
                    {headers: {"x-aws-ec2-metadata-token": metadataToken}},
                ),
            );
        })(),
        (async () => {
            return JSON.parse(
                await httpRequest(
                    "http://169.254.169.254/latest/dynamic/instance-identity/document",
                    {headers: {"x-aws-ec2-metadata-token": metadataToken}},
                ),
            );
        })(),
    ]);

    const {region} = instanceIdentity;
    if (!region) throw new Error("EC2 instance region not found");

    // TODO(calebmer, 2024-08-15): Wish I called this bucket
    // `cyberworlds-bazel-remote-cache`. Since `bazel-remote` could refer to remote
    // execution or remote caching. I think I named this when I was planning to use
    // the [`bazel-remote`][1] project.
    //
    // [1]: https://github.com/buchgr/bazel-remote
    const bucket = "cyberworlds-bazel-remote";

    const host = `${bucket}.s3.${region}.amazonaws.com`;

    const server = http.createServer((req1, res1) => {
        try {
            if (!req1.url.startsWith("/")) throw new Error("Expected path to start with `/`");

            const req2Headers = {...req1.headers};

            req2Headers["host"] = host;

            if (!req2Headers["date"]) req2Headers["date"] = new Date().toUTCString();

            // The temporary token provided to us by the instance metadata service expires
            // more than 4 hours in the future. This is plenty of time for our test to run.
            req2Headers["x-amz-security-token"] = roleCredentials.Token;

            // Follows the algorithm defined here:
            // https://docs.aws.amazon.com/AmazonS3/latest/userguide/RESTAuthentication.html
            const canonicalizedAmzHeaders = Object.entries(req2Headers)
                .filter(([key]) => /^x-amz-/i.test(key))
                .map(([key, value]) => [
                    key.toLowerCase(),
                    (Array.isArray(value) ? value.join(",") : value).trim(),
                ])
                .sort(([key1], [key2]) => {
                    if (key1 < key2) return -1;
                    if (key1 > key2) return 1;
                    return 0;
                })
                .map(([key, value]) => `${key}:${value}\n`)
                .join("");

            // Follows the algorithm defined here:
            // https://docs.aws.amazon.com/AmazonS3/latest/userguide/RESTAuthentication.html#ConstructingTheAuthenticationHeader
            const stringToSign =
                req1.method +
                "\n" +
                (req2Headers["content-md5"] || "") +
                "\n" +
                (req2Headers["content-type"] || "") +
                "\n" +
                (req2Headers["date"] || "") +
                "\n" +
                canonicalizedAmzHeaders +
                `/${bucket}${req1.url}`;

            const signature = crypto
                .createHmac("sha1", roleCredentials.SecretAccessKey, {encoding: "utf8"})
                .update(stringToSign, "utf8")
                .digest("base64");

            req2Headers["authorization"] = `AWS ${roleCredentials.AccessKeyId}:${signature}`;

            const req2 = https.request({
                agent: keepAliveAgent,
                hostname: host,
                path: req1.url,
                method: req1.method,
                headers: req2Headers,
            });

            req2.on("error", error => {
                // eslint-disable-next-line no-console
                console.error("Unexpected error:", error);

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
        // Manually inline `BAZEL_REMOTE_CACHE_PORT` from `.env.development`. We can't
        // have any third-party dependencies in this file.
        server.listen(3501, error => {
            if (error) reject(error);
            else resolve();
        });
    });

    // eslint-disable-next-line no-console
    console.log("Bazel remote cache proxy server listening on port 3501");
}

main().catch(error => {
    // eslint-disable-next-line no-console
    console.error(error);
    process.exitCode = 1;
});
