# Agent Service

The agent service provides AI-powered chat agents for Alpine. It runs on Cloudflare Workers and uses
Durable Objects for conversation state management.

## Directory Layout and Important Files

```
server/agents/
├── agent_service.ts                   # Main service entry point
├── wrangler.toml                      # Cloudflare Workers configuration
├── ...
└── internal/
    ├── agent_durable_object_base.ts   # Base class for agent durable objects
    ├── ...
    └── d1/                            # Database layer with Drizzle ORM
        ├── agent_usage_schema.ts      # Database schema definitions
        ├── agent_usage_database.ts    # Database access layer
        └── migrations/                # Generated database migrations
```

## Database

The database tracks agent usage limits to prevent overwhelming usage.

### Schema Management with Drizzle

We use [Drizzle ORM](https://orm.drizzle.team/) for type-safe database access and schema management:

-   **Schema definition**: `internal/d1/agent_usage_schema.ts` defines our database structure using
    Drizzle's schema syntax
-   **Type safety**: Drizzle provides full TypeScript types for all database operations
-   **Migration generation**: Changes to the schema automatically generate SQL migrations via
    `dev agents d1 generate <migration_name>`
-   **Database access**: `AgentUsageDatabase` class provides a clean interface for database
    operations

#### Workflow for schema changes:

1. **Modify the schema** in `internal/d1/agent_usage_schema.ts`
2. **Generate migrations** with `dev agents d1 generate <migration_name>`
3. **Apply migrations** with `dev agents d1 apply`
4. **Commit both** the schema changes and generated migration files

This ensures our database schema stays in sync across environments and provides type safety for all
database operations.

### Scaling and Data Storage

Based on analysis discussed in the
[December 16, 2025 Tea Time](https://alpine.inc/s/c2pwxmpv3z7b3db19tsn6y1qfg/documents/vt7cyc2gywa0ffzx13dm0kz4k0),
the current database design can handle massive scale without requiring sharding. With D1's 10GB
limit per database and our current data model (storing individual agent requests plus usage
windows), we can support over 100 million requests before needing to consider data cleanup or
sharding strategies.

Key findings:

-   Individual agent requests are stored with full metadata for flexibility and debugging
-   Usage windows track active limits per account
-   A future improvement: data can be cleaned periodically (e.g., requests older than 60 days) to
    maintain performance
-   The current single-database approach provides sufficient capacity for years of growth

### Commands

#### Using `dev agents` (Recommended)

For convenience, you can use the `dev agents` command from the project root:

```bash
# Database management
dev agents d1 apply                    # Apply pending migrations
dev agents d1 execute <command>        # Execute arbitrary SQL commands
dev agents d1 status                   # Check migration status
dev agents d1 reset                    # Reset database (drop all tables)

# Schema management with Drizzle
dev agents d1 generate <name>          # Generate migrations from schema changes
dev agents d1 generate <name> --custom # Generate an empty migration file

# Examples
dev agents d1 execute "SELECT * FROM agent_usage_windows;"
dev agents d1 execute get_agent_usage  # Use named query shortcut
```
