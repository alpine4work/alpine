import {R2Bucket} from "@miniflare/r2";
import {FileStorage} from "@miniflare/storage-file";
import {join as joinPath} from "path";
import {CloudflareR2Client} from "~/server/cloudflare/r2/cloudflare_r2_client.js";
import {CloudflareR2ContextModule} from "~/server/cloudflare/r2/cloudflare_r2_context_module.js";
import {MiniflareR2Client} from "~/server/cloudflare/r2/miniflare_r2_client.js";
import {
    avatarsBindingName,
    avatarsBucketName,
} from "~/server/helpers/avatars_cloudflare_r2_bucket_name.js";
import {
    filesBindingName,
    filesBucketName,
} from "~/server/helpers/files_cloudflare_r2_bucket_name.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.open_source.js";

export const serviceCloudflareR2Options = {
    cloudflareR2LocalDataPath: {type: "string"},
    cloudflareAccountId: {type: "string"},
    cloudflareR2AccessKeyId: {type: "string"},
    cloudflareR2SecretAccessKey: {type: "string"},
    fileProcessorServiceUrl: {type: "string"},
} as const;

export type ServiceCloudflareR2Options = {
    readonly cloudflareR2LocalDataPath?: string;
    readonly cloudflareAccountId?: string;
    readonly cloudflareR2AccessKeyId?: string;
    readonly cloudflareR2SecretAccessKey?: string;
    readonly fileProcessorServiceUrl?: string;
};

/**
 * Create a Cloudflare R2 context module. You should run this at the root of your
 * service. Probably in a `runService()` call.
 *
 * Requires some parameters we expect to come from the command line.
 * `serviceCloudflareR2Options` is an object defining the args you can pass into
 * `parseArgs()`.
 */
export function createServiceCloudflareR2ContextModule(options: ServiceCloudflareR2Options) {
    if (process.env.NODE_ENV === "production") {
        const client = new CloudflareR2Client({
            accountId: assertExists(
                options.cloudflareAccountId,
                "`cloudflareAccountId` option is required in production",
            ),
            accessKeyId: assertExists(
                options.cloudflareR2AccessKeyId,
                "`cloudflareR2AccessKeyId` option is required in production",
            ),
            secretAccessKey: assertExists(
                options.cloudflareR2SecretAccessKey,
                "`cloudflareR2SecretAccessKey` option is required in production",
            ),
        });

        return new CloudflareR2ContextModule(client);
    } else {
        const buckets = [
            {bucketName: filesBucketName, bindingName: filesBindingName},
            {bucketName: avatarsBucketName, bindingName: avatarsBindingName},
        ];

        const cloudflareR2LocalDataPath = assertExists(
            options.cloudflareR2LocalDataPath,
            "`cloudflareR2LocalDataPath` option is required in development",
        );

        const bucketByName = new Map(
            buckets.map(({bucketName, bindingName}) => {
                const r2Storage = new FileStorage(joinPath(cloudflareR2LocalDataPath, bindingName));
                const r2Bucket = new R2Bucket(r2Storage);
                return [bucketName, r2Bucket];
            }),
        );

        const client = new MiniflareR2Client({
            fileProcessorServiceUrl: assertExists(
                options.fileProcessorServiceUrl,
                "`fileProcessorServiceUrl` option is required in development",
            ),
            bucketByName,
        });

        return new CloudflareR2ContextModule(client);
    }
}
