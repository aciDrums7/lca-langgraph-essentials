# LangGraph Observability Quick Start

Choose your approach based on your needs:

---

## 🎯 Quick Decision Guide

| Your Goal | Recommended Solution | Setup Time |
|-----------|---------------------|------------|
| Debug state issues | PostgreSQL queries | 0 min (already set up) |
| Track LLM costs | LangSmith or Langfuse | 2 min |
| Production monitoring | LangSmith | 2 min |
| Self-hosted, data ownership | Langfuse | 10 min |
| Full analytics stack | PostgreSQL + Langfuse | 15 min |

---

## Option 1: PostgreSQL Queries (State & Checkpoints)

**What you get**: Full conversation state, checkpoint history, human interrupts

**Setup**: Already done if using PostgresSaver ✅

**View data**:
```bash
# Use any PostgreSQL client
psql postgres://postgres:mysecretpassword@localhost:5432/postgres

# Or use DBHub MCP server (already configured)
```

**Example queries**: See `sql/langgraph-checkpoint-analytics.sql`

```sql
-- View all threads
SELECT thread_id, COUNT(*) as checkpoints
FROM checkpoints
GROUP BY thread_id;

-- View latest state for a thread
SELECT channel, convert_from(blob, 'UTF8') as value
FROM checkpoint_blobs
WHERE thread_id = 'YOUR_THREAD_ID'
ORDER BY version DESC;
```

**Limitations**: No LLM token/cost tracking, no latency metrics

---

## Option 2: LangSmith (Official LangChain Platform)

**What you get**: LLM calls, tokens, costs, latency, full traces, prompt management

**Setup** (2 minutes):

1. Get API key: https://smith.langchain.com/settings
2. Set environment variables:
```bash
export LANGCHAIN_TRACING_V2=true
export LANGCHAIN_API_KEY=lsv2_pt_...
export LANGCHAIN_PROJECT=my-project  # optional
```
3. Done! All LangGraph executions auto-trace

**View data**: https://smith.langchain.com

**No code changes needed** - tracing is automatic

**Link with checkpoints**:
```typescript
const config = {
  configurable: { thread_id: threadId },
  metadata: { thread_id: threadId }  // Shows in LangSmith
};
```

**Cost**: Free tier (5k traces/month), then $39/month

---

## Option 3: Langfuse (Open Source Alternative)

**What you get**: Same as LangSmith + self-hosting + PostgreSQL storage

**Setup** (10 minutes):

1. Sign up: https://cloud.langfuse.com (or self-host)
2. Get API keys from project settings
3. Install:
```bash
npm install langfuse langfuse-langchain
```
4. Add to code:
```typescript
import { CallbackHandler } from 'langfuse-langchain';

const langfuseHandler = new CallbackHandler({
  secretKey: process.env.LANGFUSE_SECRET_KEY,
  publicKey: process.env.LANGFUSE_PUBLIC_KEY,
});

const config = {
  configurable: { thread_id: threadId },
  callbacks: [langfuseHandler]  // Add this
};

await graph.invoke(input, config);
await langfuseHandler.flushAsync();  // Important!
```

**View data**: https://cloud.langfuse.com (or your self-hosted URL)

**Cost**: Free (self-hosted) or cloud pricing

---

## Recommended Combinations

### For Learning/Development
```
PostgreSQL queries only
```
- Use `sql/langgraph-checkpoint-analytics.sql`
- No external dependencies
- Full state visibility

### For Production (Small)
```
PostgreSQL + LangSmith
```
- Checkpoints: State management
- LangSmith: Monitoring & costs
- Link via metadata

### For Production (Large/Cost-Conscious)
```
PostgreSQL + Langfuse (self-hosted)
```
- Both in PostgreSQL
- Can join queries
- No per-trace costs
- Full data ownership

### For Enterprise
```
PostgreSQL + LangSmith + Langfuse
```
- Checkpoints: State persistence
- LangSmith: Team collaboration
- Langfuse: Custom analytics

---

## What Each System Tracks

| Feature | PostgreSQL | LangSmith | Langfuse |
|---------|-----------|-----------|----------|
| Graph state | ✅ | ❌ | ❌ |
| Checkpoints | ✅ | ❌ | ❌ |
| Interrupts | ✅ | ⚠️ visible | ⚠️ visible |
| LLM calls | ❌ | ✅ | ✅ |
| Token usage | ❌ | ✅ | ✅ |
| Costs | ❌ | ✅ | ✅ |
| Latency | ❌ | ✅ | ✅ |
| Prompts | ❌ | ✅ | ✅ |
| Evaluations | ❌ | ✅ | ✅ |

---

## Common Analytics Queries

### 1. How many conversations today? (PostgreSQL)
```sql
SELECT COUNT(DISTINCT thread_id)
FROM checkpoints
WHERE (checkpoint->>'ts')::timestamp::date = CURRENT_DATE;
```

### 2. What did this conversation cost? (LangSmith)
```typescript
const runs = await langsmithClient.listRuns({
  filter: `eq(metadata.thread_id, "${threadId}")`
});
const cost = runs.reduce((sum, r) => sum + (r.totalCost || 0), 0);
```

### 3. Average response time? (LangSmith/Langfuse)
```typescript
// LangSmith
const runs = await langsmithClient.listRuns({
  filter: 'eq(run_type, "llm")'
});
const avgLatency = runs.reduce((sum, r) => 
  sum + (r.latency || 0), 0
) / runs.length;
```

### 4. How many needed human review? (PostgreSQL)
```sql
SELECT COUNT(*)
FROM checkpoints
WHERE metadata::text LIKE '%__interrupt__%';
```

---

## Next Steps

1. **Read full guide**: `docs/langgraph-observability-guide.md`
2. **Explore SQL queries**: `sql/langgraph-checkpoint-analytics.sql`
3. **Set up monitoring**: Choose LangSmith or Langfuse above
4. **Add metadata**: Enrich traces for better filtering

---

## Troubleshooting

**LangSmith not showing traces?**
```bash
# Check env vars
echo $LANGCHAIN_TRACING_V2  # Should be "true"
echo $LANGCHAIN_API_KEY      # Should be set
```

**Langfuse traces missing?**
```typescript
// Did you add the callback?
const config = { callbacks: [langfuseHandler] };

// Did you flush?
await langfuseHandler.flushAsync();
```

**Checkpoint data not persisting?**
```typescript
// Did you call setup?
await checkpointer.setup();

// Did you provide thread_id?
const config = { configurable: { thread_id: 'some-id' } };
```

---

## Resources

- **Full Guide**: `docs/langgraph-observability-guide.md`
- **SQL Queries**: `sql/langgraph-checkpoint-analytics.sql`
- **LangSmith Docs**: https://docs.smith.langchain.com
- **Langfuse Docs**: https://langfuse.com/docs
