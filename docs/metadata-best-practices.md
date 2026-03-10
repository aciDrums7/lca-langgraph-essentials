# LangGraph Metadata Best Practices Guide

Complete guide for adding comprehensive metadata to your LangGraph applications for better observability and analytics.

---

## Overview

Metadata in LangGraph is crucial for:
- **Correlating data** across PostgreSQL checkpoints, LangSmith, and Langfuse
- **Filtering and searching** traces and conversations
- **Analytics** and business intelligence
- **Cost allocation** and resource tracking
- **Debugging** production issues

---

## Quick Start: The `createMetadata` Helper

Use the provided helper function to ensure consistent metadata across your application:

```typescript
import { randomUUID } from 'node:crypto';

// Define your input object
const input = {
  content: "Your input content...",
  userId: "user-123",
  requestId: "req-456",
  threadId: randomUUID()
};

// Create metadata with helper
const metadata = createMetadata(input, {
  // Add any additional metadata specific to this invocation
  priority: 'high',
  escalation_level: 2
});

// Use in graph invocation
const config = {
  configurable: { thread_id: input.threadId },
  metadata: metadata  // This appears in LangSmith/Langfuse
};

await graph.invoke(input, config);
```

---

## Metadata Structure

### Required Fields (Always Included)

| Field | Type | Description | Example |
|--------|------|-------------|---------|
| `thread_id` | string | Unique conversation identifier | `"550e8400-e29b-41d4-a716-446655440000"` |
| `request_id` | string | Unique request identifier | `"req-123"` |
| `session_id` | string | Session identifier (can be same as thread_id) | `"session-456"` |
| `user_id` | string | User identifier | `"user-123"` |
| `environment` | string | Deployment environment | `"production"` |
| `graph_version` | string | Version of your graph | `"1.0.0"` |
| `node_version` | string | Node.js runtime version | `"v20.11.0"` |
| `request_type` | string | Type of request | `"inbound"` |
| `source` | string | Source of the request | `"web_app"` |
| `priority` | string | Request priority | `"normal"` |
| `tags` | string[] | Analytics tags | `["workflow", "support"]` |
| `received_at` | string | ISO timestamp | `"2026-03-10T17:00:00.000Z"` |
| `cost_center` | string | Cost allocation | `"customer_support"` |
| `region` | string | Geographic region | `"us-east-1"` |

### Optional Feature Flags

| Field | Type | Description | Default |
|--------|------|-------------|---------|
| `use_new_classifier` | boolean | Enable new classification model | `true` |
| `enable_human_review` | boolean | Allow human intervention | `true` |

### Custom Additional Fields

You can pass any additional metadata:

```typescript
const metadata = createMetadata(input, {
  // Business context
  customer_tier: 'premium',
  account_value: 50000,
  
  // Technical context
  api_version: 'v2',
  request_source: 'mobile_app',
  
  // Analytics
  campaign_id: 'welcome_series',
  experiment_group: 'A',
  
  // Compliance
  gdpr_consent: true,
  data_retention_days: 365
});
```

---

## Use Cases and Examples

### 1. Customer Support Analytics

```typescript
const metadata = createMetadata(input, {
  customer_tier: 'enterprise',
  sla_level: 'platinum',
  escalation_required: false,
  issue_category: 'billing',
  response_time_sla: '1_hour'
});
```

**Query Examples:**

```sql
-- Find all enterprise customer conversations
SELECT COUNT(*) FROM checkpoints
WHERE metadata->>'customer_tier' = 'enterprise';

-- Average response time by tier
SELECT 
  metadata->>'customer_tier' as tier,
  AVG(EXTRACT(EPOCH FROM (
    MAX((checkpoint->>'ts')::timestamp) - 
    MIN((checkpoint->>'ts')::timestamp)
  ))) as avg_duration_seconds
FROM checkpoints
GROUP BY metadata->>'customer_tier';
```

### 2. A/B Testing

```typescript
const metadata = createMetadata(input, {
  experiment_id: 'classifier_v2_test',
  experiment_group: Math.random() > 0.5 ? 'control' : 'treatment',
  feature_flag: 'new_classifier',
  test_start_date: '2026-03-01'
});
```

**Analytics:**

```sql
-- Compare classifier performance
SELECT 
  metadata->>'experiment_group' as group,
  COUNT(*) as conversations,
  COUNT(*) FILTER (WHERE metadata->>'classification' = 'bug') as bug_count,
  ROUND(COUNT(*) FILTER (WHERE metadata->>'classification' = 'bug')::numeric / 
        COUNT(*)::numeric * 100, 2) as bug_rate_pct
FROM checkpoints
WHERE metadata->>'experiment_id' = 'classifier_v2_test'
GROUP BY metadata->>'experiment_group';
```

### 3. Cost Allocation

```typescript
const metadata = createMetadata(input, {
  cost_center: 'customer_support',
  department: 'operations',
  project_code: 'CS-2024-001',
  billable: true,
  client_id: 'client-123'
});
```

**Cost Tracking:**

```sql
-- Monthly cost by department
SELECT 
  DATE((checkpoint->>'ts')::timestamp) as date,
  metadata->>'department' as department,
  metadata->>'cost_center' as cost_center,
  COUNT(*) as conversation_count
  -- Join with LangSmith/Langfuse for actual LLM costs
FROM checkpoints
GROUP BY date, department, cost_center;
```

### 4. Geographic Analysis

```typescript
const metadata = createMetadata(input, {
  region: 'eu-west-1',
  country: 'Germany',
  timezone: 'Europe/Berlin',
  language: 'de'
});
```

### 5. Performance Monitoring

```typescript
const metadata = createMetadata(input, {
  performance_tier: 'high_priority',
  max_response_time_ms: 5000,
  monitoring_enabled: true,
  alert_on_failure: true
});
```

---

## Integration with Observability Platforms

### LangSmith

Metadata appears in the LangSmith UI under each trace:

```typescript
// Metadata is automatically included in LangSmith traces
await graph.invoke(input, {
  configurable: { thread_id: threadId },
  metadata: metadata
});
```

**Querying LangSmith API:**

```typescript
import { Client } from 'langsmith';

const client = new Client();

// Find all traces for a specific user
const runs = await client.listRuns({
  projectName: 'your-project',
  filter: `eq(metadata.user_id, "user-123")`
});

// Find all enterprise conversations
const enterpriseRuns = await client.listRuns({
  projectName: 'your-project',
  filter: `eq(metadata.customer_tier, "enterprise")`
});
```

### Langfuse

Same metadata structure works with Langfuse:

```typescript
import { CallbackHandler } from 'langfuse-langchain';

const langfuseHandler = new CallbackHandler();

await graph.invoke(input, {
  configurable: { thread_id: threadId },
  metadata: metadata,
  callbacks: [langfuseHandler]
});
```

### PostgreSQL Checkpoints

Metadata is stored in the `metadata` column of the `checkpoints` table:

```sql
-- Query metadata directly
SELECT 
  thread_id,
  checkpoint_id,
  metadata->>'customer_tier' as tier,
  metadata->>'experiment_group' as group,
  metadata->'tags' as tags
FROM checkpoints
WHERE metadata->>'customer_tier' = 'enterprise';
```

---

## Best Practices

### 1. Be Consistent

Always use the `createMetadata` helper to ensure consistent structure:

```typescript
// ✅ Good - consistent
const metadata = createMetadata(input, additional);

// ❌ Bad - inconsistent
const metadata = {
  threadId: input.threadId,  // Different key name!
  request: input.requestId   // Different key name!
};
```

### 2. Add Context Early

Add metadata at the start of your workflow, not just at the end:

```typescript
// ✅ Good - metadata added at invocation
const result = await graph.invoke(input, {
  configurable: { thread_id: threadId },
  metadata: createMetadata(input)
});

// ❌ Bad - metadata added later
// You lose visibility into early steps
```

### 3. Use Structured Data

Use proper types and avoid free-form text:

```typescript
// ✅ Good - structured
priority: 'high' | 'medium' | 'low'
customer_tier: 'basic' | 'premium' | 'enterprise'

// ❌ Bad - free text
priority: 'URGENT - CUSTOMER IS MAD!!!'
customer_tier: 'Enterprise (VIP)'
```

### 4. Include Timestamps

Always include relevant timestamps:

```typescript
const metadata = createMetadata(input, {
  received_at: new Date().toISOString(),
  sla_deadline: new Date(Date.now() + 3600000).toISOString(), // +1 hour
  first_contact_at: user.firstContact?.toISOString()
});
```

### 5. Plan for Analytics

Think about what questions you'll want to answer:

```typescript
// ✅ Good - analytics-friendly
{
  customer_segment: 'enterprise',
  product_line: 'payments',
  issue_type: 'bug',
  resolution_time_sla: 2400 // seconds
}

// ❌ Bad - hard to analyze
{
  notes: 'Enterprise customer having payment issues, needs fast response'
}
```

### 6. Don't Store PII in Metadata

Metadata is often stored in observability platforms:

```typescript
// ✅ Good - no PII
{
  user_id: 'user-123',
  account_id: 'acct-456',
  domain: 'example.com'
}

// ❌ Bad - contains PII
{
  user_name: 'John Smith',
  ssn: '123-45-6789',
  credit_card: '4111-1111-1111-1111'
}
```

### 7. Version Your Metadata Schema

Track changes to your metadata structure:

```typescript
const metadata = createMetadata(input, {
  ...additional,
  metadata_version: '2.0',
  schema_updated_at: '2026-03-10'
});
```

---

## Common Patterns

### Pattern 1: Request Correlation

```typescript
// Correlate across multiple systems
const requestId = randomUUID();
const sessionId = getSessionId();

const metadata = createMetadata(input, {
  request_id: requestId,
  session_id: sessionId,
  trace_id: requestId, // For distributed tracing
  correlation_id: requestId
});
```

### Pattern 2: Feature Flag Tracking

```typescript
const metadata = createMetadata(input, {
  feature_flags: {
    new_classifier: true,
    enhanced_search: false,
    priority_routing: true
  },
  experiment: {
    name: 'classifier_v3',
    group: 'treatment',
    variant: 'B'
  }
});
```

### Pattern 3: Cost & Usage Tracking

```typescript
const metadata = createMetadata(input, {
  usage: {
    expected_tokens: 500,
    max_cost_usd: 0.10,
    budget_code: 'CS-Q2-2024'
  },
  limits: {
    max_retries: 3,
    timeout_seconds: 30,
    max_human_interventions: 2
  }
});
```

### Pattern 4: Compliance & Audit

```typescript
const metadata = createMetadata(input, {
  compliance: {
    gdpr_processed: true,
    consent_recorded: true,
    data_retention: '90_days',
    audit_required: false
  },
  security: {
    authenticated: true,
    mfa_verified: true,
    risk_score: 'low'
  }
});
```

---

## Migration Guide

### Adding Metadata to Existing Code

1. **Step 1**: Add the helper function
```typescript
// Copy the createMetadata function to your file
function createMetadata(input, additional = {}) {
  // ... implementation
}
```

2. **Step 2**: Update invocations
```typescript
// Before
await graph.invoke(input, { 
  configurable: { thread_id: threadId } 
});

// After
await graph.invoke(input, { 
  configurable: { thread_id: threadId },
  metadata: createMetadata(input)
});
```

3. **Step 3**: Add context-specific metadata
```typescript
// Add metadata relevant to your use case
const metadata = createMetadata(input, {
  business_unit: 'support',
  product: 'payment_system',
  version: 'v2.1.0'
});
```

---

## Troubleshooting

### Metadata Not Showing in LangSmith

1. Check you're passing `metadata` in the config:
```typescript
const config = {
  configurable: { thread_id: threadId },
  metadata: metadata  // Must be at this level
};
```

2. Verify environment variables:
```bash
echo $LANGCHAIN_TRACING_V2  # Should be "true"
echo $LANGCHAIN_API_KEY      # Should be set
```

### Metadata Not in PostgreSQL

Metadata is only stored in checkpoints, not in individual writes:

```sql
-- ✅ Metadata is here
SELECT metadata FROM checkpoints;

-- ❌ Metadata is NOT here
SELECT * FROM checkpoint_writes;  -- No metadata column
```

### Large Metadata Objects

Keep metadata reasonable (< 1KB):

```typescript
// ✅ Good - reference data
{
  customer_id: 'cust-123',
  product_id: 'prod-456'
}

// ❌ Bad - entire objects
{
  customer: { /* entire customer object */ },
  products: [ /* array of products */ ]
}
```

---

## Resources

- **Observability Guide**: `docs/langgraph-observability-guide.md`
- **SQL Analytics**: `sql/langgraph-checkpoint-analytics.sql`
- **Quick Start**: `docs/QUICK-START-OBSERVABILITY.md`
- **LangSmith Docs**: https://docs.smith.langchain.com
- **Langfuse Docs**: https://langfuse.com/docs
