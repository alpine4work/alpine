import {useNavigate, useParams} from "react-router-dom";
import {useAppContext} from "~/client/context/app_context";
import {Box} from "~/client/design/box";
import {Button} from "~/client/design/button";
import {emptyDocumentContent} from "~/shared/content/document_content_schema";
import {dummyDocumentContent} from "~/shared/content/dummy_document_content";
import {generateId} from "~/shared/id/id";
import {DocumentId, SpaceId} from "~/shared/id/types/id_types";
import {createDocument} from "~/shared/rpc/documents_rpc_definitions";
import {Schema} from "~/shared/schema/schema";

export default function CreateDocumentRoute() {
    const context = useAppContext();
    const navigate = useNavigate();

    const params = useParams();
    const spaceId = Schema.id<SpaceId>().deserialize(params.space_id ?? null);

    return (
        <Box padding="7" display="flex" flexDirection="column" gap="5" alignItems="center">
            <Button
                onPress={async () => {
                    const documentId = generateId<DocumentId>();

                    await createDocument(context, {
                        id: documentId,
                        spaceId,
                        content: emptyDocumentContent,
                    });

                    navigate(`/s/${spaceId}/documents/${documentId}`);
                }}
            >
                Create empty document
            </Button>
            <Button
                onPress={async () => {
                    const documentId = generateId<DocumentId>();

                    await createDocument(context, {
                        id: documentId,
                        spaceId,
                        content: dummyDocumentContent(),
                    });

                    navigate(`/s/${spaceId}/documents/${documentId}`);
                }}
            >
                Create document with dummy content
            </Button>
        </Box>
    );
}
