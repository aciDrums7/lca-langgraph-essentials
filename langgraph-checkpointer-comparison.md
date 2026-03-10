# LangGraph Checkpointer Comparison: PostgreSQL vs MongoDB vs Redis

**Production Analysis for Persistence Layer Selection**

---

## Executive Summary

LangGraph offers three production-ready checkpointer implementations for state persistence: **PostgreSQL**, **MongoDB**, and **Redis**. Each serves different production requirements with distinct trade-offs across performance, cost, reliability, and scalability.

**Quick Recommendation:**
- **PostgreSQL**: Default choice for most production applications (reference implementation)
- **MongoDB**: High-scale, write-heavy workloads with horizontal scaling needs
- **Redis**: Ultra-low latency real-time applications with strict SLA requirements
- **Hybrid**: Redis (hot) + PostgreSQL/MongoDB (cold) for large-scale deployments

---

## 1. Overview

### What is a Checkpointer?

Checkpointers provide state persistence for LangGraph workflows, enabling:
- **Human-in-the-loop workflows**: Pause, inspect, and resume execution
- **Conversation memory**: Maintain context across sessions
- **Time-travel debugging**: Replay and fork execution history
- **Fault tolerance**: Recover from failures without losing progress
- **Pending writes**: Resume from last successful step after partial failures

### Available Implementations

| Package | Database | Production Status | Primary Use Case |
|---------|----------|-------------------|------------------|
| `@langchain/langgraph-checkpoint-postgres` | PostgreSQL | ✅ Production (LangSmith) | General-purpose, high reliability |
| `@langchain/langgraph-checkpoint-mongodb` | MongoDB | ✅ Production | High-scale, flexible schemas |
| `@langchain/langgraph-checkpoint-redis` | Redis | ✅ Production | Real-time, low-latency |
| `@langchain/langgraph-checkpoint-sqlite` | SQLite | ⚠️ Development only | Local workflows, testing |
| `@langchain/langgraph` (MemorySaver) | In-Memory | ⚠️ Development only | Experimentation |

---

## 2. Detailed Comparison

### 2.1 Performance

#### PostgreSQL (PostgresSaver)
**Latency Profile:**
- Read operations: 10-50ms (depending on checkpoint size)
- Write operations: 20-100ms (with proper connection pooling)
- Known bottleneck: `jsonb_each_text` deserialization at scale

**Performance Characteristics:**
- Normalized relational storage with JSONB for state serialization
- Requires connection pooling (PgBouncer) to prevent timeouts on long-running operations
- Query performance degrades without proper indexing on `thread_id` and `checkpoint_id`
- Suitable for applications where consistency > raw speed

**Optimization Tips:**
```typescript
// Use connection pooling
import { ConnectionPool } from 'psycopg_pool';
const pool = new ConnectionPool(connString, { 
  max_size: 10,
  kwargs: { autocommit: true } 
});
const checkpointer = new PostgresSaver(pool);
```

**Real-World Performance:**
- Used in LangSmith production environment
- Handles millions of checkpoints with proper indexing
- Moderate latency acceptable for most agent workflows

---

#### MongoDB (MongoDBSaver)
**Latency Profile:**
- Read operations: 5-30ms (document-oriented, faster than relational joins)
- Write operations: 10-50ms (good for high-throughput scenarios)
- Performance degrades if checkpoint collection grows unbounded

**Performance Characteristics:**
- Document-oriented storage naturally fits checkpoint structure
- No JOIN operations (faster than normalized PostgreSQL queries)
- Requires TTL indexes for automatic checkpoint cleanup
- Horizontal scaling via sharding for write-heavy workloads

**Known Issues:**
- Checkpoint collection can grow excessively large without TTL management
- Requires active monitoring of collection size
- Compaction needed for long-running applications

**Optimization Tips:**
```typescript
// Configure TTL for automatic cleanup
await db.collection('checkpoints').createIndex(
  { "createdAt": 1 }, 
  { expireAfterSeconds: 2592000 } // 30 days
);
```

---

#### Redis (RedisSaver)
**Latency Profile:**
- Read operations: **1-5ms** (in-memory, fastest)
- Write operations: **2-10ms** (in-memory, fastest)
- Sub-millisecond latency for hot data

**Performance Characteristics:**
- **Version 0.1.0 Redesign**: Moved from normalized (PostgreSQL-like) to denormalized storage
- Eliminated O(m) FT.SEARCH queries per checkpoint retrieval
- Inline channel values (no separate blob storage)
- Two variants:
  - **RedisSaver**: Full checkpoint history
  - **ShallowRedisSaver**: Latest checkpoint only (memory-optimized)

**Performance Breakthrough:**
The v0.1.0 redesign represents a fundamental shift from "make it work" to "make it fast":
- **Before**: Adapted PostgreSQL patterns (normalized, relational)
- **After**: Redis-native denormalization (document-oriented, inline storage)

**Use Case for Speed:**
Ideal for real-time conversational AI where MLPerf benchmarks target:
- TTFT (Time To First Token): < 1 second
- TPOT (Time Per Output Token): tens of milliseconds

**Trade-off:**
- Fastest latency
- Highest memory cost
- Requires Redis Stack (Redis 8.0+) or modules (RedisJSON, RediSearch)

---

### 2.2 Cost Analysis

#### PostgreSQL
**Cost Structure:**
- **Storage**: Disk-based (cheap, ~$0.10/GB/month)
- **Compute**: Moderate (managed RDS ~$50-500/month depending on instance)
- **Scaling**: Vertical scaling (larger instances)

**Cost Efficiency:**
- ✅ Most cost-effective for long-term checkpoint retention
- ✅ Disk storage is 10-50x cheaper than Redis memory
- ✅ Mature managed services (AWS RDS, Google Cloud SQL, Supabase)

**Total Cost of Ownership (TCO):**
- **Small-scale** (< 1M checkpoints): ~$50-100/month
- **Medium-scale** (1-10M checkpoints): ~$200-500/month
- **Large-scale** (> 10M checkpoints): ~$500-2000/month

---

#### MongoDB
**Cost Structure:**
- **Storage**: Disk-based (similar to PostgreSQL)
- **Compute**: Moderate (MongoDB Atlas comparable to RDS)
- **Scaling**: Horizontal scaling (add shards)

**Cost Efficiency:**
- ✅ Competitive with PostgreSQL for storage
- ✅ Horizontal scaling can be more cost-effective than vertical
- ⚠️ Requires TTL management to prevent unbounded growth

**Total Cost of Ownership (TCO):**
- **Small-scale**: ~$50-150/month
- **Medium-scale**: ~$200-600/month
- **Large-scale**: ~$500-2500/month (depends on sharding strategy)

---

#### Redis
**Cost Structure:**
- **Storage**: In-memory (expensive, ~$5-20/GB/month)
- **Compute**: High (managed Redis ~$100-1000/month)
- **Scaling**: Memory constraints limit dataset size

**Cost Efficiency:**
- ❌ **Most expensive** for large-scale deployments
- ❌ Memory costs 50-200x more than disk storage
- ✅ ShallowRedisSaver reduces costs (latest checkpoint only)
- ✅ TTL support for automatic cleanup

**Total Cost of Ownership (TCO):**
- **Small-scale** (< 100K checkpoints, ShallowRedisSaver): ~$100-200/month
- **Medium-scale** (100K-1M checkpoints): ~$500-1500/month
- **Large-scale** (> 1M checkpoints, full history): ~$2000-10000/month ⚠️

**Critical Consideration:**
If you need full checkpoint history for time-travel/debugging across millions of sessions, Redis costs can become prohibitive. Use ShallowRedisSaver or hybrid architecture.

---

### 2.3 Reliability & Fault Tolerance

#### PostgreSQL ⭐⭐⭐⭐⭐
**Reliability Features:**
- **ACID guarantees**: Strongest consistency model
- **WAL (Write-Ahead Logging)**: Point-in-time recovery
- **Replication**: Streaming and logical replication
- **Backup/Restore**: Mature tooling (pg_dump, pg_restore, PITR)
- **Proven at scale**: Used in LangSmith production

**Fault Tolerance:**
- ✅ Zero data loss with synchronous replication
- ✅ Automatic failover with managed services
- ✅ Transaction rollback on failures
- ✅ Best for mission-critical applications

**Durability:**
- **RTO (Recovery Time Objective)**: Minutes
- **RPO (Recovery Point Objective)**: Zero (with sync replication)

---

#### MongoDB ⭐⭐⭐⭐
**Reliability Features:**
- **Replica Sets**: Automatic failover
- **Journaling**: Write-ahead logging for durability
- **WiredTiger**: Document-level locking, compression
- **Backup**: Continuous backup with Atlas

**Fault Tolerance:**
- ✅ Strong consistency with majority write concern
- ✅ Automatic failover (typically < 30 seconds)
- ✅ Good balance between performance and reliability

**Durability:**
- **RTO**: Seconds to minutes
- **RPO**: Near-zero (with journaling)

**Consideration:**
- Eventual consistency possible with default write concern
- Requires proper replica set configuration for production

---

#### Redis ⭐⭐⭐
**Reliability Features:**
- **Persistence Options**:
  - RDB (snapshots): Point-in-time backups
  - AOF (Append-Only File): Log every write operation
- **Replication**: Master-replica for HA
- **Redis Cluster**: Automatic sharding and failover

**Fault Tolerance:**
- ⚠️ Risk of data loss on crash (if persistence not configured)
- ⚠️ Eventual consistency in replication
- ✅ Redis Cluster provides HA
- ✅ Good for scenarios where some data loss is acceptable

**Durability:**
- **RTO**: Seconds to minutes
- **RPO**: Seconds to minutes (depending on AOF fsync policy)

**Critical Configuration:**
```redis
# For maximum durability (slower)
appendonly yes
appendfsync always

# Balanced (recommended)
appendfsync everysec

# Fastest (risk of data loss)
appendfsync no
```

**Best Practice:**
Pair Redis with a durable backup strategy or use for ephemeral/reconstructable data.

---

### 2.4 Scalability

#### PostgreSQL ⭐⭐⭐
**Scaling Model:**
- **Vertical scaling**: Primary approach (larger instances)
- **Read replicas**: Horizontal read scaling
- **Partitioning**: Table partitioning by `thread_id` or date
- **Connection pooling**: Essential (PgBouncer, pgpool)

**Scalability Limits:**
- ✅ Proven at enterprise scale (LangSmith handles millions of checkpoints)
- ⚠️ Write scaling limited (single primary)
- ⚠️ Query performance requires careful indexing
- ⚠️ Connection management critical at scale

**Scaling Strategy:**
```sql
-- Partition by thread_id for better query performance
CREATE TABLE checkpoints_partition_0 PARTITION OF checkpoints
  FOR VALUES WITH (MODULUS 10, REMAINDER 0);
```

---

#### MongoDB ⭐⭐⭐⭐⭐
**Scaling Model:**
- **Horizontal scaling**: Native sharding support
- **Auto-balancing**: Automatic data distribution
- **Shard key**: Natural partitioning by `thread_id`
- **Write scaling**: Distributes writes across shards

**Scalability Limits:**
- ✅ **Best horizontal scalability** among the three
- ✅ Scales well for write-heavy workloads
- ✅ Document model naturally fits checkpoint data
- ⚠️ Requires active checkpoint lifecycle management

**Scaling Strategy:**
```javascript
// Shard by thread_id for even distribution
sh.shardCollection("langgraph.checkpoints", { thread_id: "hashed" });
```

**Real-World Scale:**
- Handles billions of documents
- Linear write scaling with additional shards
- Ideal for multi-tenant SaaS (shard by tenant_id)

---

#### Redis ⭐⭐⭐⭐
**Scaling Model:**
- **Redis Cluster**: Horizontal scaling via sharding
- **Key-based sharding**: Automatic distribution by key hash
- **Memory constraints**: Total dataset limited by available RAM
- **ShallowRedisSaver**: Auto-cleanup helps manage size

**Scalability Limits:**
- ✅ Scales well for high-throughput, low-latency scenarios
- ✅ Linear performance scaling with cluster nodes
- ❌ **Memory is the limiting factor**
- ✅ Best for bounded dataset size (recent sessions)

**Scaling Strategy:**
- Use ShallowRedisSaver for memory efficiency
- Configure TTL for automatic expiration
- Hybrid architecture: Redis (hot) + PostgreSQL/MongoDB (cold)

---

### 2.5 Operational Considerations

#### PostgreSQL
**Operational Complexity:** ⭐⭐ (Low-Medium)

**Pros:**
- ✅ Mature ecosystem and tooling (pgAdmin, DataGrip, monitoring)
- ✅ Most developers familiar with SQL
- ✅ Extensive documentation and community support
- ✅ Easy to debug with SQL queries
- ✅ Straightforward backup/restore

**Cons:**
- ⚠️ Connection management critical (requires pooling)
- ⚠️ Vacuum and maintenance needed
- ⚠️ Index management for performance

**Monitoring:**
```sql
-- Monitor checkpoint table size
SELECT pg_size_pretty(pg_total_relation_size('checkpoints'));

-- Check slow queries
SELECT * FROM pg_stat_statements 
ORDER BY mean_exec_time DESC LIMIT 10;
```

---

#### MongoDB
**Operational Complexity:** ⭐⭐⭐ (Medium)

**Pros:**
- ✅ Rich query language (aggregation pipeline)
- ✅ Good monitoring tools (Atlas, Compass)
- ✅ Flexible schema evolution
- ✅ Managed service (Atlas) simplifies operations

**Cons:**
- ⚠️ Requires NoSQL expertise
- ⚠️ TTL indexes essential for checkpoint cleanup
- ⚠️ Sharding adds operational complexity
- ⚠️ Less familiar to SQL-focused teams

**Monitoring:**
```javascript
// Monitor checkpoint collection size
db.checkpoints.stats();

// Set up TTL index
db.checkpoints.createIndex(
  { "createdAt": 1 }, 
  { expireAfterSeconds: 2592000 }
);
```

---

#### Redis
**Operational Complexity:** ⭐⭐⭐⭐ (Medium-High)

**Pros:**
- ✅ Simple key-value operations
- ✅ Excellent monitoring (RedisInsight, redis-cli)
- ✅ Built-in TTL support
- ✅ Fast troubleshooting

**Cons:**
- ⚠️ **Requires Redis Stack** or modules (RedisJSON, RediSearch)
- ⚠️ Memory monitoring critical
- ⚠️ Eviction policies must be configured carefully
- ⚠️ Persistence configuration impacts performance

**Critical Configuration:**
```redis
# Memory management
maxmemory 2gb
maxmemory-policy allkeys-lru  # Or noeviction for checkpoints

# Persistence
save 900 1
save 300 10
appendonly yes
```

**Monitoring:**
```bash
# Memory usage
redis-cli INFO memory

# Check TTL on checkpoints
redis-cli TTL checkpoint:thread_123:checkpoint_456
```

---

## 3. Use Case Recommendations

### 3.1 PostgreSQL: The Safe Default

**Ideal For:**
- ✅ Applications requiring full audit trails and compliance
- ✅ Time-travel debugging and workflow replay
- ✅ Long-running workflows with complex state
- ✅ Human-in-the-loop workflows with extended pauses
- ✅ Enterprise applications where reliability > performance
- ✅ Teams familiar with SQL and relational databases

**Example Scenarios:**
- Legal document review agents (compliance, audit trail)
- Financial advisory agents (regulatory requirements)
- Medical diagnosis assistants (patient history, liability)
- Multi-step approval workflows (days/weeks duration)

**Architecture Pattern:**
```typescript
import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres';

const checkpointer = PostgresSaver.fromConnString(
  process.env.DATABASE_URL
);
await checkpointer.setup();

const graph = workflow.compile({ checkpointer });
```

---

### 3.2 MongoDB: The Scalability Champion

**Ideal For:**
- ✅ High write throughput (thousands of checkpoints/second)
- ✅ Flexible/evolving agent architectures
- ✅ Global distribution requirements (multi-region)
- ✅ Multi-tenant SaaS (shard by tenant_id)
- ✅ Applications already using MongoDB

**Example Scenarios:**
- Multi-tenant chatbot platforms (millions of users)
- Global customer support agents (distributed data)
- IoT agent orchestration (high write volume)
- Rapid prototyping with evolving schemas

**Architecture Pattern:**
```typescript
import { MongoDBSaver } from '@langchain/langgraph-checkpoint-mongodb';

const checkpointer = new MongoDBSaver({
  connectionString: process.env.MONGODB_URI,
  dbName: 'langgraph',
  ttl: 30 * 24 * 60 * 60 // 30 days
});

const graph = workflow.compile({ checkpointer });
```

---

### 3.3 Redis: The Speed Demon

**Ideal For:**
- ✅ Real-time conversational AI (< 100ms latency requirements)
- ✅ High-frequency short-lived sessions
- ✅ Applications where recent state matters more than history
- ✅ Caching layer for hot checkpoints
- ✅ Stateless-like agents (ShallowRedisSaver)

**Example Scenarios:**
- Real-time customer service chatbots (instant responses)
- Live trading/financial agents (millisecond decisions)
- Gaming AI companions (low-latency interactions)
- Voice assistants (strict latency SLAs)

**Architecture Pattern:**
```typescript
import { RedisSaver } from '@langchain/langgraph-checkpoint-redis';
// or
import { ShallowRedisSaver } from '@langchain/langgraph-checkpoint-redis/shallow';

const checkpointer = await RedisSaver.fromUrl(
  process.env.REDIS_URL,
  {
    defaultTTL: 60, // 60 minutes
    refreshOnRead: true
  }
);

const graph = workflow.compile({ checkpointer });
```

---

### 3.4 Hybrid Architecture: Best of Both Worlds

**Recommended for Large-Scale Production**

**Architecture:**
```
┌─────────────────────────────────────────────────┐
│  Active Sessions (Hot Data)                     │
│  ┌──────────────────────────────────────────┐  │
│  │  Redis (RedisSaver or ShallowRedisSaver) │  │
│  │  - Sub-10ms latency                      │  │
│  │  - Last 1-24 hours of activity           │  │
│  │  - TTL: 1-24 hours                       │  │
│  └──────────────────────────────────────────┘  │
│                    ↓ (async archival)           │
│  ┌──────────────────────────────────────────┐  │
│  │  PostgreSQL or MongoDB (Cold Storage)    │  │
│  │  - Full checkpoint history               │  │
│  │  - Time-travel, debugging, compliance    │  │
│  │  - TTL: 30-90 days or indefinite         │  │
│  └──────────────────────────────────────────┘  │
└─────────────────────────────────────────────────┘
```

**Benefits:**
- ✅ Redis speed for active conversations
- ✅ PostgreSQL/MongoDB durability for archival
- ✅ Cost optimization (memory for hot, disk for cold)
- ✅ Best reliability (Redis failure doesn't lose history)

**Implementation Strategy:**
```typescript
// Dual-checkpointer pattern
class HybridCheckpointer {
  constructor(
    private redis: RedisSaver,
    private postgres: PostgresSaver
  ) {}

  async put(config, checkpoint, metadata) {
    // Write to both (async for postgres)
    await this.redis.put(config, checkpoint, metadata);
    this.postgres.put(config, checkpoint, metadata).catch(console.error);
  }

  async getTuple(config) {
    // Try Redis first (hot), fallback to Postgres (cold)
    const hot = await this.redis.getTuple(config);
    if (hot) return hot;
    
    const cold = await this.postgres.getTuple(config);
    if (cold) {
      // Warm up Redis cache
      await this.redis.put(config, cold.checkpoint, cold.metadata);
    }
    return cold;
  }
}
```

**Trade-off:**
- Increased complexity (synchronization logic)
- Eventual consistency between tiers
- Worth it for large-scale production (100K+ daily sessions)

---

## 4. Decision Matrix

### Quick Selection Guide

| Requirement | PostgreSQL | MongoDB | Redis |
|-------------|-----------|---------|-------|
| **Latency < 10ms** | ❌ | ❌ | ✅ |
| **Latency < 50ms** | ✅ | ✅ | ✅ |
| **Cost-effective at scale** | ✅ | ✅ | ❌ |
| **ACID guarantees** | ✅ | ⚠️ | ❌ |
| **Horizontal scaling** | ⚠️ | ✅ | ✅ |
| **Full checkpoint history** | ✅ | ✅ | ⚠️ |
| **Time-travel debugging** | ✅ | ✅ | ⚠️ |
| **Operational simplicity** | ✅ | ⚠️ | ⚠️ |
| **Team familiarity (SQL)** | ✅ | ❌ | ❌ |
| **Managed service maturity** | ✅ | ✅ | ✅ |

---

### Decision Tree

```
Start
  │
  ├─ Need latency < 10ms?
  │   └─ YES → Redis (ShallowRedisSaver if cost-sensitive)
  │
  ├─ Need horizontal scaling (millions of writes/day)?
  │   └─ YES → MongoDB
  │
  ├─ Need strongest reliability/ACID?
  │   └─ YES → PostgreSQL
  │
  ├─ Already using MongoDB/Redis in stack?
  │   └─ YES → Use existing infrastructure
  │
  └─ Default → PostgreSQL (reference implementation)
```

---

## 5. Migration Considerations

### 5.1 Switching Checkpointers

**Challenge:** Checkpointers are not directly compatible (different schemas).

**Migration Strategies:**

#### Strategy 1: Hard Cutover (Simplest)
```typescript
// 1. Stop accepting new sessions on old checkpointer
// 2. Let active sessions complete or expire
// 3. Switch to new checkpointer
// 4. Archive old data for compliance

const oldCheckpointer = new PostgresSaver(...);
const newCheckpointer = new MongoDBSaver(...);

// After cutover date
const graph = workflow.compile({ checkpointer: newCheckpointer });
```

**Pros:** Simple, clean break  
**Cons:** Loses in-flight session state

---

#### Strategy 2: Gradual Migration (Recommended)
```typescript
// Route new sessions to new checkpointer
// Keep old checkpointer for existing sessions

class MigrationCheckpointer {
  async getTuple(config) {
    const threadId = config.configurable.thread_id;
    
    // Check if thread exists in new system
    const newData = await this.newCheckpointer.getTuple(config);
    if (newData) return newData;
    
    // Fallback to old system and migrate
    const oldData = await this.oldCheckpointer.getTuple(config);
    if (oldData) {
      await this.newCheckpointer.put(config, oldData.checkpoint, oldData.metadata);
    }
    return oldData;
  }
}
```

**Pros:** Zero downtime, preserves state  
**Cons:** More complex, runs dual systems temporarily

---

### 5.2 Data Export/Import

**PostgreSQL → MongoDB:**
```bash
# Export from PostgreSQL
pg_dump -t checkpoints -F c langgraph > checkpoints.dump

# Transform and import to MongoDB (custom script needed)
node scripts/postgres-to-mongo.js
```

**MongoDB → Redis:**
Not recommended due to Redis memory constraints. Use hybrid architecture instead.

---

## 6. Performance Benchmarks (Estimated)

### Checkpoint Operations (1KB checkpoint size)

| Operation | PostgreSQL | MongoDB | Redis |
|-----------|-----------|---------|-------|
| **Write** | 20-50ms | 10-30ms | 2-5ms |
| **Read (latest)** | 10-30ms | 5-20ms | 1-3ms |
| **Read (history)** | 50-200ms | 20-100ms | 5-20ms |
| **List (100 items)** | 100-500ms | 50-200ms | 10-50ms |

### Throughput (checkpoints/second)

| Checkpointer | Single Instance | Scaled (3 nodes) |
|--------------|----------------|------------------|
| PostgreSQL | 500-1000 | 1000-2000 (read replicas) |
| MongoDB | 1000-5000 | 10000-50000 (sharded) |
| Redis | 10000-50000 | 50000-200000 (cluster) |

**Note:** Benchmarks vary significantly based on checkpoint size, network latency, and infrastructure.

---

## 7. Common Pitfalls & Best Practices

### PostgreSQL
**Pitfall:** Forgetting connection pooling → connection exhaustion  
**Solution:** Always use PgBouncer or connection pools

**Pitfall:** No indexes on `thread_id` → slow queries  
**Solution:** Ensure proper indexing during setup

**Pitfall:** Large JSONB deserialization → performance bottleneck  
**Solution:** Keep checkpoint state minimal, use external storage for large blobs

---

### MongoDB
**Pitfall:** Unbounded checkpoint growth → storage explosion  
**Solution:** Always configure TTL indexes

```javascript
db.checkpoints.createIndex(
  { "createdAt": 1 }, 
  { expireAfterSeconds: 2592000 } // 30 days
);
```

**Pitfall:** Wrong shard key → uneven distribution  
**Solution:** Use `thread_id` hashed for even distribution

---

### Redis
**Pitfall:** No persistence configured → data loss on restart  
**Solution:** Enable AOF with `appendfsync everysec`

**Pitfall:** No eviction policy → OOM errors  
**Solution:** Configure `maxmemory-policy` appropriately

**Pitfall:** Missing Redis modules → checkpointer won't work  
**Solution:** Use Redis Stack (8.0+) or install RedisJSON + RediSearch

---

## 8. Final Recommendation

### For Most Teams: Start with PostgreSQL

**Rationale:**
1. **Battle-tested**: Reference implementation used in LangSmith
2. **Lowest risk**: Strongest reliability and ACID guarantees
3. **Cost-effective**: Cheapest for long-term storage
4. **Familiar**: Most teams know SQL
5. **Proven at scale**: Handles millions of checkpoints

**When to Switch:**
- **To MongoDB**: When you hit horizontal scaling limits (> 10K writes/sec)
- **To Redis**: When latency becomes critical (< 10ms requirement)
- **To Hybrid**: When you have 100K+ daily active sessions

---

### Production Checklist

Before deploying any checkpointer:

- [ ] **Connection pooling** configured (PostgreSQL)
- [ ] **TTL/cleanup** strategy implemented (all)
- [ ] **Monitoring** set up (disk/memory usage, query performance)
- [ ] **Backup/restore** tested
- [ ] **Failover** tested (managed service or replica sets)
- [ ] **Load testing** completed (expected throughput)
- [ ] **Cost modeling** validated (storage + compute projections)
- [ ] **Security** configured (encryption at rest, in transit)

---

## 9. Additional Resources

### Official Documentation
- [LangGraph Persistence Docs](https://docs.langchain.com/oss/javascript/langgraph/persistence)
- [PostgresSaver API Reference](https://reference.langchain.com/javascript/langchain-langgraph-checkpoint-postgres/index/PostgresSaver)
- [MongoDBSaver Announcement](https://mongodb.com/company/blog/innovation/checkpointers-native-parent-child-retrievers-with-langchain-mongodb)
- [RedisSaver v0.1.0 Release](https://redis.io/blog/langgraph-redis-checkpoint-010/)

### Community Resources
- [LangGraph GitHub Discussions](https://github.com/langchain-ai/langgraph/discussions)
- [LangChain Forum](https://forum.langchain.com/)
- [Redis LangGraph Integration](https://redis.io/blog/build-smarter-ai-agents-manage-short-term-and-long-term-memory-with-redis/)

### Performance Deep Dives
- [Internals of Postgres Checkpointer](https://blog.lordpatil.com/posts/langgraph-postgres-checkpointer/)
- [LangGraph in Production: Latency, Replay, and Scale](https://aerospike.com/blog/langgraph-production-latency-replay-scale)
- [Scaling LangGraph with Redis](https://www.athousandnodes.com/posts/scaling-langgraph-production)

---

## Conclusion

Choosing the right checkpointer is a critical architectural decision that impacts performance, cost, and reliability of your LangGraph application.

**The safe path:** PostgreSQL for most applications  
**The scale path:** MongoDB for horizontal growth  
**The speed path:** Redis for real-time requirements  
**The optimal path:** Hybrid architecture for large-scale production

Evaluate your specific requirements against the trade-offs presented in this analysis, and remember: **you can always migrate later** as your needs evolve.

---

*Last Updated: March 2026*  
*Based on LangGraph.js latest stable releases*
