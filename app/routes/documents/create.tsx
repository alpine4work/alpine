import {useNavigate} from "react-router-dom";
import {emptyDocumentContent} from "~/shared/documents/document-content-schema";
import {runPromiseWithoutAwaiting} from "~/shared/helpers/async/run-promise-without-awaiting";
import {generateId} from "~/shared/id/id";
import {createDocument} from "~/shared/network/documents-network-definition";

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
