/* eslint-disable no-console */

import {createFathomMeetingNotesContent} from "~/admin/lambda/fathom_meeting_notes/internal/create_fathom_meeting_notes_content.js";
import {FathomWebhookPayload} from "~/admin/lambda/fathom_meeting_notes/internal/fathom_webhook_payload_types.js";
import {fetchFathomMeetingNotesAlpineApi} from "~/admin/lambda/fathom_meeting_notes/internal/fetch_fathom_meeting_notes_alpine_api.js";
import {getFathomMeetingNotesCreatorAccountId} from "~/admin/lambda/fathom_meeting_notes/internal/get_fathom_meeting_notes_creator_account_id.js";
import {getFathomMeetingNotesMonthDocumentIds} from "~/admin/lambda/fathom_meeting_notes/internal/get_fathom_meeting_notes_month_document_ids.js";
import {getFathomMeetingNotesParentDocumentId} from "~/admin/lambda/fathom_meeting_notes/internal/get_fathom_meeting_notes_parent_document_id.js";
import {insertFathomMeetingNotesMention} from "~/admin/lambda/fathom_meeting_notes/internal/insert_fathom_meeting_notes_mention.js";
import {isPublicFathomMeeting} from "~/admin/lambda/fathom_meeting_notes/internal/is_public_fathom_meeting.js";
import {ApiGetDocumentResponse} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {ApiSpecification} from "~/shared/api/specification/types/api_specification_types.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";

type ApiCreateDocumentRequestBody =
    ApiSpecification.paths["/documents"]["post"]["requestBody"]["content"]["application/json"];
type ApiPatchDocumentRequestBody =
    ApiSpecification.paths["/documents/{id}"]["patch"]["requestBody"]["content"]["application/json"];

export type ProcessFathomMeetingNotesResult =
    | {
          readonly ok: true;
          readonly documentId: string;
          readonly alreadyProcessed: boolean;
      }
    | {readonly ok: false; readonly error: string; readonly statusCode: number};

/**
 * Creates one meeting-notes document and adds public meetings to the hard-coded
 * notes index.
 */
export async function processFathomMeetingNotes(
    payload: FathomWebhookPayload,
): Promise<ProcessFathomMeetingNotesResult> {
    const parentDocumentId = getFathomMeetingNotesParentDocumentId();
    const meetingNotes = createFathomMeetingNotesContent(payload);
    const isPublicMeeting = isPublicFathomMeeting(payload);
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
                documentId,
                alreadyProcessed: true,
            };
        }
    }

    if (isPublicMeeting) {
        console.log("Creating public meeting notes", {
            transcript: payload.transcript ?? null,
            summary: payload.default_summary?.markdown_formatted ?? null,
        });
        // TODO: Set a public access policy once the documents API supports access
        // policies. Until then, the Josh-scoped API key keeps this document private.
    } else {
        console.log("Creating private meeting notes");
        // TODO: Share only with Josh Johnson once the documents API supports access
        // policies. The creator field is attribution, not an access policy.
    }

    const createRequest: ApiCreateDocumentRequestBody = {
        spaceId: parentResult.value.spaceId,
        document: {
            title: meetingNotes.title,
            creator: {id: getFathomMeetingNotesCreatorAccountId()},
            content: meetingNotes.content,
        },
    };
    const createResult = await fetchFathomMeetingNotesAlpineApi<ApiGetDocumentResponse>(
        "/documents",
        {method: "POST", body: createRequest},
    );
    if (!createResult.ok) return createResult;

    if (!isPublicMeeting) {
        // TODO: Persist Fathom webhook IDs so a retry of a private meeting can find the
        // document without exposing it in the public index.
        return {
            ok: true,
            documentId: createResult.value.document.id,
            alreadyProcessed: false,
        };
    }

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
        documentId: createResult.value.document.id,
        alreadyProcessed: false,
    };
}
