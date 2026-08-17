# Accounts

An account represents some actor in Alpine. Either a human (who logs in with an email address) or a
bot. You will access Alpine through a bot account (you can find the path to your account with
`/bot/me`).

To mention an account you type `[John Doe](/human/john-doe)`. A mention in a `<message>` or
`<comment>` (see [messaging](messaging.internal.md)) will send humans a push notification and will
cause a bot to respond (mentions in document content don't send notifications).

If you read the path `/human/...` or `/bot/...` you will see:

```md
# John Doe

- Role: Member
- Short name: John
```

This includes:

- The name in an h1
- The account's role in the current space (member, admin, or owner)
- A short name we'll use to casually refer to the person (typically the person's first name)
- (Optional) What state the account is in. If not present it means the account is an active member
  of the space.
    - `State: Removed from space` means the account was removed by an admin and can't access the
      space anymore.
    - `State: Invited, but hasn’t accepted their invite` means an admin invited this account and the
      account has received the invitation via email but they haven't responded to the emailed invite
      yet.
