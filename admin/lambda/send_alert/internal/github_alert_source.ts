/* eslint-disable cyberworlds/string-quotes */
/* eslint-disable no-console */

import {createHmac, timingSafeEqual} from "crypto";
import {AlertSource} from "~/admin/lambda/send_alert/internal/alert_source.js";
import {
    AlertSourceAuthorizationResult,
    SendAlertResult,
} from "~/admin/lambda/send_alert/internal/alert_source_types.js";
import {createCommitMessageElements} from "~/admin/lambda/send_alert/internal/create_commit_message_elements.js";
import {createHeaderElements} from "~/admin/lambda/send_alert/internal/create_header_elements.js";
import {createUserElement} from "~/admin/lambda/send_alert/internal/create_user_element.js";
import {
    GitHubEventPayload,
    GitHubPushEventPayload,
    GitHubWorkflowRunEventPayload,
} from "~/admin/lambda/send_alert/internal/github_alert_source_types.js";
import {
    SendAlertAvailableChannel,
    sendAlertAvailableChannels,
} from "~/admin/lambda/send_alert/internal/send_alert_available_channels.js";
import {
    ApiContent,
    ApiContentParagraphBlockElement,
    ApiGetChannelResponse,
    ApiGetMessageResponse,
    ApiPostResponse,
} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {ApiSpecification} from "~/shared/api/specification/types/api_specification_types.js";

type ApiContentElement = ApiContent["elements"][number];
type ApiCreatePostMessageRequestBody =
    ApiSpecification.components["requestBodies"]["CreateMessage"]["content"]["application/json"];
type ApiSearchResponse =
    ApiSpecification.paths["/spaces/{id}/search"]["get"]["responses"]["200"]["content"]["application/json"];
type ApiPostId = ApiPostResponse["id"];

// You can find the GitHub `workflow_id` with the CLI command `gh workflow list`.
const deployGithubWorkflowId = 111000643;

type WorkflowRunCommitCommentStatus = "success" | "failure";

export class GitHubAlertSource extends AlertSource {
    override validateAuthorization(): AlertSourceAuthorizationResult {
        const gitHubWebhookSecret = process.env.GITHUB_ACTIONS_WEBHOOK_SECRET;
        if (!gitHubWebhookSecret) {
            return {
                ok: false,
                statusCode: 500,
                error: "GITHUB_ACTIONS_WEBHOOK_SECRET environment variable is not set",
            };
        }

        const gitHubSignature = this.request.headers["x-hub-signature-256"];
        const body = this.request.body;
        if (
            !body ||
            !gitHubSignature ||
            !this.verifySignature(body, gitHubSignature, gitHubWebhookSecret)
        ) {
            return {
                ok: false,
                statusCode: 401,
                error: "Invalid signature",
            };
        }

        return {ok: true};
    }

    override async handlePayload(payload: unknown): Promise<SendAlertResult> {
        const eventType = this.request.headers["x-github-event"];
        if (!eventType) {
            return {
                ok: false,
                error: "Missing X-GitHub-Event header",
                statusCode: 400,
            };
        }

        const data = {
            type: eventType,
            ...(payload as object),
        } as GitHubEventPayload;

        switch (data.type) {
            case "workflow_run":
                return await this.handleWorkflowRunPayload(data);
            case "push":
                return await this.handlePushPayload(data);
            default:
                console.debug(`Ignoring GitHub event of type '${eventType}'`);
                return {ok: true};
        }
    }

    private async handleWorkflowRunPayload(
        data: GitHubWorkflowRunEventPayload,
    ): Promise<SendAlertResult> {
        const channel = "builds";

        console.log("Received GitHub workflow_run event");
        console.log(JSON.stringify(data, null, 2));

        if (data.workflow_run.head_branch !== "main") {
            console.debug(
                `Ignoring GitHub workflow_run event on branch '${data.workflow_run.head_branch}'`,
            );
            return {ok: true};
        }

        if (data.action !== "completed") {
            console.debug(`Ignoring GitHub workflow_run action '${data.action}'`);
            return {ok: true};
        }

        let buildsChannelPostId: ApiPostId | undefined;

        if (data.workflow_run.conclusion === "failure") {
            const elements: Array<ApiContentElement> = [
                ...createHeaderElements(`🚨 Build failed: ${data.workflow_run.name}`, [
                    {label: "View Run", url: data.workflow_run.html_url},
                ]),
                {
                    type: "Paragraph",
                    elements: [
                        {
                            type: "Text",
                            text: "Repository: ",
                        },
                        {
                            type: "Text",
                            text: data.repository.name,
                            marks: [
                                {
                                    type: "Link",
                                    url: data.repository.html_url,
                                },
                            ],
                        },
                        {
                            type: "Text",
                            text: " • Commit: ",
                        },
                        {
                            type: "Text",
                            text: data.workflow_run.head_sha.substring(0, 7),
                            marks: [
                                {
                                    type: "Code",
                                },
                                {
                                    type: "Link",
                                    url: `${data.repository.html_url}/commit/${data.workflow_run.head_sha}`,
                                },
                            ],
                        },
                    ],
                },
                {
                    type: "Quote",
                    elements: [
                        {
                            type: "Paragraph",
                            elements: createCommitMessageElements(
                                data.workflow_run.head_commit.message,
                                data.repository.full_name,
                            ),
                        },
                    ],
                },
                {
                    type: "Paragraph",
                    elements: [
                        {
                            type: "Text",
                            text: "Author: ",
                        },
                        createUserElement(
                            data.workflow_run.head_commit.author.name,
                            `https://github.com/${data.workflow_run.head_commit.author.name}`,
                            data.workflow_run.head_commit.author.name,
                        ),
                        {
                            type: "Text",
                            text: " • Triggered by: ",
                        },
                        createUserElement(
                            data.workflow_run.triggering_actor.login,
                            data.workflow_run.triggering_actor.html_url,
                            data.workflow_run.triggering_actor.login,
                        ),
                    ],
                },
            ];

            const postResult = await this.createPostInAlpine(channel, {elements});

            if (!postResult.ok) {
                return postResult;
            }

            buildsChannelPostId = postResult.value.post.id;
            console.log(`Created builds channel post with ID: ${buildsChannelPostId}`);
        }

        const commitCommentStatus = this.getWorkflowRunCommitCommentStatus(data);
        if (commitCommentStatus) {
            await this.commentOnPostsWithCommitHash(
                data.workflow_run.head_sha,
                commitCommentStatus,
                data.workflow_run.name,
                data.workflow_run.html_url,
                buildsChannelPostId,
            );
        }

        return {ok: true};
    }

    private getWorkflowRunCommitCommentStatus(
        data: GitHubWorkflowRunEventPayload,
    ): WorkflowRunCommitCommentStatus | null {
        if (data.workflow_run.conclusion === "failure") {
            return "failure";
        }

        switch (data.workflow_run.workflow_id) {
            case deployGithubWorkflowId:
                return data.workflow_run.conclusion === "success" ? "success" : null;
            default:
                return null;
        }
    }

    private async commentOnPostsWithCommitHash(
        commitHash: string,
        status: WorkflowRunCommitCommentStatus,
        workflowName: string,
        workflowUrl: string,
        buildsChannelPostId?: ApiPostId,
    ): Promise<void> {
        try {
            const shortHash = commitHash.substring(0, 7);
            const spaceId = await this.getSpaceIdFromChannel("github");
            if (!spaceId) {
                console.error("Could not determine space ID for searching posts");
                return;
            }

            const searchQuery = shortHash;
            const searchResult = await this.fetchAlpineApi<ApiSearchResponse>(
                `/spaces/${spaceId}/search?query=${encodeURIComponent(searchQuery)}`,
                {
                    method: "GET",
                },
            );

            if (!searchResult.ok) {
                console.error("Failed to search for posts with commit hash:", searchResult.error);
                return;
            }

            // Searching only for the hash intentionally finds every post that mentions the
            // commit, including any Builds failure posts created for it.
            const posts = searchResult.value.results.filter(
                result =>
                    result.type === "Post" &&
                    result.bodySnippet !== null &&
                    result.bodySnippet.text.includes(shortHash),
            );

            if (posts.length === 0) {
                console.log(`No posts found containing commit hash ${shortHash}`);
                return;
            }

            console.log(`Found ${posts.length} post(s) with commit hash ${shortHash}`);

            for (const post of posts) {
                let commentBody: ApiCreatePostMessageRequestBody;

                if (status === "success") {
                    commentBody = {
                        content: {
                            elements: [
                                {
                                    type: "Paragraph",
                                    elements: [
                                        {
                                            type: "Text",
                                            text: "✅ Deploy succeeded: ",
                                        },
                                        {
                                            type: "Text",
                                            text: shortHash,
                                            marks: [
                                                {
                                                    type: "Code",
                                                },
                                                {
                                                    type: "Link",
                                                    url: workflowUrl,
                                                },
                                            ],
                                        },
                                    ],
                                },
                            ],
                        },
                    };
                } else {
                    if (!buildsChannelPostId) {
                        console.error(
                            "No builds channel post ID provided for failure notification",
                        );
                        continue;
                    }

                    commentBody = {
                        content: {elements: []},
                        files: [
                            {
                                element: {
                                    type: "Preview",
                                    reference: {
                                        type: "Post",
                                        id: buildsChannelPostId,
                                    },
                                },
                            },
                        ],
                    };
                }

                const commentResult = await this.fetchAlpineApi<ApiGetMessageResponse>(
                    `/posts/${post.id}/messages`,
                    {
                        method: "POST",
                        body: commentBody,
                    },
                );

                if (commentResult.ok) {
                    console.log(`Commented on post ${post.id} with deploy status`);
                } else {
                    console.error(`Failed to comment on post ${post.id}:`, commentResult.error);
                }
            }
        } catch (error) {
            console.error("Error commenting on posts with commit hash:", error);
        }
    }

    private async getSpaceIdFromChannel(
        channel: SendAlertAvailableChannel,
    ): Promise<ApiGetChannelResponse["spaceId"] | null> {
        try {
            const channelId = sendAlertAvailableChannels[channel];
            const result = await this.fetchAlpineApi<ApiGetChannelResponse>(
                `/channels/${channelId}`,
                {method: "GET"},
            );

            if (!result.ok) {
                console.error("Failed to get space ID from channel:", result.error);
                return null;
            }

            return result.value.spaceId;
        } catch (error) {
            console.error("Error getting space ID from channel:", error);
            return null;
        }
    }

    private async handlePushPayload(data: GitHubPushEventPayload): Promise<SendAlertResult> {
        const channel = "github";

        console.log("Received GitHub push event");
        console.log(JSON.stringify(data, null, 2));

        if (data.ref !== "refs/heads/main") {
            console.debug(`Ignoring GitHub push event on ref '${data.ref}'`);
            return {ok: true};
        }

        if (data.deleted) {
            console.debug("Ignoring GitHub push event that deleted main");
            return {ok: true};
        }

        if (data.commits.length === 0) {
            console.debug("Ignoring GitHub push event with no commits");
            return {ok: true};
        }

        let pusherElement = createUserElement(
            data.sender.login,
            data.sender.html_url,
            data.sender.login,
            {tagUser: false},
        );

        if (data.sender.login === "graphite-app[bot]") {
            if (this.commitsHaveSameAuthor(data.commits)) {
                pusherElement = this.createCommitAuthorElement(data.commits[0]!);
            }
        }

        const elements: Array<ApiContentElement> =
            data.commits.length === 1
                ? this.createSingleCommitPushElements(data, pusherElement)
                : this.createMultiCommitPushElements(data, pusherElement);

        return await this.postAlertToAlpine(channel, {elements});
    }

    private createSingleCommitPushElements(
        data: GitHubPushEventPayload,
        pusherElement: ApiSpecification.components["schemas"]["ContentInlineElement"],
    ): Array<ApiContentElement> {
        const commit = data.commits[0]!;
        const commitMessageTitle = commit.message.split("\n", 1)[0] || commit.message;
        const trailingPrReferenceMatch = commitMessageTitle.match(/\s*\(#(\d+)\)$/);

        const commitMessageTitleWithoutTrailingPr = trailingPrReferenceMatch
            ? commitMessageTitle.substring(0, trailingPrReferenceMatch.index).trimEnd()
            : commitMessageTitle;

        const shortHash = commit.id.substring(0, 7);

        const summaryElements: Array<ApiContentParagraphBlockElement["elements"][number]> = [
            pusherElement,
            {
                type: "Text",
                text: " pushed: ",
            },
            ...createCommitMessageElements(
                commitMessageTitleWithoutTrailingPr,
                data.repository.full_name,
            ),
            {
                type: "Text",
                text: " (",
            },
        ];

        if (trailingPrReferenceMatch) {
            summaryElements.push({
                type: "Text",
                text: `#${trailingPrReferenceMatch[1]}`,
                marks: [
                    {
                        type: "Link",
                        url: `https://app.graphite.com/github/pr/${data.repository.full_name}/${trailingPrReferenceMatch[1]}`,
                    },
                ],
            });
            summaryElements.push({
                type: "Text",
                text: ", ",
            });
        }

        summaryElements.push({
            type: "Text",
            text: shortHash,
            marks: [
                {
                    type: "Link",
                    url: commit.url,
                },
            ],
        });
        summaryElements.push({
            type: "Text",
            text: ")",
        });

        return [
            {
                type: "Paragraph",
                elements: summaryElements,
            },
        ];
    }

    private createMultiCommitPushElements(
        data: GitHubPushEventPayload,
        pusherElement: ApiSpecification.components["schemas"]["ContentInlineElement"],
    ): Array<ApiContentElement> {
        const includeCommitAuthors = !this.commitsHaveSameAuthor(data.commits);
        const commitElements: Array<ApiContentElement> = data.commits.map(commit => {
            const commitMessageTitle = commit.message.split("\n", 1)[0] || commit.message;
            const trailingPrReferenceMatch = commitMessageTitle.match(/\s*\(#(\d+)\)$/);

            const commitMessageTitleWithoutTrailingPr = trailingPrReferenceMatch
                ? commitMessageTitle.substring(0, trailingPrReferenceMatch.index).trimEnd()
                : commitMessageTitle;

            const commitAuthorElement = this.createCommitAuthorElement(commit);

            const shortHash = commit.id.substring(0, 7);

            const elements: Array<ApiContentParagraphBlockElement["elements"][number]> =
                includeCommitAuthors
                    ? [
                          commitAuthorElement,
                          {
                              type: "Text",
                              text: ": ",
                          },
                          ...createCommitMessageElements(
                              commitMessageTitleWithoutTrailingPr,
                              data.repository.full_name,
                          ),
                          {
                              type: "Text",
                              text: " (",
                          },
                      ]
                    : [
                          ...createCommitMessageElements(
                              commitMessageTitleWithoutTrailingPr,
                              data.repository.full_name,
                          ),
                          {
                              type: "Text",
                              text: " (",
                          },
                      ];

            if (trailingPrReferenceMatch) {
                elements.push({
                    type: "Text",
                    text: `#${trailingPrReferenceMatch[1]}`,
                    marks: [
                        {
                            type: "Link",
                            url: `https://app.graphite.com/github/pr/${data.repository.full_name}/${trailingPrReferenceMatch[1]}`,
                        },
                    ],
                });
                elements.push({
                    type: "Text",
                    text: ", ",
                });
            }

            elements.push({
                type: "Text",
                text: shortHash,
                marks: [
                    {
                        type: "Link",
                        url: commit.url,
                    },
                ],
            });
            elements.push({
                type: "Text",
                text: ")",
            });

            return {
                type: "Paragraph" as const,
                elements,
            };
        });

        return [
            {
                type: "Paragraph",
                elements: [
                    pusherElement,
                    {
                        type: "Text",
                        text: ` pushed ${data.commits.length} commits`,
                        marks: [
                            {
                                type: "Link",
                                url: data.compare,
                            },
                        ],
                    },
                    {
                        type: "Text",
                        text: ":",
                    },
                ],
            },
            ...commitElements,
        ];
    }

    private commitsHaveSameAuthor(
        commits: ReadonlyArray<GitHubPushEventPayload["commits"][number]>,
    ): boolean {
        const firstCommitAuthor = commits[0]!.author;
        return commits.every(
            commit =>
                commit.author.name === firstCommitAuthor.name &&
                commit.author.email === firstCommitAuthor.email &&
                commit.author.username === firstCommitAuthor.username,
        );
    }

    private createCommitAuthorElement(
        commit: GitHubPushEventPayload["commits"][number],
    ): ApiSpecification.components["schemas"]["ContentInlineElement"] {
        return commit.author.username
            ? createUserElement(
                  commit.author.name,
                  `https://github.com/${commit.author.username}`,
                  commit.author.username,
                  {tagUser: false},
              )
            : {
                  type: "Text",
                  text: commit.author.name,
              };
    }

    private verifySignature(
        rawBody: string,
        signatureHeader: string,
        webhookSecret: string,
    ): boolean {
        const hmac = createHmac("sha256", webhookSecret);
        hmac.update(rawBody);
        const expectedSignature = `sha256=${hmac.digest("hex")}`;
        const expectedSignatureBytes = new Uint8Array(Buffer.from(expectedSignature));
        const receivedSignatureBytes = new Uint8Array(Buffer.from(signatureHeader));

        if (expectedSignatureBytes.length !== receivedSignatureBytes.length) {
            return false;
        }

        return timingSafeEqual(expectedSignatureBytes, receivedSignatureBytes);
    }
}
