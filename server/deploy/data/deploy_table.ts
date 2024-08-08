import crypto from "crypto";
import {max as maxDate, subDays} from "date-fns";
import fs from "fs-extra";
import {extname, join as joinPath} from "path";
import serveStatic from "serve-static";
import {CloudflareR2ContextModule} from "~/server/deploy/data/cloudflare_r2_context_module.js";
import {GithubContextModule} from "~/server/deploy/data/github_context_module.js";
import {DynamoContext, DynamoContextModules} from "~/server/dynamo/core/dynamo_context.js";
import {DynamoTableItemType, DynamoTableSchema} from "~/server/dynamo/core/dynamo_table_schema.js";
import {Context} from "~/shared/context/context.js";
import {FailedPreconditionError, InternalError} from "~/shared/error/error.js";
import {filterMapArray} from "~/shared/helpers/array/filter_map_array.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {captureResultPromise} from "~/shared/helpers/control/capture_result_promise.js";
import {Result} from "~/shared/helpers/control/result.js";
import {isDateDefinitelyLessThanWithUncertaintyWindow} from "~/shared/helpers/date/is_date_less_than_with_uncertainty_window.js";
import {mapIterable} from "~/shared/helpers/iterable/map_iterable.js";
import {quote} from "~/shared/helpers/string/quote.js";
import {Schema, SchemaType} from "~/shared/schema/schema.js";

export const githubOwner = "cyberworlds";
export const githubRepo = "cyberworlds";

// You can find the GitHub `workflow_id` with the CLI command
// `gh workflow list`.
export const testGithubWorkflowId = 45008180;

// TODO(calebmer, #deploy): I'd love to create a quick `dev deployed` script
// which logs "yes this commit is deployed" or "this commit is currently
// deploying" or "this commit is not deployed".

const DeployTable = DynamoTableSchema.new({
    name: "Deploy",
    partitions: [
        {
            name: "Deploy",
            partitionKeyAttributes: {},
            sortRanges: [
                {
                    name: "Attributes",
                    sortKeyAttributes: {},
                    attributes: Schema.object({
                        /**
                         * The active git commit SHA in production.
                         *
                         * This does not necessarily represent the version of code running at any given
                         * time. During a deploy we may have two versions of our code running at once.
                         * One would be `commitSha` and the other would be
                         * `ongoingDeployment.commitSha`.
                         */
                        commitSha: Schema.string,

                        /**
                         * When we're running our deploy workflow, this object will be set and will
                         * contain information about the active deployment.
                         *
                         * This object should be cleared once a deployment succeeds or fails. However,
                         * if a deployment is cancelled that we might not be able to clear this
                         * property.
                         */
                        ongoingDeployment: Schema.object({
                            /**
                             * The [GitHub workflow run][1] that's current deploying our code.
                             *
                             * [1]: https://docs.github.com/en/rest/actions/workflow-runs?apiVersion=2022-11-28#get-a-workflow-run
                             */
                            workflowRunId: Schema.integer,

                            /**
                             * The git commit SHA we're in the process of deploying.
                             */
                            commitSha: Schema.string,
                        }).nullable(),
                    }),
                },
            ],
        },
    ],
});

type DeployAttributesItem = DynamoTableItemType<typeof DeployTable, "Deploy", "Attributes">;

export async function attemptStartDeploy(context: DynamoContext) {
    // TODO(calebmer, #deploy): Implement
    //
    // const commitTestResult = await octokit.actions.listWorkflowRuns({
    //     owner: githubOwner,
    //     repo: githubRepo,
    //     workflow_id: testGithubWorkflowId,
    //     status: "success",
    //     head_sha: commitSha,
    // });
    // if (!(commitTestResult.data.total_count > 0))
    //     throw new FailedPreconditionError("Passing test workflow not found for commit");
}

/**
 * Run a deploy.
 *
 * This function is written to work in `DeployService` and nowhere else. It
 * looks for runfiles declared as dependencies of `DeployService`. It uses the
 * `git` CLI which is only available in GitHub action runners. Trying to call
 * this function from anywhere but `DeployService` will likely fail.
 */
export async function deploy(
    context: Context<
        DynamoContextModules & {
            github: GithubContextModule;
            cloudflareR2: CloudflareR2ContextModule;
        }
    >,
    options: {
        commitSha: string;
        workflowRunId: number;
        appStaticDirectoryPath: string;
    },
) {
    assert(context.tracer.getRoot().serviceName === "DeployService");

    const handleSpanName = "Deploy";

    return context.tracer.withSpan(`Handle: ${handleSpanName}`, (context, span) => {
        span.addPropagatedDataForChildrenOnly({context: {handler: handleSpanName}});
        return actuallyDeploy(context, options);
    });
}

async function actuallyDeploy(
    context: Context<
        DynamoContextModules & {
            github: GithubContextModule;
            cloudflareR2: CloudflareR2ContextModule;
        }
    >,
    {
        commitSha,
        workflowRunId,
        appStaticDirectoryPath,
    }: {
        commitSha: string;
        workflowRunId: number;
        appStaticDirectoryPath: string;
    },
) {
    const deployItem = await prepareDeploy(context, {
        commitSha,
        workflowRunId,
    });

    const result = await captureResultPromise(async () => {
        const {manifest, paths} = await context.tracer.withSpan(
            "Upload app static files",
            context => uploadAppStaticFilesBeforeDeploy(context, {appStaticDirectoryPath}),
        );

        // TODO(calebmer, #deploy): Implement!

        await context.tracer.withSpan("Cleanup app static files", context =>
            cleanupAppStaticFilesAfterDeploy(context, {manifest, paths}),
        );
    });

    await cleanupDeploy(context, {
        commitSha,
        workflowRunId,
        result,
        initialItem: deployItem,
    });
}

/**
 * Prepare for a deploy from a GitHub workflow. Does the following:
 *
 * - Runs some validations on the commit:
 *   - Makes sure the commit is on the main branch
 *   - Makes sure the commit hasn't already been deployed
 *   - Makes sure there's a successful test run for the commit
 * - Updates an item in DynamoDB letting it know a deploy has started
 */
async function prepareDeploy(
    context: Context<DynamoContextModules & {github: GithubContextModule}>,
    {commitSha, workflowRunId}: {commitSha: string; workflowRunId: number},
): Promise<DeployAttributesItem> {
    assert(context.tracer.getRoot().serviceName === "DeployService");

    const mainCompareResult = await context.github.request(
        "GET /repos/{owner}/{repo}/compare/{base}...{head}",
        {
            owner: githubOwner,
            repo: githubRepo,
            base: commitSha,
            head: "main",
            per_page: 1,
        },
    );

    if (
        mainCompareResult.data.status !== "identical" &&
        mainCompareResult.data.status !== "behind"
    ) {
        throw new FailedPreconditionError(
            quote`Commit ${commitSha} is not present in "main" branch (compare status: ${mainCompareResult.data.status})`,
        );
    }

    const [deployItem, commitTestResult] = await runAllPromises([
        DeployTable.getItem(
            context,
            {
                partitionType: "Deploy",
                sortRangeType: "Attributes",
            },
            {consistency: "Strong"},
        ),
        context.github.request("GET /repos/{owner}/{repo}/actions/workflows/{workflow_id}/runs", {
            owner: githubOwner,
            repo: githubRepo,
            workflow_id: testGithubWorkflowId,
            status: "success",
            head_sha: commitSha,
        }),
    ]);

    if (!(commitTestResult.data.total_count > 0)) {
        throw new FailedPreconditionError(
            quote`Passing test workflow not found for commit ${commitSha}`,
        );
    }

    // If the database thinks there's an ongoing deployment, we should throw an
    // error because we can only run one deploy at a time! We use GitHub action's
    // [concurrency control][1] to make sure only one deploy runs at a time. Though
    // we still have this check just in case.
    //
    // If we detect that a workflow run has terminated before we can update the
    // database then we ignore the `ongoingDeployment` property and proceed anyway.
    //
    // [1]: https://docs.github.com/en/actions/writing-workflows/choosing-what-your-workflow-does/using-concurrency
    if (deployItem.ongoingDeployment) {
        const workflowRunResult = await context.github.request(
            "GET /repos/{owner}/{repo}/actions/runs/{run_id}",
            {
                owner: githubOwner,
                repo: githubRepo,
                run_id: deployItem.ongoingDeployment.workflowRunId,
            },
        );

        if (
            workflowRunResult.data.conclusion !== "cancelled" &&
            workflowRunResult.data.conclusion !== "failure"
        ) {
            throw new FailedPreconditionError(
                quote`Can't deploy while there's an ongoing deploy workflow run (id: ${deployItem.ongoingDeployment.workflowRunId}, status: ${workflowRunResult.status})`,
            );
        }
    }

    // Deploying a commit again will be a noop.
    if (deployItem.commitSha === commitSha) {
        throw new FailedPreconditionError(quote`Commit ${commitSha} was already deployed`);
    }

    // Make sure the commit we're deploying is later than the currently
    // deployed commit.
    const compareResult = await context.github.request(
        "GET /repos/{owner}/{repo}/compare/{base}...{head}",
        {
            owner: githubOwner,
            repo: githubRepo,
            base: commitSha,
            head: deployItem.commitSha,
            per_page: 1,
        },
    );

    // We check that `deployItem.commitSha` is behind `commitSha` so that the
    // `files` array is empty and doesn't return all changed file patches.
    if (compareResult.data.status !== "behind") {
        throw new FailedPreconditionError(
            quote`Commit ${commitSha} was already deployed (compare status: ${compareResult.data.status})`,
        );
    }

    return DeployTable.updateItem(
        context,
        {partitionType: "Deploy", sortRangeType: "Attributes"},
        item => ({
            ...item,
            ongoingDeployment: {
                workflowRunId,
                commitSha,
            },
        }),
        {initialItem: deployItem},
    );
}

async function cleanupDeploy(
    context: DynamoContext,
    {
        commitSha,
        workflowRunId,
        initialItem,
        result,
    }: {
        commitSha: string;
        workflowRunId: number;
        initialItem: DeployAttributesItem;
        result: Result<void>;
    },
) {
    await DeployTable.updateItem(
        context,
        {partitionType: "Deploy", sortRangeType: "Attributes"},
        item => {
            if (item.ongoingDeployment?.workflowRunId !== workflowRunId) {
                throw new InternalError(
                    quote`Unexpected ongoing deploy workflow run in database (expected id: ${workflowRunId}, actual id: ${item.ongoingDeployment?.workflowRunId})`,
                );
            }

            if (item.ongoingDeployment?.commitSha !== commitSha) {
                throw new InternalError(
                    quote`Unexpected ongoing deploy commit in database (expected commit: ${commitSha}, actual commit: ${item.ongoingDeployment?.commitSha})`,
                );
            }

            return {
                ...item,
                // If the deploy was successful update the deployed commit SHA. Otherwise leave
                // the old commit SHA in place since a failed deploy reverts all infrastructure
                // changes.
                commitSha: result.ok ? commitSha : item.commitSha,
                ongoingDeployment: null,
            };
        },
        {initialItem},
    );
}

const appStaticBucketName = "cyberworlds-app-static";

type AppStaticBucketManifestFile = SchemaType<typeof AppStaticBucketManifestFileSchema>;

const AppStaticBucketManifestFileSchema = Schema.object({
    path: Schema.string,
    contentMd5: Schema.string,
    uploadTime: Schema.date,
    shouldExpire: Schema.boolean,
});

type AppStaticBucketManifest = SchemaType<typeof AppStaticBucketManifestSchema>;

const AppStaticBucketManifestSchema = Schema.object({
    files: Schema.array(AppStaticBucketManifestFileSchema),
});

async function uploadAppStaticFilesBeforeDeploy(
    context: Context<DynamoContextModules & {cloudflareR2: CloudflareR2ContextModule}>,
    {appStaticDirectoryPath}: {appStaticDirectoryPath: string},
) {
    let oldManifest: AppStaticBucketManifest;

    try {
        const manifestOutput = await context.cloudflareR2.GetObject({
            Bucket: appStaticBucketName,
            Key: "manifest.json",
        });

        oldManifest = AppStaticBucketManifestSchema.deserialize(
            JSON.parse((await manifestOutput.Body?.transformToString("utf8")) ?? ""),
        );
    } catch (error) {
        throw error;

        // TODO(calebmer, #deploy): Implement
        //
        // if (isCloudflareR2NoSuchKeyError(error)) {
        //     manifest = {files: []};
        // } else {
        //     throw error;
        // }
    }

    const currentTime = new Date();

    const oldFilesByPath = new Map<string, AppStaticBucketManifestFile>();

    for (const file of oldManifest.files) {
        assert(!oldFilesByPath.has(file.path));
        oldFilesByPath.set(file.path, file);
    }

    const uploadFilesByPath = new Map<string, AppStaticBucketManifestFile>();

    const traverse = async (relativePath: string, path: string) => {
        const childPathNames = await fs.readdir(path);

        await runAllPromises(
            childPathNames.map(async childPathName => {
                const childPath = joinPath(path, childPathName);
                const childRelativePath = `${relativePath}${childPathName}`;

                if ((await fs.stat(childPath)).isDirectory()) {
                    await traverse(`${childRelativePath}/`, childPath);
                } else {
                    uploadFilesByPath.set(childRelativePath, {
                        path: childRelativePath,
                        contentMd5: await getFileMd5Hash(childPath),
                        uploadTime: currentTime,
                        // Files we upload before a deploy should expire. If the deploy succeeds we
                        // switch this to false. If the deploy fails then the static files will be kept
                        // for our static file retention period (currently 30 days) after which they'll
                        // be deleted.
                        //
                        // We need new static files during a deploy since some users may see newly
                        // deployed services while other users will see the previously deployed
                        // service. If the deploy rolls back, if a user has loaded a page with the new
                        // `AppService` they'll continue to need the static assets from the deploy we
                        // rolled back.
                        shouldExpire: true,
                    });
                }
            }),
        );
    };

    await traverse("", appStaticDirectoryPath);

    const newFilesByPath = new Map(oldFilesByPath);

    for (const newFile of uploadFilesByPath.values()) {
        const oldFile = oldFilesByPath.get(newFile.path);

        if (!oldFile) {
            newFilesByPath.set(newFile.path, newFile);
        } else {
            newFilesByPath.set(oldFile.path, {
                path: oldFile.path,
                contentMd5: newFile.contentMd5,
                uploadTime: maxDate([oldFile.uploadTime, newFile.uploadTime]),
                shouldExpire: oldFile.shouldExpire && newFile.shouldExpire,
            });
        }
    }

    const newManifest: AppStaticBucketManifest = {files: Array.from(newFilesByPath.values())};

    // We don't need to worry about multiple scripts trying to write to
    // `manifest.json` at the same time since only one `deploy()` function may be
    // run at a time. This is validated by our `prepareDeploy()` function.
    await context.cloudflareR2.PutObject({
        Bucket: appStaticBucketName,
        Key: "manifest.json",
        ContentType: "application/json",
        Body: JSON.stringify(AppStaticBucketManifestSchema.serialize(newManifest)),
    });

    await runAllPromises(
        mapIterable(uploadFilesByPath.values(), async newFile => {
            // If the file content didn't change then don't upload the file again.
            const oldFile = oldFilesByPath.get(newFile.path);
            if (oldFile?.contentMd5 === newFile.contentMd5) return;

            // Use the same logic to determine the `Content-Type` as the `serve-static`
            // module we use in development. Source code here:
            // https://github.com/pillarjs/send/blob/b69cbb3dc4c09c37917d08a4c13fcd1bac97ade5/index.js#L825-L841
            let contentType = serveStatic.mime.lookup(extname(newFile.path));

            if (contentType) {
                const charset = serveStatic.mime.charsets
                    // @ts-expect-error: This is how the `send` module finds the charset.
                    .lookup(contentType);

                if (charset) {
                    contentType += `; charset=${charset}`;
                }
            }

            await context.cloudflareR2.PutObject({
                Bucket: appStaticBucketName,
                Key: `files/${newFile.path}`,
                ContentMD5: newFile.contentMd5,
                ContentType: contentType || "application/octet-stream",
                Body: fs.createReadStream(joinPath(appStaticDirectoryPath, newFile.path)),
            });
        }),
    );

    return {
        manifest: newManifest,
        paths: new Set(uploadFilesByPath.keys()),
    };
}

async function getFileMd5Hash(path: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const hash = crypto.createHash("md5");
        const stream = fs.createReadStream(path);
        stream.on("error", reject);
        stream.on("data", chunk => hash.update(chunk));
        stream.on("end", () => resolve(hash.digest("base64")));
    });
}

async function cleanupAppStaticFilesAfterDeploy(
    context: Context<DynamoContextModules & {cloudflareR2: CloudflareR2ContextModule}>,
    {
        manifest: oldManifest,
        paths,
    }: {
        manifest: AppStaticBucketManifest;
        paths: ReadonlySet<string>;
    },
) {
    // If a file has `shouldExpire: true` and was uploaded before `expirationTime`
    // then we'll delete the file. Files that aren't actively used by the current
    // deploy are kept for 30 days before we delete them. This way `AppService`
    // clients using an old asset manifest have 30 days to reload before they start
    // getting errors when you try to navigate.
    const expirationTime = subDays(new Date(), 30);
    const expiredPaths = new Set<string>();

    const newManifest: AppStaticBucketManifest = {
        files: filterMapArray(oldManifest.files, oldFile => {
            const newFile: AppStaticBucketManifestFile = {
                path: oldFile.path,
                contentMd5: oldFile.contentMd5,
                uploadTime: oldFile.uploadTime,
                shouldExpire: !paths.has(oldFile.path),
            };

            if (
                newFile.shouldExpire &&
                isDateDefinitelyLessThanWithUncertaintyWindow(newFile.uploadTime, expirationTime)
            ) {
                expiredPaths.add(newFile.path);
                return null;
            }

            return newFile;
        }),
    };

    await runAllPromises(
        mapIterable(expiredPaths, async expiredPath => {
            await context.cloudflareR2.DeleteObject({
                Bucket: appStaticBucketName,
                Key: `files/${expiredPath}`,
            });
        }),
    );

    await context.cloudflareR2.PutObject({
        Bucket: appStaticBucketName,
        Key: "manifest.json",
        ContentType: "application/json",
        Body: JSON.stringify(AppStaticBucketManifestSchema.serialize(newManifest)),
    });
}
