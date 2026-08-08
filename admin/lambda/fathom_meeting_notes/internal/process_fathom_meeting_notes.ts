/* eslint-disable no-console */

import {createFathomMeetingNotesContent} from "~/admin/lambda/fathom_meeting_notes/internal/create_fathom_meeting_notes_content.js";
import {FathomWebhookPayload} from "~/admin/lambda/fathom_meeting_notes/internal/fathom_webhook_payload_types.js";
import {fetchFathomMeetingNotesAlpineApi} from "~/admin/lambda/fathom_meeting_notes/internal/fetch_fathom_meeting_notes_alpine_api.js";
import {getFathomMeetingNotesMonthDocumentIds} from "~/admin/lambda/fathom_meeting_notes/internal/get_fathom_meeting_notes_month_document_ids.js";
import {getFathomMeetingNotesParentDocumentId} from "~/admin/lambda/fathom_meeting_notes/internal/get_fathom_meeting_notes_parent_document_id.js";
import {insertFathomMeetingNotesMention} from "~/admin/lambda/fathom_meeting_notes/internal/insert_fathom_meeting_notes_mention.js";
import {isPublicFathomMeeting} from "~/admin/lambda/fathom_meeting_notes/internal/is_public_fathom_meeting.js";
import {ApiGetDocumentResponse} from "~/shared/api/specification/types/api_specification_convenience_types.open_source.js";
import {ApiSpecification} from "~/shared/api/specification/types/api_specification_types.open_source.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.open_source.js";

type ApiCreateDocumentRequestBody =
    ApiSpecification.paths["/documents"]["post"]["requestBody"]["content"]["application/json"];
type ApiPatchDocumentRequestBody =
    ApiSpecification.paths["/documents/{id}"]["patch"]["requestBody"]["content"]["application/json"];

export type ProcessFathomMeetingNotesResult =
    | {
          readonly ok: true;
          readonly outcome: "created";
          readonly documentId: string;
      }
    | {
          readonly ok: true;
          readonly outcome: "already_processed";
          readonly documentId: string;
      }
    | {readonly ok: true; readonly outcome: "ignored"}
    | {readonly ok: false; readonly error: string; readonly statusCode: number};

/**
 * Creates and indexes meeting notes for public-facing Alpine meetings.
 */
export async function processFathomMeetingNotes(
    payload: FathomWebhookPayload,
): Promise<ProcessFathomMeetingNotesResult> {
    if (!isPublicFathomMeeting(payload)) {
        console.log("Ignoring non-public Fathom meeting");
        return {ok: true, outcome: "ignored"};
    }

    const parentDocumentId = getFathomMeetingNotesParentDocumentId();
    const meetingNotes = createFathomMeetingNotesContent(payload);
    const parentResult = await fetchFathomMeetingNotesAlpineApi<ApiGetDocumentResponse>(
        `/documents/${parentDocumentId}`,
        {method: "GET"},
    );
    if (!parentResult.ok) return parentResult;

    const monthDocumentIds = getFathomMeetingNotesMonthDocumentIds({
        content: parentResult.value.document.content,
        scheduledStartTime: payload.scheduled_start_time,
    });
    const monthDocumentResults = await runAllPromises(
        monthDocumentIds.map(async documentId => ({
            documentId,
            documentResult: await fetchFathomMeetingNotesAlpineApi<ApiGetDocumentResponse>(
                `/documents/${documentId}`,
                {method: "GET"},
            ),
        })),
    );
    for (const {documentId, documentResult} of monthDocumentResults) {
        if (!documentResult.ok) {
            if (documentResult.statusCode === 404) continue;
            return documentResult;
        }

        const hasMatchingRecordingLink = documentResult.value.document.content.elements.some(
            element =>
                element.type === "Paragraph" &&
                element.elements.some(
                    inlineElement =>
                        inlineElement.type === "Text" &&
                        inlineElement.marks?.some(
                            mark => mark.type === "Link" && mark.url === payload.share_url,
                        ),
                ),
        );
        if (hasMatchingRecordingLink) {
            return {
                ok: true,
                outcome: "already_processed",
                documentId,
            };
        }
    }

    console.log("Creating public meeting notes", {
        transcript: payload.transcript ?? null,
        summary: payload.default_summary?.markdown_formatted ?? null,
    });

    const createRequest: ApiCreateDocumentRequestBody = {
        spaceId: parentResult.value.spaceId,
        document: {
            title: meetingNotes.title,
            content: meetingNotes.content,
        },
    };
    const createResult = await fetchFathomMeetingNotesAlpineApi<ApiGetDocumentResponse>(
        "/documents",
        {method: "POST", body: createRequest},
    );
    if (!createResult.ok) return createResult;

    const insertion = insertFathomMeetingNotesMention({
        content: parentResult.value.document.content,
        documentId: createResult.value.document.id,
        scheduledStartTime: payload.scheduled_start_time,
    });
    const patchRequest: ApiPatchDocumentRequestBody = {
        patches: [
            {
                type: "SetContent",
                version: parentResult.value.document.version,
                content: insertion.content,
            },
        ],
    };
    const patchResult = await fetchFathomMeetingNotesAlpineApi<ApiGetDocumentResponse>(
        `/documents/${parentDocumentId}`,
        {method: "PATCH", body: patchRequest},
    );
    if (!patchResult.ok) return patchResult;

    return {
        ok: true,
        outcome: "created",
        documentId: createResult.value.document.id,
    };
}
