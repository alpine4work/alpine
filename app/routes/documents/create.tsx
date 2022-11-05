import {useNavigate} from "react-router-dom";
import {emptyDocumentContent} from "~/shared/documents/document_content_schema";
import {runPromiseWithoutAwaiting} from "~/shared/helpers/async/run_promise_without_awaiting";
import {generateId} from "~/shared/id/id";
import {createDocument} from "~/shared/network/documents_network_definition";

export default function CreateDocumentRoute() {
    const navigate = useNavigate();

    return (
        <button
            onClick={() => {
                runPromiseWithoutAwaiting(async () => {
                    const documentId = generateId();

                    await createDocument({
                        id: documentId,
                        content: emptyDocumentContent,
                    });

                    navigate(`/documents/${documentId}`);
                });
            }}
        >
            Create document
        </button>
    );
}
