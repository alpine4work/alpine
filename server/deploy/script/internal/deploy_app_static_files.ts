import crypto from "crypto";
import {max as maxDate, subDays} from "date-fns";
import fs from "fs-extra";
import {extname, join as joinPath} from "path";
import serveStatic from "serve-static";
import {isCloudflareR2NoSuchKeyError} from "~/server/cloudflare/r2/cloudflare_r2_client.js";
import {CloudflareR2ContextModule} from "~/server/cloudflare/r2/cloudflare_r2_context_module.js";
import {DynamoContextModules} from "~/server/dynamo/core/dynamo_context.js";
import {runfilesPath} from "~/server/helpers/node/runfiles_path.js";
import {Context} from "~/shared/context/context.js";
import {createArrayWithLength} from "~/shared/helpers/array/create_array_with_length.js";
import {Mutex} from "~/shared/helpers/async/mutex.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {isDateDefinitelyLessThanWithUncertaintyWindow} from "~/shared/helpers/date/is_date_less_than_with_uncertainty_window.js";
import {mapIterable} from "~/shared/helpers/iterable/map_iterable.js";
import {Schema, SchemaType} from "~/shared/schema/schema.js";

const appStaticBucketName = "cyberworlds-app-static";

type AppStaticBucketManifestFile = SchemaType<typeof AppStaticBucketManifestFileSchema>;

const AppStaticBucketManifestFileSchema = Schema.object({
    path: Schema.string,
    contentMd5: Schema.string,
    uploadTime: Schema.date,
});

type AppStaticBucketManifest = SchemaType<typeof AppStaticBucketManifestSchema>;

const AppStaticBucketManifestSchema = Schema.object({
    files: Schema.array(AppStaticBucketManifestFileSchema),
});

/**
 * Uploads all static files from `//app:app_static` to Cloudflare R2. We serve
 * static files from `EdgeService` by reading from R2 in production. We keep old
 * static files around for 14 days after a deploy that removes them so clients
 * running old code can continue to reference the old static files.
 *
 * This function uploads all files from `//app:app_static`. It's important to do
 * this before a deploy so that as users start to make requests against an
 * `AppService` running new code the static assets will be available. If a deploy
 * rolls back then we'll delete the uploaded files 14 days after they were
 * uploaded.
 */
export async function uploadAppStaticFilesBeforeDeploy(
    context: Context<DynamoContextModules & {r2: CloudflareR2ContextModule}>,
) {
    let oldManifest: AppStaticBucketManifest;

    try {
        const manifestOutput = await context.r2.GetObject({
            Bucket: appStaticBucketName,
            Key: "manifest.json",
        });

        oldManifest = AppStaticBucketManifestSchema.deserialize(
            JSON.parse((await manifestOutput.Body?.transformToString("utf8")) ?? ""),
        );
    } catch (error) {
        if (isCloudflareR2NoSuchKeyError(error)) {
            oldManifest = {files: []};
        } else {
            throw error;
        }
    }

    const currentTime = new Date();

    const oldFileByPath = new Map<string, AppStaticBucketManifestFile>();

    for (const file of oldManifest.files) {
        assert(!oldFileByPath.has(file.path));
        oldFileByPath.set(file.path, file);
    }

    const uploadFileByPath = new Map<string, AppStaticBucketManifestFile>();

    const traverse = async (relativePath: string, path: string) => {
        const childPathNames = await fs.readdir(path);

        await runAllPromises(
            childPathNames.map(async childPathName => {
                const childPath = joinPath(path, childPathName);
                const childRelativePath = `${relativePath}${childPathName}`;

                if ((await fs.stat(childPath)).isDirectory()) {
                    await traverse(`${childRelativePath}/`, childPath);
                } else {
                    // Don't upload sourcemaps to R2. They're uploaded as GitHub artifacts during
                    // deploy and used by `dev sourcemap`.
                    if (childRelativePath.endsWith(".map")) return;

                    uploadFileByPath.set(childRelativePath, {
                        path: childRelativePath,
                        contentMd5: await getFileMd5Hash(childPath),
                        uploadTime: currentTime,
                    });
                }
            }),
        );
    };

    const rootPath = joinPath(runfilesPath, "cyberworlds/app/build/client");
    await traverse("", rootPath);

    const newFileByPath = new Map(oldFileByPath);

    for (const newFile of uploadFileByPath.values()) {
        const oldFile = oldFileByPath.get(newFile.path);

        if (!oldFile) {
            newFileByPath.set(newFile.path, newFile);
        } else {
            newFileByPath.set(oldFile.path, {
                path: oldFile.path,
                contentMd5: newFile.contentMd5,
                uploadTime: maxDate([oldFile.uploadTime, newFile.uploadTime]),
            });
        }
    }

    const newManifest: AppStaticBucketManifest = {files: Array.from(newFileByPath.values())};

    // We don't need to worry about multiple scripts trying to write to `manifest.json`
    // at the same time since only one `deploy()` function may be run at a time. This
    // is validated by our `prepareDeploy()` function.
    await context.r2.PutObject({
        Bucket: appStaticBucketName,
        Key: "manifest.json",
        ContentType: "application/json",
        Body: JSON.stringify(AppStaticBucketManifestSchema.serialize(newManifest)),
    });

    // Only allow 8 `PutObject()` requests at once.
    let mutexCount = 0;
    const mutexes = createArrayWithLength(8, () => new Mutex());

    await runAllPromises(
        mapIterable(uploadFileByPath.values(), async newFile => {
            // If the file content didn't change then don't upload the file again.
            const oldFile = oldFileByPath.get(newFile.path);
            if (oldFile?.contentMd5 === newFile.contentMd5) return;

            // Use the same logic to determine the `Content-Type` as the `serve-static` module
            // we use in development. Source code here:
            // https://github.com/pillarjs/send/blob/b69cbb3dc4c09c37917d08a4c13fcd1bac97ade5/index.js#L825-L841
            let contentType = serveStatic.mime.lookup(extname(newFile.path));

            if (contentType) {
                const charset = serveStatic.mime.charsets
                    // @ts-expect-error: This is how the `send` module finds the charset.
                    .lookup(contentType);

                if (charset) {
                    contentType += `;charset=${charset.toLowerCase()}`;
                }
            }

            const newFilePath = joinPath(rootPath, newFile.path);

            const mutex = mutexes[mutexCount % mutexes.length]!;
            mutexCount++;

            await mutex.withLock(async () => {
                await context.r2.PutObject({
                    Bucket: appStaticBucketName,
                    Key: `files/${newFile.path}`,
                    ContentMD5: newFile.contentMd5,
                    ContentType: contentType || "application/octet-stream",
                    ContentLength: (await fs.stat(newFilePath)).size,
                    Body: fs.createReadStream(newFilePath),
                });
            });
        }),
    );

    return {
        manifest: newManifest,
        paths: new Set(uploadFileByPath.keys()),
    };
}

async function getFileMd5Hash(path: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const hash = crypto.createHash("md5");
        const stream = fs.createReadStream(path);

        stream.on("error", reject);

        stream.on("data", chunk => {
            // TODO(calebmer, #typescript-5.9.2): Discovered after TS version upgrade, not
            // fixing for now.
            // @ts-expect-error
            hash.update(chunk);
        });

        stream.on("end", () => {
            resolve(hash.digest("base64"));
        });
    });
}

export async function cleanupAppStaticFilesAfterDeploy(
    context: Context<DynamoContextModules & {r2: CloudflareR2ContextModule}>,
    {
        manifest: oldManifest,
        paths,
    }: {
        manifest: AppStaticBucketManifest;
        paths: ReadonlySet<string>;
    },
) {
    // If a file has `shouldExpire: true` and was uploaded before `expirationTime` then
    // we'll delete the file. Files that aren't actively used by the current deploy are
    // kept for 14 days before we delete them. This way `AppService` clients using an
    // old asset manifest have 14 days to reload before they start getting errors when
    // you try to navigate.
    const expirationTime = subDays(new Date(), 14);
    const expiredPaths = new Set<string>();

    const newManifest: AppStaticBucketManifest = {
        files: oldManifest.files.filter(file => {
            if (
                !paths.has(file.path) &&
                isDateDefinitelyLessThanWithUncertaintyWindow(file.uploadTime, expirationTime)
            ) {
                expiredPaths.add(file.path);
                return false;
            }

            return true;
        }),
    };

    await runAllPromises(
        mapIterable(expiredPaths, async expiredPath => {
            await context.r2.DeleteObject({
                Bucket: appStaticBucketName,
                Key: `files/${expiredPath}`,
            });
        }),
    );

    await context.r2.PutObject({
        Bucket: appStaticBucketName,
        Key: "manifest.json",
        ContentType: "application/json",
        Body: JSON.stringify(AppStaticBucketManifestSchema.serialize(newManifest)),
    });
}
