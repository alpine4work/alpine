import {generateId} from "~/shared/id/id";
import {DocumentNetworkChannel} from "~/shared/network/documents-network-definition";
import {getAblyChannelNameForNetworkChannel} from "~/shared/network/helpers/get-ably-channel-name-for-network-channel";

test("gets the right channel name for a simple channel", () => {
    const id = generateId();

    expect(getAblyChannelNameForNetworkChannel(DocumentNetworkChannel, {documentId: id})).toEqual(
        `network:Document:${id}`,
    );
});

test("escapes colons in key properties", () => {
    expect(
        getAblyChannelNameForNetworkChannel(DocumentNetworkChannel, {documentId: `foo:bar` as any}),
    ).toEqual(`network:Document:foo\\u003Abar`);
});

test("escapes asterisk in key properties", () => {
    expect(
        getAblyChannelNameForNetworkChannel(DocumentNetworkChannel, {documentId: `foo*bar` as any}),
    ).toEqual(`network:Document:foo\\u002Abar`);
});
