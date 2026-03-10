# LangGraph Observability & Analytics Guide

Complete guide for monitoring, analyzing, and visualizing LangGraph applications using PostgreSQL checkpoints, LangSmith, and Langfuse.

---

## Table of Contents

1. [Overview](#overview)
2. [PostgreSQL Direct Queries](#postgresql-direct-queries)
3. [LangSmith Integration](#langsmith-integration)
4. [Langfuse Integration](#langfuse-integration)
5. [Comparison Matrix](#comparison-matrix)
6. [Recommended Approach](#recommended-approach)

---

## Overview

LangGraph applications can be monitored and analyzed through three complementary approaches:

### 1. **PostgreSQL Direct Queries** (Checkpoint Data)
- **What it tracks**: Graph state persistence, checkpoints, interrupts
- **Best for**: State debugging, conversation replay, checkpoint analysis
- **Data source**: `checkpoints`, `checkpoint_blobs`, `checkpoint_writes` tables
- **Limitation**: No LLM call details (tokens, costs, latency)

### 2. **LangSmith** (Official LangChain Observability)
- **What it tracks**: Full execution traces, LLM calls, tool usage, costs
- **Best for**: Production monitoring, debugging, prompt engineering
- **Data source**: LangSmith cloud or self-hosted
- **Limitation**: Separate from checkpoint data (different storage)

### 3. **Langfuse** (Open Source Alternative)
- **What it tracks**: Traces, LLM metrics, evaluations, prompt management
- **Best for**: Cost tracking, evaluation, open-source deployments
- **Data source**: Langfuse cloud or self-hosted PostgreSQL
- **Limitation**: Requires manual integration with checkpoints

---

## PostgreSQL Direct Queries

### What You Can Analyze

✅ **Conversation State**
- Full state at any checkpoint
- State evolution over time
- Channel-by-channel analysis

✅ **Execution Flow**
- Node execution order
- Parallel vs sequential execution
- Checkpoint chains (parent-child)

✅ **Human-in-the-Loop**
- Interrupt locations
- Pending human decisions
- Resume patterns

✅ **Performance Metrics**
- Checkpoint count per conversation
- Storage usage per thread
- Conversation duration

❌ **What's Missing**
- LLM token usage and costs
- Individual LLM call latency
- Model parameters and prompts
- Tool execution details

### Usage

See `sql/langgraph-checkpoint-analytics.sql` for 50+ ready-to-use queries organized by:
- Thread & conversation overview
- State channel analysis
- Node execution tracking
- Metadata & interrupts
- Performance diagnostics
- Time-based analytics
- Advanced use cases
- Cleanup & maintenance
- Export for BI tools

### Example: View Latest State

```sql
WITH latest_checkpoint AS (
  SELECT checkpoint_id, thread_id
  FROM checkpoints
  WHERE thread_id = 'thread-1'
  ORDER BY (checkpoint->>'ts')::timestamp DESC
  LIMIT 1
)
SELECT 
  cb.channel,
  cb.type,
  CASE 
    WHEN cb.type = 'json' THEN convert_from(cb.blob, 'UTF8')
    ELSE 'binary'
  END as value
FROM checkpoint_blobs cb
JOIN latest_checkpoint lc ON cb.thread_id = lc.thread_id
ORDER BY cb.channel;
```

---

## LangSmith Integration

### Overview

LangSmith is the **official observability platform** from LangChain. It provides automatic tracing for LangGraph applications with zero code changes when using LangChain/LangGraph.

### Key Features

✅ **Automatic Tracing**
- Every LLM call, tool execution, and graph node
- Token usage and cost tracking
- Latency measurements
- Error tracking

✅ **Prompt Management**
- Version control for prompts
- A/B testing
- Prompt playground

✅ **Evaluation**
- LLM-as-a-judge evaluations
- Custom evaluators
- Dataset management

✅ **Debugging**
- Time-travel through execution
- Input/output inspection
- Error analysis

### Setup (TypeScript/JavaScript)

#### 1. Install Dependencies

```bash
npm install langsmith
```

#### 2. Set Environment Variables

```bash
export LANGCHAIN_TRACING_V2=true
export LANGCHAIN_API_KEY=your-api-key
export LANGCHAIN_PROJECT=your-project-name  # Optional
```

#### 3. That's It!

LangSmith automatically traces all LangChain/LangGraph executions. No code changes needed.

```typescript
import { StateGraph } from '@langchain/langgraph';
import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres';

// Your existing code - tracing happens automatically
const graph = new StateGraph(StateDefinition)
  .addNode('node1', node1Fn)
  .compile({ checkpointer });

// This will be traced in LangSmith
await graph.invoke(input, config);
```

#### 4. Advanced: Manual Trace Context

For distributed systems or custom tracing:

```typescript
import { traceable } from 'langsmith/traceable';
import { getCurrentRunTree } from 'langsmith/run_trees';

// Wrap custom functions
const myFunction = traceable(
  async (input: string) => {
    // Your logic
    return result;
  },
  { name: 'my-custom-function' }
);

// Get current trace context
const runTree = await getCurrentRunTree();
const headers = runTree?.toHeaders();
// Pass headers to other services for distributed tracing
```

### What LangSmith Tracks

```
Trace
├── Graph Execution
│   ├── Node: readEmail
│   │   └── Duration: 5ms
│   ├── Node: classifyIntent
│   │   ├── LLM Call: gpt-4o-mini
│   │   │   ├── Tokens: 150 input, 45 output
│   │   │   ├── Cost: $0.0003
│   │   │   └── Latency: 850ms
│   │   └── Duration: 900ms
│   ├── Node: searchDocumentation
│   │   └── Duration: 120ms
│   └── Node: writeResponse
│       ├── LLM Call: gpt-4o-mini
│       │   ├── Tokens: 320 input, 180 output
│       │   ├── Cost: $0.0008
│       │   └── Latency: 1200ms
│       └── Duration: 1250ms
└── Total Duration: 2.3s, Total Cost: $0.0011
```

### Viewing Data

1. **Web UI**: https://smith.langchain.com
2. **Traces**: See full execution tree with timing
3. **Datasets**: Create test sets from production data
4. **Evaluations**: Run batch evaluations
5. **Dashboards**: Monitor costs, latency, errors

### LangSmith + Checkpoints

**Important**: LangSmith traces and PostgreSQL checkpoints are **separate systems**:

- **LangSmith**: Tracks execution (what happened)
- **Checkpoints**: Stores state (what to resume)

To correlate them, add metadata:

```typescript
const config = {
  configurable: {
    thread_id: 'thread-1'
  },
  metadata: {
    thread_id: 'thread-1',  // Add to LangSmith trace
    user_id: 'user-123',
    session_id: 'session-456'
  }
};

await graph.invoke(input, config);
```

Then query LangSmith API to find traces by metadata:

```typescript
import { Client } from 'langsmith';

const client = new Client();
const runs = await client.listRuns({
  projectName: 'your-project',
  filter: 'eq(metadata.thread_id, "thread-1")'
});
```

---

## Langfuse Integration

### Overview

Langfuse is an **open-source observability platform** that provides similar features to LangSmith but with self-hosting options and PostgreSQL storage.

### Key Features

✅ **Open Source**
- Self-host on your infrastructure
- Full data ownership
- PostgreSQL backend (can query directly!)

✅ **LLM Observability**
- Trace LLM calls, tools, agents
- Token usage and cost tracking
- Latency monitoring

✅ **Evaluation**
- Custom scores and metrics
- LLM-as-a-judge
- Human feedback

✅ **Prompt Management**
- Version control
- Prompt playground
- A/B testing

### Setup (TypeScript/JavaScript)

#### 1. Install Dependencies

```bash
npm install langfuse langfuse-langchain
```

#### 2. Set Environment Variables

```bash
export LANGFUSE_SECRET_KEY=sk-lf-...
export LANGFUSE_PUBLIC_KEY=pk-lf-...
export LANGFUSE_HOST=https://cloud.langfuse.com  # or self-hosted URL
```

#### 3. Add Callback Handler

Unlike LangSmith, Langfuse requires explicit callback handlers:

```typescript
import { CallbackHandler } from 'langfuse-langchain';
import { StateGraph } from '@langchain/langgraph';

// Create callback handler
const langfuseHandler = new CallbackHandler({
  secretKey: process.env.LANGFUSE_SECRET_KEY,
  publicKey: process.env.LANGFUSE_PUBLIC_KEY,
  baseUrl: process.env.LANGFUSE_HOST,
});

// Add to graph invocation
const config = {
  configurable: {
    thread_id: 'thread-1'
  },
  callbacks: [langfuseHandler]  // Add here
};

await graph.invoke(input, config);

// Flush to ensure data is sent
await langfuseHandler.flushAsync();
```

#### 4. Advanced: Custom Trace IDs

To link multiple graph executions in one trace:

```typescript
import { Langfuse } from 'langfuse';

const langfuse = new Langfuse();

// Generate trace ID
const traceId = Langfuse.createTraceId();

// Use same trace ID for multiple invocations
const handler1 = new CallbackHandler({
  trace_id: traceId,
  // ... other config
});

const handler2 = new CallbackHandler({
  trace_id: traceId,
  // ... other config
});

// Both will appear in same trace
await graph1.invoke(input1, { callbacks: [handler1] });
await graph2.invoke(input2, { callbacks: [handler2] });
```

### What Langfuse Tracks

Similar to LangSmith:
- Full execution traces
- LLM calls with tokens/costs
- Tool executions
- Custom spans
- User feedback scores

### Viewing Data

1. **Web UI**: https://cloud.langfuse.com (or self-hosted)
2. **Traces**: Full execution tree
3. **Sessions**: Group related traces
4. **Datasets**: Test sets
5. **Dashboards**: Custom metrics

### Langfuse + Checkpoints

Langfuse stores traces in **its own PostgreSQL database** (if self-hosted). This is separate from LangGraph checkpoints.

**Option 1: Separate Databases** (Recommended)
- LangGraph checkpoints: `postgres://localhost:5432/langgraph_checkpoints`
- Langfuse data: `postgres://localhost:5432/langfuse`

**Option 2: Same Database, Different Schemas**
```sql
-- LangGraph uses 'public' schema by default
-- Langfuse uses 'langfuse' schema
```

**Option 3: Query Both**

Since Langfuse uses PostgreSQL, you can join checkpoint and trace data:

```sql
-- Example: Find LangGraph checkpoints with corresponding Langfuse traces
SELECT 
  c.thread_id,
  c.checkpoint_id,
  c.checkpoint->>'ts' as checkpoint_time,
  lt.id as langfuse_trace_id,
  lt.name as trace_name,
  lt.metadata
FROM langgraph_db.public.checkpoints c
LEFT JOIN langfuse_db.public.traces lt 
  ON lt.metadata->>'thread_id' = c.thread_id
  AND lt.timestamp BETWEEN 
    (c.checkpoint->>'ts')::timestamp - INTERVAL '1 second'
    AND (c.checkpoint->>'ts')::timestamp + INTERVAL '1 second'
ORDER BY c.checkpoint->>'ts' DESC;
```

---

## Comparison Matrix

| Feature | PostgreSQL Checkpoints | LangSmith | Langfuse |
|---------|----------------------|-----------|----------|
| **Setup Complexity** | ✅ Automatic (with checkpointer) | ✅ Env vars only | ⚠️ Callback handler required |
| **State Persistence** | ✅ Full state snapshots | ❌ Not stored | ❌ Not stored |
| **LLM Call Tracking** | ❌ No | ✅ Automatic | ✅ With callbacks |
| **Token/Cost Tracking** | ❌ No | ✅ Yes | ✅ Yes |
| **Latency Tracking** | ❌ No | ✅ Yes | ✅ Yes |
| **Human-in-Loop** | ✅ Interrupts stored | ⚠️ Visible in traces | ⚠️ Visible in traces |
| **Time-Travel Debug** | ✅ Checkpoint replay | ⚠️ Trace replay only | ⚠️ Trace replay only |
| **Self-Hosting** | ✅ Your PostgreSQL | ⚠️ Enterprise only | ✅ Open source |
| **Data Ownership** | ✅ Full | ❌ LangSmith cloud | ✅ Full (self-hosted) |
| **SQL Queries** | ✅ Direct access | ❌ API only | ✅ If self-hosted |
| **Prompt Management** | ❌ No | ✅ Yes | ✅ Yes |
| **Evaluation** | ❌ No | ✅ Yes | ✅ Yes |
| **Cost** | ✅ Free (PostgreSQL) | 💰 Paid (free tier limited) | ✅ Free (self-hosted) |
| **Best For** | State debugging, replay | Production monitoring | Open-source, cost tracking |

---

## Recommended Approach

### For Development

**Use PostgreSQL Checkpoints Only**
- Simple setup
- Full state visibility
- No external dependencies
- Use SQL queries from `sql/langgraph-checkpoint-analytics.sql`

### For Production (Small Scale)

**PostgreSQL Checkpoints + LangSmith**
- Checkpoints: State management and replay
- LangSmith: Monitoring, costs, debugging
- Link via metadata in config

```typescript
const config = {
  configurable: { thread_id: threadId },
  metadata: { 
    thread_id: threadId,
    user_id: userId,
    environment: 'production'
  }
};
```

### For Production (Large Scale / Cost-Conscious)

**PostgreSQL Checkpoints + Langfuse (Self-Hosted)**
- Checkpoints: State management
- Langfuse: Full observability with data ownership
- Both in PostgreSQL (can join queries)
- No per-trace costs

### For Enterprise

**All Three**
- Checkpoints: State persistence and replay
- LangSmith: Team collaboration, prompt management
- Langfuse: Custom analytics, cost tracking
- Use metadata to correlate across systems

---

## Analytics Use Cases

### 1. Conversation Analytics (PostgreSQL)

```sql
-- Average conversation length by day
SELECT 
  DATE((checkpoint->>'ts')::timestamp) as date,
  AVG(checkpoint_count) as avg_checkpoints,
  COUNT(DISTINCT thread_id) as conversations
FROM (
  SELECT thread_id, COUNT(*) as checkpoint_count
  FROM checkpoints
  GROUP BY thread_id
) t
JOIN checkpoints c ON t.thread_id = c.thread_id
GROUP BY date
ORDER BY date DESC;
```

### 2. Cost Analytics (LangSmith/Langfuse)

**LangSmith API:**
```typescript
import { Client } from 'langsmith';

const client = new Client();
const runs = await client.listRuns({
  projectName: 'your-project',
  startTime: new Date('2026-03-01'),
  endTime: new Date('2026-03-31')
});

const totalCost = runs.reduce((sum, run) => 
  sum + (run.totalCost || 0), 0
);
```

**Langfuse SQL (self-hosted):**
```sql
SELECT 
  DATE(timestamp) as date,
  SUM(usage_details->>'total_cost')::numeric as daily_cost,
  SUM((usage_details->>'prompt_tokens')::int) as prompt_tokens,
  SUM((usage_details->>'completion_tokens')::int) as completion_tokens
FROM observations
WHERE type = 'GENERATION'
  AND timestamp >= '2026-03-01'
GROUP BY date
ORDER BY date;
```

### 3. Performance Analytics (Combined)

```typescript
// Get checkpoint data
const checkpointDurations = await db.query(`
  SELECT 
    thread_id,
    COUNT(*) as checkpoints,
    EXTRACT(EPOCH FROM (
      MAX((checkpoint->>'ts')::timestamp) - 
      MIN((checkpoint->>'ts')::timestamp)
    )) as duration_seconds
  FROM checkpoints
  GROUP BY thread_id
`);

// Get LLM latency from LangSmith
const runs = await langsmithClient.listRuns({
  filter: 'eq(run_type, "llm")'
});

const avgLatency = runs.reduce((sum, run) => 
  sum + (run.latency || 0), 0
) / runs.length;
```

### 4. Human-in-Loop Analytics (PostgreSQL)

```sql
-- Interrupt rate by hour
SELECT 
  EXTRACT(HOUR FROM (checkpoint->>'ts')::timestamp) as hour,
  COUNT(*) FILTER (WHERE metadata::text LIKE '%__interrupt__%') as interrupts,
  COUNT(*) as total_checkpoints,
  ROUND(
    COUNT(*) FILTER (WHERE metadata::text LIKE '%__interrupt__%')::numeric / 
    COUNT(*)::numeric * 100, 
    2
  ) as interrupt_rate_pct
FROM checkpoints
GROUP BY hour
ORDER BY hour;
```

---

## Best Practices

### 1. Add Rich Metadata

```typescript
const config = {
  configurable: {
    thread_id: threadId
  },
  metadata: {
    // For correlation
    thread_id: threadId,
    user_id: userId,
    session_id: sessionId,
    
    // For filtering
    environment: 'production',
    version: '1.2.3',
    feature_flag: 'new_classifier',
    
    // For analytics
    user_tier: 'premium',
    region: 'us-east-1',
    source: 'web_app'
  }
};
```

### 2. Use Consistent IDs

```typescript
import { randomUUID } from 'crypto';

// Generate once per conversation
const threadId = randomUUID();

// Use everywhere
const checkpointConfig = { configurable: { thread_id: threadId } };
const langsmithMetadata = { metadata: { thread_id: threadId } };
const langfuseHandler = new CallbackHandler({ 
  sessionId: threadId 
});
```

### 3. Index Your Checkpoint Tables

```sql
-- For time-based queries
CREATE INDEX idx_checkpoints_timestamp 
ON checkpoints(((checkpoint->>'ts')::timestamp));

-- For thread lookups
CREATE INDEX idx_checkpoints_thread 
ON checkpoints(thread_id);

-- For metadata searches
CREATE INDEX idx_checkpoints_metadata 
ON checkpoints USING gin(metadata);

-- For blob channel lookups
CREATE INDEX idx_blobs_thread_channel 
ON checkpoint_blobs(thread_id, channel);
```

### 4. Set Up Retention Policies

```sql
-- Archive old checkpoints
INSERT INTO checkpoints_archive
SELECT * FROM checkpoints
WHERE (checkpoint->>'ts')::timestamp < NOW() - INTERVAL '90 days';

DELETE FROM checkpoints
WHERE (checkpoint->>'ts')::timestamp < NOW() - INTERVAL '90 days';

-- Or use PostgreSQL partitioning
CREATE TABLE checkpoints_2026_03 PARTITION OF checkpoints
FOR VALUES FROM ('2026-03-01') TO ('2026-04-01');
```

### 5. Monitor Storage Growth

```sql
-- Run weekly
SELECT 
  schemaname,
  tablename,
  pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as size,
  pg_total_relation_size(schemaname||'.'||tablename) as bytes
FROM pg_tables
WHERE schemaname = 'public'
  AND tablename LIKE 'checkpoint%'
ORDER BY bytes DESC;
```

---

## Troubleshooting

### LangSmith Not Showing Traces

1. Check environment variables:
```bash
echo $LANGCHAIN_TRACING_V2  # Should be "true"
echo $LANGCHAIN_API_KEY      # Should be set
```

2. Verify API key at https://smith.langchain.com/settings

3. Check network connectivity (firewall, proxy)

### Langfuse Traces Not Appearing

1. Verify callback handler is added:
```typescript
const config = { callbacks: [langfuseHandler] };
```

2. Call `flushAsync()` before process exits:
```typescript
await langfuseHandler.flushAsync();
```

3. Check Langfuse credentials and host URL

### Checkpoint Data Not Persisting

1. Verify `setup()` was called:
```typescript
await checkpointer.setup();
```

2. Check PostgreSQL connection:
```typescript
const result = await checkpointer.conn.execute('SELECT 1');
```

3. Verify `thread_id` in config:
```typescript
const config = { configurable: { thread_id: 'some-id' } };
```

---

## Resources

### Documentation
- **LangGraph**: https://langchain-ai.github.io/langgraphjs/
- **LangSmith**: https://docs.smith.langchain.com/
- **Langfuse**: https://langfuse.com/docs

### SQL Queries
- See `sql/langgraph-checkpoint-analytics.sql` for 50+ queries

### Example Integrations
- **LangSmith + LangGraph**: https://docs.smith.langchain.com/observability/how_to_guides/trace_with_langgraph
- **Langfuse + LangGraph**: https://langfuse.com/docs/integrations/langchain/example-langgraph-agents

### Community
- **LangChain Discord**: https://discord.gg/langchain
- **Langfuse Discord**: https://discord.gg/langfuse
