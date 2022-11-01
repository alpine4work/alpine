"use client";

import {useRouter} from "next/navigation";
import {emptyDocumentContent} from "~/shared/documents/document-content-schema";
import {runPromiseWithoutAwaiting} from "~/shared/helpers/async/run-promise-without-awaiting";
import {generateId} from "~/shared/id/id";
import {createDocument} from "~/shared/network/documents-network-definition";

// TODO(calebmer): Get rid of this page and replace it with something proper.
export default function HackyCreateDocumentPage() {
    const router = useRouter();

    return (
        <button
            onClick={() => {
                runPromiseWithoutAwaiting(async () => {
                    const documentId = generateId();

                    await createDocument({
                        id: documentId,
                        content: emptyDocumentContent,
                    });

                    router.push(`/documents/${documentId}`);
                });
            }}
        >
            Create document
        </button>
    );
}
