import {useNavigate} from "react-router-dom";
import {Box} from "~/client/design/box";
import {Button} from "~/client/design/button";
import {
    DocumentContentSchema,
    emptyDocumentContent,
} from "~/shared/documents/document_content_schema";
import {dummyDocumentContent} from "~/shared/documents/dummy_document_content";
import {runPromiseWithoutAwaiting} from "~/shared/helpers/async/run_promise_without_awaiting";
import {generateId} from "~/shared/id/id";
import {createDocument} from "~/shared/network/documents_network_definition";

export default function CreateDocumentRoute() {
    const navigate = useNavigate();

    return (
        <Box padding="7" display="flex" flexDirection="column" gap="5" alignItems="center">
            <Button
                onPress={() => {
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
                Create empty document
            </Button>
            <Button
                onPress={() => {
                    runPromiseWithoutAwaiting(async () => {
                        const documentId = generateId();

                        await createDocument({
                            id: documentId,
                            content: dummyDocumentContent(),
                        });

                        navigate(`/documents/${documentId}`);
                    });
                }}
            >
                Create document with dummy content
            </Button>
        </Box>
    );
}
