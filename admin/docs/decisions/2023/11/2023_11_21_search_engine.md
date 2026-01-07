# \[2023-11-21\] Search Engine

## Context

Alpine is a large product with a lot of functionality and content. Users need a fast way to navigate
between different parts of the product. We provide that capability through search. Search is easy to
open anywhere in the product (press shift twice) and you start typing what you want. You can use
your arrow keys to see a fully interactive preview in a peek of the search result before selecting
it. In order for this to lead to a fluid user experience, our search engine needs to be:

- **Fast:** The search dialog opens instantly and results pop up quickly as you’re typing.

- **Relevant:** The search results suggested to the user are precisely what they’re looking for.
  Even with a sloppy query. So they don’t need to spend mental energy carefully crafting the right
  search query.

- **Heterogenic:** There are many different kinds of content in Alpine. Chat messages, documents,
  tasks, forum posts, people. All of this content needs to be cleanly surfaced in search.

### Relevance signals

There are many relevance signals you could use when implementing a search engine. Search engines are
shown to improve when you mix multiple signals together. The signals we’ve decided to start our
search engine with are:

- **Keyword matching:** This forms the base layer of a search engine. Many search engines _only_
  provide keyword matching. State-of-the-art keyword matching
  [uses the BM25 algorithm](https://en.wikipedia.org/wiki/Okapi_BM25).

- **Semantic meaning:** You can use a large language model (like those provided by
  [OpenAI](https://openai.com/)) to more deeply understand the meaning of text. These approaches
  work by embedding text into a high dimensional vector then comparing document embeddings against
  search query embeddings to see which documents are closest to the query.

- **Affinity:** If there’s a document the user has interacted before and a document the user hasn’t
  interacted with before, it’s much more likely the user wants the document they’ve interacted with.
  A very common use case of search is to recall some piece of content the user has already seen.
  It’s less common that a user is using search to discover something new.

- **Natural language filtering:** If the user searches for “my tasks” they are probably looking for
  tasks they created. Not documents with the word “tasks” in it. Not documents written in first
  person (since there would be semantical similarity with “my”).

    This is not only a challenging technical problem (which is not solved well anywhere as far as
    I’m aware) but also a challenging UX problem. Since you need to communicate to the user what
    your search engine can and can’t filter on. You also should clearly communicate when you’re
    applying some filter so the user doesn’t get confused.

    Instead of trying to parse natural language, most search engines instead provide an “advanced
    search” option with a bunch of knobs to manually filter your search. This slows down the user
    when they go to search, especially on mobile where filling out a big form is impractical.

Some other notable search engine signals we won’t be implementing for now:

- **Authority:** Assign some perceived importance score to documents and return documents of higher
  importance first. This approach was famously used by the first version of Google. Their specific
  algorithm was called [PageRank](https://en.wikipedia.org/wiki/PageRank).

- **User behavior:** Boost search results that users consistently interact with. If two users have a
  similar query, it’s likely they’re looking for the same thing. You can leverage past usage data to
  help future users find documents faster.

    You can get fancy here by training a machine learning model that can predict the likelihood of a
    user interacting with a given search result based on past interactions. This is how
    [recommender systems](https://towardsdatascience.com/introduction-to-recommender-systems-6c66cf15ada)
    work (recommender systems power newsfeeds like Instagram and Twitter among other things).

- **Recency:** Newer content is likely more relevant to the user than older content. Using this as a
  relevance signal can be a double edged sword, though. Recent content may show up in the user’s
  inbox or home feed. If the user is going to search they may be looking for a more obscure, older,
  piece of content.

#### How did we choose the relevance signals to include vs exclude in this first version?

Keyword matching forms the base of just about every search engine. I’d bet for most queries, keyword
search is the most relevant signal. We add in semantic search since it’s been shown in research and
industry to
[improve result relevance](https://www.elastic.co/blog/why-technology-leaders-need-vector-search) in
combination with keyword search. (It also allows us to join the 2023/2024 AI hype wave.)

Affinity search we include since we want to show the user something before they’ve typed in a search
query. When they open the search dialog, they should instantly see relevant results. If we have a
user’s affinity scores for entities across the product, we might as well reuse those scores to
re-rank search results.

Being able to filter by metadata like content type (documents vs chat messages vs tasks),
contributors (emily updated, created by me), and time (updated recently, created last month) is an
important capability for our search engine. Other products in the productivity space have this
capability. We believe the best user experience is a simple text input, especially on mobile. It’ll
be a difficult technical problem to build great natural language search (and we’ll probably _also_
need some filtering UI to clearly communicate what’s happening) but we strongly believe it’s the
right product experience.

Given we only have six weeks to implement search, we don’t have time to implement other relevance
signals like authority for now.

## Decision

Since we need to search against many kinds of content, the first step is to develop a unified
representation of searchable content. We’ve named this representation **search entities**. The type
of a search entity is roughly as follows:

```ts
type SearchEntity = {
    readonly id: SearchEntityId;
    readonly accessPolicy: SearchEntityIndexAccessPolicy;
    readonly createdTime: Date;
    readonly lastUpdatedTime: Date;
    readonly title: string | null;
    readonly body: string | null;
    readonly media: SearchEntityMedia | null;
    readonly embeddingChunks: ReadonlyArray<SearchEntityEmbeddingChunk>;
    readonly creatorId: AccountId | null;
    readonly contributorIds: ReadonlyMap<AccountId, "Major" | "Minor">;
};
```

- `id`: A globally unique identifier for the entity. Combines the entity type with its unique key.
  For example a chat message entity ID would be: `ChatMessage:dvrbb4m9faeh1n66pg7gehqxam:42` (entity
  type + chat ID + message index).

- `accessPolicy`: Who is allowed to access the search entity? Follows a similar format to access
  policies for content elsewhere in the product except we omit permission levels since all we need
  to know is if the account can read the entity.

- `createdTime`: When was this entity created? Derived from the underlying data.

- `lastUpdatedTime`: When was this entity last updated? The search entity indexer automatically
  updates this property when re-indexing an entity.

- `title`: A short, optional, title string representing the entity. If searches match an entity’s
  title they’re ranked higher than searches that match an entity’s body.

- `body`: The bulk of the entity’s content. This is indexed for keyword search. The body is
  formatted using Markdown. `chunkSearchContent()` prints ProseMirror content nodes to Markdown and
  `parseSearchContent()` can parse Markdown back into ProseMirror content nodes. These functions are
  entirely reversible with the exception of some accepted lossiness by `chunkSearchContent()` (e.g.
  links are not preserved and mentions are formatted as text which helps keyword indexing).

- `media`: If there's an essential piece of media associated with the entity, it’s set on this
  property and we display it during search. For example the author of a post comment or members in a
  chat.

- `embeddingChunks`: This is another representation of the `title` and `body` content. For embedding
  with a large language model, we need to take our content and break it into smaller chunks. Models
  like [Cohere](https://docs.cohere.com/reference/embed) recommend reducing chunk length to be less
  than 512.

- `creatorId`: The account who created the entity.

- `contributorIds`: All accounts who contributed updates to the entity. Contributors are classified
  as either major contributors or minor contributors. How contributors are classified depends on the
  search entity type, but we recommend saying anyone who contributed >20% of updates is a major
  contributor and everyone else is a minor contributor. This is loosely based on the
  [Pareto principle](https://en.wikipedia.org/wiki/Pareto_principle). 80% of the document’s meaning
  can be attributed to 20% of the updates.

### Indexing search entities

When an object in our system is created or updated we schedule a `IndexSearchEntity` job on our
[AWS SQS](https://aws.amazon.com/sqs/) job queue (to be processed by `JobQueueService` which we
introduced alongside our search engine). The job is idempotent. It reads the latest data from the
database and updates our search entity in two [OpenSearch](https://opensearch.org/) indexes. Those
OpenSearch indexes are:

- `search_entity_keywords`: Indexes search entities for keyword search. Includes all search entity
  properties except for `embeddingChunks`.

- `search_entity_semantics`: Indexes search entities for semantic search. Uses a
  [nested field](https://opensearch.org/docs/latest/field-types/supported-field-types/nested/) for
  `embeddingChunks` so we can perform passage search on search entities while only returning the
  best matching chunk. This index only includes the `id`, `title`, `media`, and `accessPolicy`
  properties. `accessPolicy` is copied into each embedding chunk nested document to avoid joins when
  searching embedding chunks.

    We’re also using
    [byte vectors](https://opensearch.org/docs/latest/field-types/supported-field-types/knn-vector/#lucene-byte-vector)
    in our embedding index. Byte vectors have been shown to reduce storage costs and improve
    performance at minimal effect on recall. I (@calebmer) found the
    [Cohere embedding bounds with help from their support team](https://discord.com/channels/954421988141711382/1181993977927434240/1182699445410869249).

    We use [Cohere](https://cohere.com/) in production and
    [all-MiniLM-L6-v2](https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2) in
    development. To read more about this choice see
    “[Choosing a language model](#choosing-a-language-model).”

The reason for having two indexes is a little arbitrary: We mix keyword and semantic results on the
client since we want to show keyword search result’s immediately even if semantic search results
aren’t ready. So that means we make two separate search requests to OpenSearch. It _feels_ right to
completely isolate these indexes then. Semantic search data doesn’t effect the performance of
keyword search and vice-versa.

Longer term we also want to use the same keyword search capabilities to implement autocomplete
dropdowns (e.g. account mentions and task collection selector). Performance in those cases would
greatly benefit from
[index sorting](https://www.elastic.co/guide/en/elasticsearch/reference/current/index-modules-index-sorting.html)
by `type`. Since a filter on `type = "TaskCollection"` could skip large parts of the index. However,
index sorting is not supported on indexes with a nested field. By splitting the indexes we can index
sort `search_entity_keywords` while `search_entity_semantics` has its nested field.

I (@calebmer) explored not using a
[nested field](https://opensearch.org/docs/latest/field-types/supported-field-types/nested/) for
`search_entity_semantics`. Under the hood, you need multiple Lucene documents for passage search.
That can be accomplished with either a nested field or creating individual documents yourself.
However, OpenSearch doesn’t have transactions which means you can’t atomically create multiple
documents at once. Implementing some kind of transactional logic in our code would be really
difficult. Also, if you don’t use a nested document you may receive multiple passages from the same
document instead of the single best passage from each document.

#### Indexing continuously updated search entities

Some search entities, like documents and tasks, are updated continuously. A user may be typing in a
document for minutes at a time. Each keystroke updating data in the database. Re-indexing documents
on every keystroke would be wildly inefficient. Because re-indexing is idempotent we need to read
the entire document when we re-index. Tasks are similar since they have notes.

The solution is to throttle document and task indexing. We throttle re-indexing to every 1 minute.
When you type in a document we schedule an index job 1 minute from that moment. As you make updates
before 1 minute has elapsed we won’t schedule new indexing jobs.

Re-embedding document content can also get expensive.
[Cohere charges $0.10 per 1 million tokens](https://cohere.com/pricing). As a user makes changes,
it’s usually to a small portion of the document while the rest is left alone. So we cache embedding
vectors by chunk and only embed chunks that have changed since the last time we indexed.

### Relevance signal implementations

Let’s break down how we’re implementing each of our relevance signals:

- Keyword matching: Our `search_entity_keywords` uses OpenSearch’s battle hardened BM25
  implementation.

- Semantic meaning: We chunk our content using document structure (e.g. we recursively try to chunk
  by headings, then bullet lists, then paragraphs until we get small enough chunks) then generate
  embeddings with Cohere and save them to a nested document in the `search_entity_semantics`
  OpenSearch index. Notably,
  [OpenSearch’s k-NN implementation](https://opensearch.org/docs/latest/search-plugins/knn/index/)
  is different from
  [ElasticSearch’s k-NN implementation](https://www.elastic.co/guide/en/elasticsearch/reference/current/knn-search.html)
  since k-NN search was introduced after the ElasticSearch fork. They both have the option to use
  the k-NN search natively built into [Lucene](https://lucene.apache.org/). Given OpenSearch’s k-NN
  implementation is AWS’s only hosted service offering for semantic search and AWS’s commitment to
  supporting AI use cases, we can be confident development will continue.

- Affinity: We have a DynamoDB table for search entity affinities by account. Whenever the account
  interacts with an object in our system (views the object, updates the object) we add affinity
  points. Affinity points exponentially decay over time so content you haven’t used in a while lose
  relevance.

- Natural language filtering: We use the [compromise](https://www.npmjs.com/package/compromise)
  package to do basic tokenization, entity extraction, and part of speech tagging. It’s not perfect
  but good enough to write a basic natural language parser on top of.

    After that, we have a hand-written
    [LR(1) style parser](https://en.wikipedia.org/wiki/Canonical_LR_parser) to turn natural language
    into filters.

    We expect we’ll need to explicitly document what the capabilities of natural language filtering
    are and communicate to the user when it’s activated. Even providing the user the ability to
    tweak how we parse their query. Our current implementation is at risk of being confusing to the
    user since it’s not clear when filtering has been applied vs not.

    We could use a language model to try and generate filters from natural language someday, but I
    (@calebmer) expect it’s good for a system like this to be deterministic. To be very clear what
    words you need to use to activate natural language filtering. It would be strange if a
    non-deterministic language model was able to understand “documents updated three days ago” but
    not “documents updated forty-two days ago” because of some arbitrary, unexplainable,
    understanding of the number
    “[forty-two](<https://en.wikipedia.org/wiki/42_(number)#Popular_culture>)” in it’s training
    data.

## Consequences

Any time we need to make a breaking change to our index, it’s a pretty expensive and manual
re-indexing process. We’ll also likely run into bugs where indexing after an update is skipped for
whatever reason causing inaccurate searches.

If we were using PostgreSQL for all our data, indexes are faithfully maintained during updates and
you can recreate indexes off source data fairly easily. However, PostgreSQL’s search capabilities
are much weaker than OpenSearch (notably no BM25 ranking) and we’d still have problems getting data
from multiple different tables into one big search index.

## Alternatives considered

- Discussed using one OpenSearch index in “[Indexing search entities](#indexing-search-entities).”

- While OpenSearch’s k-NN implementation is good enough, it could be better. So I (Caleb) briefly
  considered using a vector database like [Pinecone](https://www.pinecone.io/),
  [qdrant](https://qdrant.tech/), or [ChromaDB](https://www.trychroma.com/). Ultimately settled on
  OpenSearch since it’s good enough and it reduces our operational burden to reduce the number of
  databases we need to manage. OpenSearch’s k-NN deficiencies:
    1. It’s very unfortunate that OpenSearch doesn’t have a
       [namespaces feature like Pinecone](https://docs.pinecone.io/docs/namespaces). As I understand
       it, the k-NN plugin puts data from all Alpine spaces into one search graph! This can hurt
       performance (since we never search across spaces) and there may be the potential for timing
       attacks (searches that take longer can tell you there’s data close to your query you’re not
       allowed to see).

        It’s possible OpenSearch k-NN graphs are separated by shard or routing value. If they’re
        separated by routing value, that’s perfect. If they’re separated by shard that’s better but
        some Alpine spaces will still be mixed in the same graph. k-NN graphs are definitely
        separated by data node.

        If we continue to use OpenSearch, this seems like a feature we could contribute to the open
        source project.

    2. qdrant has nice [byte quantization](https://qdrant.tech/documentation/guides/quantization/)
       support where you set the quantile range for quantization bounds and it automatically figures
       out the bounds from your data. Instead, we had to pre-compute the quantization bounds for
       Cohere. This does mean our quantization bounds are more accurate (since it’s based on 2M
       diverse samples vs the hundreds of documents currently in production) but a little less
       convenient.

### Choosing a language model

We use [Cohere](https://cohere.com/) in production and
[all-MiniLM-L6-v2](https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2) in development. We
have separate language model in development since all-MiniLM-L6-v2 can run locally for free, even
though it’s quality is pretty bad in comparison to Cohere.

The major commercial language models today that perform content embeddings I know of are:

- [OpenAI `text-embedding-ada-002`](https://platform.openai.com/docs/guides/embeddings/what-are-embeddings)
- [Google Gemini Pro](https://ai.google.dev/)
- [Cohere `embed-english-v3.0`](https://cohere.com/embeddings)

[Anthropic](https://www.anthropic.com/product) doesn’t currently provide embeddings. From the Q&A on
their website “Q: Can Claude do embeddings? A: Not at this time! We find the open source SBERT
embeddings to be good enough for most purposes.”

Embedding models can be evaluated on the
[MTEB leaderboard](https://huggingface.co/spaces/mteb/leaderboard) (as with most language model
evaluations, just because they can be measured doesn’t mean they’re measuring the right things).
OpenAI and Google currently don’t upload results for their models on this leaderboard. When I picked
Cohere `embed-english-v3.0`, it was #1 on this leaderboard. As of today it’s #4. But it’s #2 on the
tasks we care most about (Classification and Clustering).

Also when I picked Cohere, they were the cheapest option at $0.10 per 1 million tokens. (OpenAI was
almost 10x more if I recall correctly.) However, since then
[OpenAI embedding pricing has come in line at $0.10 per 1 million tokens](https://openai.com/pricing)
and Google launched Gemini.

Long term, strategically Alpine wants language models to become a commodity market. That means
Alpine can capture the profit of AI features, not language model builders. A lot has happened in the
six weeks it took to build search, but it certainly looks like the AI market (particularly around
embeddings) is turning into a commodity market. This outlook makes me wary of building on top of
today’s leaders (OpenAI and Google) who can use branding power to charge higher prices.

Cohere markets itself as “The enterprise LLM.” They have no consumer products. This is the
positioning I want in a language model partner. Being the enterprise LLM they offer the option to
deploy directly inside a VPC in our AWS account. This is critical for enterprise grade security in
the long term. Though today we’re using their SaaS API for simplicity.

I’m really excited to see [Mistral](https://mistral.ai/) topping the
[MTEB leaderboard](https://huggingface.co/spaces/mteb/leaderboard). Mistral is an open source
language model we could deploy on our own hardware. It wasn’t available when I was picking a
language model but if we were to switch language models today, Mistral would probably be the top
choice. (Assuming deploying it isn’t too inconvenient.) Though I would prefer to have a paid
relationship with a language model provider like Cohere to ensure they can fund further development.

We’ll probably need to switch language models anyway in a year or so. At minimum, I’d expect Cohere
to launch a new model that obviates the one we currently use. So this is all still up for
discussion.
