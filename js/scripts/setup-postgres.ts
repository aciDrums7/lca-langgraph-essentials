#!/usr/bin/env tsx
import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres';

const DB_URI = process.env.POSTGRES_URI || 
  'postgresql://postgres:mysecretpassword@localhost:5432/postgres?sslmode=disable';

async function setupPostgres() {
  console.log('🔧 Setting up PostgreSQL checkpointer...');
  console.log(`📍 Connection: ${DB_URI.replace(/:[^:@]+@/, ':****@')}`);
  
  try {
    const checkpointer = PostgresSaver.fromConnString(DB_URI);
    
    console.log('⏳ Creating tables...');
    await checkpointer.setup();
    
    console.log('✅ PostgreSQL setup completed successfully!');
    console.log('📝 Tables created for LangGraph checkpointing');
    
    await checkpointer.end();
    process.exit(0);
  } catch (error) {
    console.error('❌ PostgreSQL setup failed:', error);
    console.error('\n💡 Make sure PostgreSQL is running on localhost:5432');
    console.error('   You can start it with: docker run -d -p 5432:5432 -e POSTGRES_PASSWORD=mysecretpassword postgres');
    process.exit(1);
  }
}

setupPostgres();
