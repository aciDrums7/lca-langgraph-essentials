-- ============================================================================
-- LangGraph PostgreSQL Checkpoint Analytics Queries
-- ============================================================================
-- Comprehensive SQL queries for analyzing LangGraph checkpoint data
-- Works with any LangGraph implementation using PostgresSaver
-- 
-- Tables:
--   - checkpoints: Main checkpoint snapshots with state and metadata
--   - checkpoint_blobs: Large serialized data (messages, complex objects)
--   - checkpoint_writes: Individual state channel updates
--   - checkpoint_migrations: Schema version tracking
-- ============================================================================

-- ============================================================================
-- SECTION 1: THREAD & CONVERSATION OVERVIEW
-- ============================================================================

-- 1.1 List all conversation threads with basic stats
-- Use case: Get overview of all conversations
SELECT 
  thread_id,
  COUNT(*) as total_checkpoints,
  MIN((checkpoint->>'ts')::timestamp) as first_activity,
  MAX((checkpoint->>'ts')::timestamp) as last_activity,
  MAX((checkpoint->>'ts')::timestamp) - MIN((checkpoint->>'ts')::timestamp) as conversation_duration,
  COUNT(DISTINCT checkpoint_id) as unique_states
FROM checkpoints
GROUP BY thread_id
ORDER BY last_activity DESC;

-- 1.2 Get conversation timeline for a specific thread
-- Use case: See the full execution flow of a conversation
-- Replace 'YOUR_THREAD_ID' with actual thread_id
SELECT 
  checkpoint_id,
  parent_checkpoint_id,
  (checkpoint->>'ts')::timestamp as timestamp,
  checkpoint->'channel_versions' as active_channels,
  checkpoint->'versions_seen' as versions_seen,
  metadata
FROM checkpoints
WHERE thread_id = 'YOUR_THREAD_ID'
ORDER BY (checkpoint->>'ts')::timestamp;

-- 1.3 Find most active threads (by checkpoint count)
-- Use case: Identify long-running or complex conversations
SELECT 
  thread_id,
  COUNT(*) as checkpoint_count,
  MAX((checkpoint->>'ts')::timestamp) as last_activity
FROM checkpoints
GROUP BY thread_id
ORDER BY checkpoint_count DESC
LIMIT 20;

-- 1.4 Find recently active threads
-- Use case: Monitor current activity
SELECT 
  thread_id,
  COUNT(*) as checkpoints,
  MAX((checkpoint->>'ts')::timestamp) as last_activity,
  EXTRACT(EPOCH FROM (NOW() - MAX((checkpoint->>'ts')::timestamp))) / 60 as minutes_since_last_activity
FROM checkpoints
GROUP BY thread_id
HAVING MAX((checkpoint->>'ts')::timestamp) > NOW() - INTERVAL '24 hours'
ORDER BY last_activity DESC;

-- ============================================================================
-- SECTION 2: STATE CHANNEL ANALYSIS
-- ============================================================================

-- 2.1 View all state channels for a thread
-- Use case: Understand what data is being tracked
SELECT DISTINCT
  cb.thread_id,
  cb.channel,
  cb.type,
  COUNT(*) as update_count,
  AVG(LENGTH(cb.blob)) as avg_blob_size_bytes,
  MAX(LENGTH(cb.blob)) as max_blob_size_bytes
FROM checkpoint_blobs cb
WHERE cb.thread_id = 'YOUR_THREAD_ID'
GROUP BY cb.thread_id, cb.channel, cb.type
ORDER BY update_count DESC;

-- 2.2 Get latest state for each channel in a thread
-- Use case: See current state snapshot
WITH latest_checkpoint AS (
  SELECT checkpoint_id, thread_id
  FROM checkpoints
  WHERE thread_id = 'YOUR_THREAD_ID'
  ORDER BY (checkpoint->>'ts')::timestamp DESC
  LIMIT 1
)
SELECT 
  cb.channel,
  cb.type,
  CASE 
    WHEN cb.type = 'json' THEN convert_from(cb.blob, 'UTF8')
    WHEN cb.type = 'empty' THEN 'null'
    ELSE 'binary data (' || LENGTH(cb.blob) || ' bytes)'
  END as value
FROM checkpoint_blobs cb
JOIN latest_checkpoint lc ON cb.thread_id = lc.thread_id
WHERE cb.version = (
  SELECT MAX(version) 
  FROM checkpoint_blobs 
  WHERE thread_id = cb.thread_id AND channel = cb.channel
)
ORDER BY cb.channel;

-- 2.3 Track state evolution for a specific channel
-- Use case: See how a particular field changed over time
SELECT 
  c.checkpoint_id,
  (c.checkpoint->>'ts')::timestamp as timestamp,
  cb.channel,
  CASE 
    WHEN cb.type = 'json' THEN convert_from(cb.blob, 'UTF8')
    ELSE 'binary'
  END as value
FROM checkpoints c
JOIN checkpoint_blobs cb ON c.thread_id = cb.thread_id
WHERE c.thread_id = 'YOUR_THREAD_ID'
  AND cb.channel = 'YOUR_CHANNEL_NAME' -- e.g., 'classification', 'draftResponse'
ORDER BY timestamp;

-- 2.4 Find all channels across all threads
-- Use case: Discover what state fields your graphs use
SELECT 
  channel,
  type,
  COUNT(DISTINCT thread_id) as thread_count,
  COUNT(*) as total_updates,
  AVG(LENGTH(blob)) as avg_size_bytes
FROM checkpoint_blobs
GROUP BY channel, type
ORDER BY total_updates DESC;

-- ============================================================================
-- SECTION 3: CHECKPOINT WRITES & NODE EXECUTION
-- ============================================================================

-- 3.1 View all node executions for a thread
-- Use case: See which nodes ran and in what order
SELECT 
  cw.checkpoint_id,
  c.checkpoint->>'ts' as timestamp,
  cw.task_id,
  cw.channel,
  cw.idx as write_index,
  cw.type,
  CASE 
    WHEN cw.type = 'json' THEN convert_from(cw.blob, 'UTF8')
    ELSE 'binary (' || LENGTH(cw.blob) || ' bytes)'
  END as value
FROM checkpoint_writes cw
JOIN checkpoints c ON cw.thread_id = c.thread_id AND cw.checkpoint_id = c.checkpoint_id
WHERE cw.thread_id = 'YOUR_THREAD_ID'
ORDER BY c.checkpoint->>'ts', cw.idx;

-- 3.2 Count executions per node/channel
-- Use case: Identify most frequently executed nodes
SELECT 
  channel,
  COUNT(*) as execution_count,
  COUNT(DISTINCT thread_id) as thread_count,
  COUNT(DISTINCT task_id) as unique_tasks
FROM checkpoint_writes
WHERE channel NOT LIKE 'branch:%' -- Exclude routing metadata
  AND channel != '__no_writes__'
GROUP BY channel
ORDER BY execution_count DESC;

-- 3.3 Find nodes that produced no output
-- Use case: Identify nodes that may have errors or no-op behavior
SELECT 
  thread_id,
  checkpoint_id,
  task_id,
  channel
FROM checkpoint_writes
WHERE channel = '__no_writes__'
ORDER BY thread_id, checkpoint_id;

-- 3.4 Analyze task execution patterns
-- Use case: Understand parallel vs sequential execution
SELECT 
  thread_id,
  checkpoint_id,
  COUNT(DISTINCT task_id) as concurrent_tasks,
  COUNT(*) as total_writes,
  array_agg(DISTINCT channel ORDER BY channel) as channels_updated
FROM checkpoint_writes
GROUP BY thread_id, checkpoint_id
HAVING COUNT(DISTINCT task_id) > 1 -- Only show checkpoints with multiple tasks
ORDER BY concurrent_tasks DESC;

-- ============================================================================
-- SECTION 4: METADATA & INTERRUPTS
-- ============================================================================

-- 4.1 Find all interrupted conversations
-- Use case: Identify human-in-the-loop interventions
SELECT 
  thread_id,
  checkpoint_id,
  (checkpoint->>'ts')::timestamp as timestamp,
  metadata->'writes' as pending_writes,
  metadata
FROM checkpoints
WHERE metadata::text LIKE '%__interrupt__%'
ORDER BY (checkpoint->>'ts')::timestamp DESC;

-- 4.2 Analyze interrupt patterns
-- Use case: Understand when and why interrupts occur
SELECT 
  thread_id,
  COUNT(*) as interrupt_count,
  MIN((checkpoint->>'ts')::timestamp) as first_interrupt,
  MAX((checkpoint->>'ts')::timestamp) as last_interrupt
FROM checkpoints
WHERE metadata::text LIKE '%__interrupt__%'
GROUP BY thread_id
ORDER BY interrupt_count DESC;

-- 4.3 View checkpoint metadata
-- Use case: Access custom metadata you've added
SELECT 
  thread_id,
  checkpoint_id,
  (checkpoint->>'ts')::timestamp as timestamp,
  metadata
FROM checkpoints
WHERE thread_id = 'YOUR_THREAD_ID'
ORDER BY (checkpoint->>'ts')::timestamp;

-- ============================================================================
-- SECTION 5: PERFORMANCE & DIAGNOSTICS
-- ============================================================================

-- 5.1 Calculate average checkpoints per conversation
-- Use case: Understand typical conversation complexity
SELECT 
  AVG(checkpoint_count) as avg_checkpoints_per_thread,
  MIN(checkpoint_count) as min_checkpoints,
  MAX(checkpoint_count) as max_checkpoints,
  PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY checkpoint_count) as median_checkpoints
FROM (
  SELECT thread_id, COUNT(*) as checkpoint_count
  FROM checkpoints
  GROUP BY thread_id
) t;

-- 5.2 Identify large state objects
-- Use case: Find memory/storage bottlenecks
SELECT 
  thread_id,
  channel,
  version,
  LENGTH(blob) as size_bytes,
  ROUND(LENGTH(blob)::numeric / 1024, 2) as size_kb
FROM checkpoint_blobs
WHERE LENGTH(blob) > 10000 -- Larger than 10KB
ORDER BY size_bytes DESC
LIMIT 50;

-- 5.3 Database storage statistics
-- Use case: Monitor database growth
SELECT 
  'checkpoints' as table_name,
  COUNT(*) as row_count,
  pg_size_pretty(pg_total_relation_size('checkpoints')) as total_size
FROM checkpoints
UNION ALL
SELECT 
  'checkpoint_blobs',
  COUNT(*),
  pg_size_pretty(pg_total_relation_size('checkpoint_blobs'))
FROM checkpoint_blobs
UNION ALL
SELECT 
  'checkpoint_writes',
  COUNT(*),
  pg_size_pretty(pg_total_relation_size('checkpoint_writes'))
FROM checkpoint_writes;

-- 5.4 Find orphaned checkpoints (no parent)
-- Use case: Identify potential data integrity issues
SELECT 
  thread_id,
  checkpoint_id,
  parent_checkpoint_id,
  (checkpoint->>'ts')::timestamp as timestamp
FROM checkpoints
WHERE parent_checkpoint_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM checkpoints c2
    WHERE c2.thread_id = checkpoints.thread_id
      AND c2.checkpoint_id = checkpoints.parent_checkpoint_id
  )
ORDER BY timestamp;

-- ============================================================================
-- SECTION 6: TIME-BASED ANALYTICS
-- ============================================================================

-- 6.1 Conversations by hour of day
-- Use case: Understand usage patterns
SELECT 
  EXTRACT(HOUR FROM (checkpoint->>'ts')::timestamp) as hour_of_day,
  COUNT(DISTINCT thread_id) as unique_threads,
  COUNT(*) as total_checkpoints
FROM checkpoints
GROUP BY hour_of_day
ORDER BY hour_of_day;

-- 6.2 Conversations by day
-- Use case: Track daily activity trends
SELECT 
  DATE((checkpoint->>'ts')::timestamp) as date,
  COUNT(DISTINCT thread_id) as unique_threads,
  COUNT(*) as total_checkpoints,
  COUNT(*) FILTER (WHERE metadata::text LIKE '%__interrupt__%') as interrupted_checkpoints
FROM checkpoints
GROUP BY date
ORDER BY date DESC;

-- 6.3 Average conversation duration
-- Use case: Understand how long conversations typically last
SELECT 
  thread_id,
  MIN((checkpoint->>'ts')::timestamp) as start_time,
  MAX((checkpoint->>'ts')::timestamp) as end_time,
  MAX((checkpoint->>'ts')::timestamp) - MIN((checkpoint->>'ts')::timestamp) as duration,
  COUNT(*) as checkpoint_count
FROM checkpoints
GROUP BY thread_id
HAVING COUNT(*) > 1
ORDER BY duration DESC;

-- ============================================================================
-- SECTION 7: ADVANCED QUERIES FOR SPECIFIC USE CASES
-- ============================================================================

-- 7.1 Reconstruct full conversation state at any point in time
-- Use case: Time-travel debugging
WITH target_checkpoint AS (
  SELECT checkpoint_id, thread_id
  FROM checkpoints
  WHERE thread_id = 'YOUR_THREAD_ID'
    AND checkpoint_id = 'YOUR_CHECKPOINT_ID'
)
SELECT 
  cb.channel,
  cb.type,
  cb.version,
  CASE 
    WHEN cb.type = 'json' THEN convert_from(cb.blob, 'UTF8')
    WHEN cb.type = 'empty' THEN 'null'
    ELSE 'binary'
  END as value
FROM checkpoint_blobs cb
JOIN target_checkpoint tc ON cb.thread_id = tc.thread_id
WHERE cb.version <= (
  SELECT (checkpoint->'channel_versions'->>cb.channel)::int
  FROM checkpoints
  WHERE thread_id = tc.thread_id AND checkpoint_id = tc.checkpoint_id
)
ORDER BY cb.channel, cb.version DESC;

-- 7.2 Find conversations with specific state values
-- Use case: Search for conversations matching criteria
SELECT DISTINCT
  cb.thread_id,
  c.checkpoint_id,
  (c.checkpoint->>'ts')::timestamp as timestamp,
  convert_from(cb.blob, 'UTF8') as value
FROM checkpoint_blobs cb
JOIN checkpoints c ON cb.thread_id = c.thread_id
WHERE cb.channel = 'YOUR_CHANNEL_NAME'
  AND cb.type = 'json'
  AND convert_from(cb.blob, 'UTF8') LIKE '%SEARCH_TERM%'
ORDER BY timestamp DESC;

-- 7.3 Compare state across multiple threads
-- Use case: Analyze patterns across conversations
SELECT 
  cb.thread_id,
  cb.channel,
  convert_from(cb.blob, 'UTF8') as value,
  c.checkpoint->>'ts' as timestamp
FROM checkpoint_blobs cb
JOIN checkpoints c ON cb.thread_id = c.thread_id AND cb.version = (
  SELECT MAX(version) FROM checkpoint_blobs 
  WHERE thread_id = cb.thread_id AND channel = cb.channel
)
WHERE cb.channel = 'classification' -- Example: compare classifications
  AND cb.type = 'json'
ORDER BY cb.thread_id;

-- 7.4 Find checkpoint chains (parent-child relationships)
-- Use case: Visualize execution graph
WITH RECURSIVE checkpoint_chain AS (
  -- Start with root checkpoints (no parent)
  SELECT 
    thread_id,
    checkpoint_id,
    parent_checkpoint_id,
    (checkpoint->>'ts')::timestamp as timestamp,
    1 as depth,
    ARRAY[checkpoint_id] as path
  FROM checkpoints
  WHERE parent_checkpoint_id IS NULL
    AND thread_id = 'YOUR_THREAD_ID'
  
  UNION ALL
  
  -- Recursively find children
  SELECT 
    c.thread_id,
    c.checkpoint_id,
    c.parent_checkpoint_id,
    (c.checkpoint->>'ts')::timestamp,
    cc.depth + 1,
    cc.path || c.checkpoint_id
  FROM checkpoints c
  JOIN checkpoint_chain cc ON c.parent_checkpoint_id = cc.checkpoint_id
    AND c.thread_id = cc.thread_id
)
SELECT 
  depth,
  checkpoint_id,
  parent_checkpoint_id,
  timestamp,
  array_to_string(path, ' -> ') as execution_path
FROM checkpoint_chain
ORDER BY depth, timestamp;

-- ============================================================================
-- SECTION 8: CLEANUP & MAINTENANCE
-- ============================================================================

-- 8.1 Find old conversations for archival
-- Use case: Identify data to archive or delete
SELECT 
  thread_id,
  COUNT(*) as checkpoint_count,
  MIN((checkpoint->>'ts')::timestamp) as first_activity,
  MAX((checkpoint->>'ts')::timestamp) as last_activity,
  EXTRACT(DAY FROM NOW() - MAX((checkpoint->>'ts')::timestamp)) as days_since_last_activity
FROM checkpoints
GROUP BY thread_id
HAVING MAX((checkpoint->>'ts')::timestamp) < NOW() - INTERVAL '30 days'
ORDER BY days_since_last_activity DESC;

-- 8.2 Calculate storage per thread
-- Use case: Identify storage-heavy conversations
SELECT 
  c.thread_id,
  COUNT(DISTINCT c.checkpoint_id) as checkpoint_count,
  SUM(LENGTH(cb.blob)) as total_blob_bytes,
  ROUND(SUM(LENGTH(cb.blob))::numeric / 1024 / 1024, 2) as total_mb
FROM checkpoints c
LEFT JOIN checkpoint_blobs cb ON c.thread_id = cb.thread_id
GROUP BY c.thread_id
ORDER BY total_blob_bytes DESC
LIMIT 50;

-- 8.3 Verify data integrity
-- Use case: Check for inconsistencies
SELECT 
  'Checkpoints without blobs' as issue,
  COUNT(*) as count
FROM checkpoints c
WHERE NOT EXISTS (
  SELECT 1 FROM checkpoint_blobs cb 
  WHERE cb.thread_id = c.thread_id
)
UNION ALL
SELECT 
  'Blobs without checkpoints',
  COUNT(DISTINCT thread_id)
FROM checkpoint_blobs cb
WHERE NOT EXISTS (
  SELECT 1 FROM checkpoints c 
  WHERE c.thread_id = cb.thread_id
)
UNION ALL
SELECT 
  'Writes without checkpoints',
  COUNT(DISTINCT thread_id)
FROM checkpoint_writes cw
WHERE NOT EXISTS (
  SELECT 1 FROM checkpoints c 
  WHERE c.thread_id = cw.thread_id
);

-- ============================================================================
-- SECTION 9: EXPORT QUERIES FOR EXTERNAL ANALYTICS
-- ============================================================================

-- 9.1 Export conversation summary for BI tools
-- Use case: Feed data into Tableau, PowerBI, etc.
SELECT 
  c.thread_id,
  COUNT(DISTINCT c.checkpoint_id) as total_checkpoints,
  MIN((c.checkpoint->>'ts')::timestamp) as conversation_start,
  MAX((c.checkpoint->>'ts')::timestamp) as conversation_end,
  EXTRACT(EPOCH FROM (MAX((c.checkpoint->>'ts')::timestamp) - MIN((c.checkpoint->>'ts')::timestamp))) as duration_seconds,
  COUNT(*) FILTER (WHERE c.metadata::text LIKE '%__interrupt__%') as interrupt_count,
  COUNT(DISTINCT cw.channel) as unique_channels_used,
  SUM(LENGTH(cb.blob)) as total_data_bytes
FROM checkpoints c
LEFT JOIN checkpoint_writes cw ON c.thread_id = cw.thread_id
LEFT JOIN checkpoint_blobs cb ON c.thread_id = cb.thread_id
GROUP BY c.thread_id
ORDER BY conversation_start DESC;

-- 9.2 Export state transitions for process mining
-- Use case: Analyze workflow patterns
SELECT 
  cw.thread_id,
  c.checkpoint_id,
  (c.checkpoint->>'ts')::timestamp as timestamp,
  cw.channel as activity,
  cw.task_id,
  ROW_NUMBER() OVER (PARTITION BY cw.thread_id ORDER BY c.checkpoint->>'ts') as sequence_number
FROM checkpoint_writes cw
JOIN checkpoints c ON cw.thread_id = c.thread_id AND cw.checkpoint_id = c.checkpoint_id
WHERE cw.channel NOT LIKE 'branch:%'
  AND cw.channel != '__no_writes__'
ORDER BY cw.thread_id, timestamp;

-- ============================================================================
-- USAGE NOTES
-- ============================================================================
-- 
-- 1. Replace 'YOUR_THREAD_ID' with actual thread_id values from your data
-- 2. Replace 'YOUR_CHANNEL_NAME' with actual channel names (e.g., 'messages', 'classification')
-- 3. Replace 'YOUR_CHECKPOINT_ID' with actual checkpoint_id values
-- 4. Adjust time intervals (e.g., '24 hours', '30 days') based on your needs
-- 5. For production use, add appropriate indexes:
--    CREATE INDEX idx_checkpoints_thread_ts ON checkpoints(thread_id, ((checkpoint->>'ts')::timestamp));
--    CREATE INDEX idx_checkpoint_blobs_thread_channel ON checkpoint_blobs(thread_id, channel);
--    CREATE INDEX idx_checkpoint_writes_thread ON checkpoint_writes(thread_id, checkpoint_id);
-- 
-- ============================================================================
