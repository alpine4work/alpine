import crypto from "crypto";
import {max as maxDate, subDays} from "date-fns";
import fs from "fs-extra";
import {extname, join as joinPath} from "path";
import serveStatic from "serve-static";
import {
    cleanupDeploy,
    githubOwner,
    githubRepo,
    prepareDeploy,
} from "~/server/deploy/data/deploy_table.js";
import {GithubContextModule} from "~/server/deploy/data/github_context_module.js";
import {isCloudflareR2NoSuchKeyError} from "~/server/deploy/tool/cloudflare_r2_client.js";
import {CloudflareR2ContextModule} from "~/server/deploy/tool/cloudflare_r2_context_module.js";
import {DynamoContextModules} from "~/server/dynamo/core/dynamo_context.js";
import {runfilesPath} from "~/server/helpers/node/runfiles_path.js";
import {Context} from "~/shared/context/context.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {UnknownError} from "~/shared/error/error.js";
import {filterMapArray} from "~/shared/helpers/array/filter_map_array.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {MonotonicClock} from "~/shared/helpers/clock/monotonic_clock.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {unwrapResult} from "~/shared/helpers/control/capture_result.js";
import {captureResultPromise} from "~/shared/helpers/control/capture_result_promise.js";
import {isDateDefinitelyLessThanWithUncertaintyWindow} from "~/shared/helpers/date/is_date_less_than_with_uncertainty_window.js";
import {mapIterable} from "~/shared/helpers/iterable/map_iterable.js";
import {quote} from "~/shared/helpers/string/quote.js";
import {generateId} from "~/shared/id/id.js";
import {TraceId, TraceSpanId} from "~/shared/id/types/id_types.js";
import {Schema, SchemaType} from "~/shared/schema/schema.js";
import {TracerSpan} from "~/shared/tracer/tracer_span.js";

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
    {
        commitSha,
        workflowRunId,
        workflowRunAttempt,
    }: {
        commitSha: string;
        workflowRunId: number;
        workflowRunAttempt: number;
    },
): Promise<void> {
    const tracer = context.tracer.getRoot();

    assert(tracer.serviceName === "DeployService");

    const handleSpanName = "Deploy";
    const clock = new MonotonicClock(tracer.getNonMonotonicClock());

    // Request without tracing since we need the result of this request to
    // initialize our trace with the correct start time.
    const workflowRunJobsOutput = await context.github.quietlyRequestWithoutTracing(
        "GET /repos/{owner}/{repo}/actions/runs/{run_id}/attempts/{attempt_number}/jobs",
        {
            owner: githubOwner,
            repo: githubRepo,
            run_id: workflowRunId,
            attempt_number: workflowRunAttempt,
        },
    );
    assert(workflowRunJobsOutput.data.total_count === 1);
    const workflowRunJob = assertExists(workflowRunJobsOutput.data.jobs[0]);

    const traceId = generateId<TraceId>();
    const rootSpanId = generateId<TraceSpanId>();

    const {span: rootSpan, finishSpan: finishRootSpan} = TracerSpan._start(
        tracer,
        clock,
        `Handle: ${handleSpanName}`,
        {traceId},
        rootSpanId,
        new Date(workflowRunJob.started_at).getTime(),
    );

    rootSpan.addData({
        github: {
            workflow: {
                run: {
                    id: workflowRunId,
                    attempt: workflowRunAttempt,
                    url: `https://github.com/${githubOwner}/${githubRepo}/actions/runs/${workflowRunId}`,
                },
            },
        },
    });

    try {
        rootSpan.addPropagatedDataForChildrenOnly({context: {handler: handleSpanName}});

        for (const workflowRunJobStep of workflowRunJob.steps ?? []) {
            if (
                workflowRunJobStep.conclusion === null ||
                !workflowRunJobStep.started_at ||
                !workflowRunJobStep.completed_at
            ) {
                continue;
            }

            const {span, finishSpan} = TracerSpan._startWithEndTime(
                tracer,
                clock,
                workflowRunJobStep.name,
                {
                    traceId,
                    parentId: rootSpanId,
                    propagatedEventData: rootSpan._getPropagatedEventData(),
                    propagatedEventFlatData: rootSpan._getPropagatedEventFlatData(),
                },
                generateId<TraceSpanId>(),
                new Date(workflowRunJobStep.started_at).getTime(),
            );

            if (workflowRunJobStep.conclusion !== "success") {
                span.addException(
                    new UnknownError(
                        quote`Job step completed with ${workflowRunJobStep.conclusion}`,
                    ),
                );
            }

            finishSpan(new Date(workflowRunJobStep.completed_at).getTime());
        }

        await context.with({tracer: new TracerContextModule(rootSpan)}, context =>
            actuallyDeploy(context, {
                commitSha,
                workflowRunId,
            }),
        );

        finishRootSpan();
    } catch (error) {
        rootSpan.addException(error);
        finishRootSpan();
        throw error;
    }

    return context.tracer.withSpan(`Handle: ${handleSpanName}`, (context, span) => {
        span.addPropagatedDataForChildrenOnly({context: {handler: handleSpanName}});
        return actuallyDeploy(context, {commitSha, workflowRunId});
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
    }: {
        commitSha: string;
        workflowRunId: number;
    },
) {
    const deployItem = await context.tracer.withSpan("Prepare deploy", context =>
        prepareDeploy(context, {
            commitSha,
            workflowRunId,
        }),
    );

    const result = await captureResultPromise(async () => {
        const {manifest, paths} = await context.tracer.withSpan(
            "Upload app static files",
            context => uploadAppStaticFilesBeforeDeploy(context),
        );

        // TODO(calebmer, #deploy): I stashed the changes that serve Cloudflare R2
        // files in production. Get the stash back and run a deploy.

        // TODO(calebmer, #deploy): Cloudflare Workers deploy with `wrangler`.

        await context.tracer.withSpan("Cleanup app static files", context =>
            cleanupAppStaticFilesAfterDeploy(context, {manifest, paths}),
        );

        // TODO(calebmer, #deploy): Add marker to Honeycomb at start or end of deploy.
    });

    await cleanupDeploy(context, {
        commitSha,
        workflowRunId,
        result,
        initialItem: deployItem,
    });

    unwrapResult(result);
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
        if (isCloudflareR2NoSuchKeyError(error)) {
            oldManifest = {files: []};
        } else {
            throw error;
        }
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

    const rootPath = joinPath(runfilesPath, "cyberworlds/app/static");
    await traverse("", rootPath);

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
                Body: fs.createReadStream(joinPath(rootPath, newFile.path)),
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
