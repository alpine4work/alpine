import {useRouter} from "next/router";
import {emptyDocumentContent} from "~/shared/content/document-content-schema";
import {generateId} from "~/shared/id/id";
import {createDocument} from "~/shared/rpc/documents-rpc-definition";

// TODO(calebmer): Get rid of this page and replace it with something proper.
export default function HackyCreateDocumentPage() {
    const router = useRouter();

    return (
        <button
            onClick={() => {
                void (async () => {
                    const documentId = generateId();

                    await createDocument({
                        id: documentId,
                        content: emptyDocumentContent,
                    });

                    await router.push(`/document/${documentId}`);
                })();
            }}
        >
            Create document
        </button>
    );
}
