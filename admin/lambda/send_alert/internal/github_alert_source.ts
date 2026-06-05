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
    ApiContent,
    ApiContentCodeBlockElementTextInlineElement,
    ApiContentParagraphBlockElement,
} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {ApiSpecification} from "~/shared/api/specification/types/api_specification_types.js";

type ApiContentElement = ApiContent["elements"][number];

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

        if (data.workflow_run.conclusion !== "failure") {
            console.debug(
                `Ignoring GitHub workflow_run with conclusion '${data.workflow_run.conclusion}'`,
            );
            return {ok: true};
        }

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

        return await this.postAlertToAlpine(channel, {elements});
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

        const commitsElements: ApiContentParagraphBlockElement["elements"] =
            data.commits.length === 1
                ? [
                      {
                          type: "Text",
                          text: "1 commit pushed to ",
                      },
                      {
                          type: "Text",
                          text: "main",
                          marks: [
                              {
                                  type: "Code",
                              },
                          ],
                      },
                  ]
                : [
                      {
                          type: "Text",
                          text: `${data.commits.length} commits`,
                          marks: [
                              {
                                  type: "Link",
                                  url: data.compare,
                              },
                          ],
                      },
                      {
                          type: "Text",
                          text: " pushed to ",
                      },
                      {
                          type: "Text",
                          text: "main",
                          marks: [
                              {
                                  type: "Code",
                              },
                          ],
                      },
                  ];

        const commitLines: Array<Array<ApiContentCodeBlockElementTextInlineElement>> =
            data.commits.map(commit => {
                const commitMessageTitle = commit.message.split("\n", 1)[0] || commit.message;
                const commitAuthorElement: ApiSpecification.components["schemas"]["ContentInlineElement"] =
                    commit.author.username
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
                const commitAuthorName =
                    commitAuthorElement.type === "Text"
                        ? commitAuthorElement.text
                        : commit.author.name;

                return [
                    {
                        type: "Text",
                        text: commit.id.substring(0, 7),
                        marks: [
                            {
                                type: "Link",
                                url: commit.url,
                            },
                        ],
                    },
                    {
                        type: "Text",
                        text: " ",
                    },
                    ...createCommitMessageElements(commitMessageTitle, data.repository.full_name),
                    {
                        type: "Text",
                        text: ` by ${commitAuthorName}`,
                    },
                ];
            });

        const elements: Array<ApiContentElement> = [
            {
                type: "Paragraph",
                elements: commitsElements,
            },
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
                        text: " • Pushed by ",
                    },
                    createUserElement(data.sender.login, data.sender.html_url, data.sender.login, {
                        tagUser: false,
                    }),
                ],
            },
            {
                type: "Code",
                language: "text",
                lines: commitLines.map(commitLine => ({
                    elements: commitLine,
                })),
            },
        ];

        return await this.postAlertToAlpine(channel, {elements});
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
