import {useNavigate, useParams} from "react-router-dom";
import {Box} from "~/client/design/box";
import {Button} from "~/client/design/button";
import {emptyDocumentContent} from "~/shared/documents/document_content_schema";
import {dummyDocumentContent} from "~/shared/documents/dummy_document_content";
import {runPromiseWithoutAwaiting} from "~/shared/helpers/async/run_promise_without_awaiting";
import {generateId} from "~/shared/id/id";
import {createDocument} from "~/shared/network/documents_network_definition";
import {Schema} from "~/shared/schema/schema";

// TODO(calebmer): Should not be able to access this route if you do not have
// access to the space!
export default function CreateDocumentRoute() {
    const navigate = useNavigate();

    const params = useParams();
    const spaceId = Schema.id.deserialize(params.space_id ?? null);

    return (
        <Box padding="7" display="flex" flexDirection="column" gap="5" alignItems="center">
            <Button
                onPress={() => {
                    runPromiseWithoutAwaiting(async () => {
                        const documentId = generateId();

                        await createDocument({
                            id: documentId,
                            spaceId,
                            content: emptyDocumentContent,
                        });

                        navigate(`/s/${spaceId}/documents/${documentId}`);
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
                            spaceId,
                            content: dummyDocumentContent(),
                        });

                        navigate(`/s/${spaceId}/documents/${documentId}`);
                    });
                }}
            >
                Create document with dummy content
            </Button>
        </Box>
    );
}
