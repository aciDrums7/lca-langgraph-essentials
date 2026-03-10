// L2 Email Workflow - Complete email processing workflow

import { Command, END, interrupt, START, StateGraph } from '@langchain/langgraph';
import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres';
import { ChatOpenAI } from '@langchain/openai';
import z from 'zod';
import { config } from 'dotenv';
import { randomUUID } from 'node:crypto';

config();

const llm = new ChatOpenAI({ model: 'gpt-5-nano' });

export const EmailClassificationSchema = z.object({
  intent: z.enum(['question', 'bug', 'billing', 'feature', 'complex']),
  urgency: z.enum(['low', 'medium', 'high', 'critical']),
  topic: z.string(),
  summary: z.string(),
});

export const EmailStateDefinition = z.object({
  emailContent: z.string(),
  senderEmail: z.string(),
  emailId: z.string(),
  classification: EmailClassificationSchema.optional(),
  ticketId: z.string().optional(),
  searchResults: z.array(z.string()).optional(),
  customerHistory: z.record(z.string(), z.any()).optional(),
  draftResponse: z.string().optional(),
});

export type EmailAgentState = z.infer<typeof EmailStateDefinition>;

function readEmail(state: EmailAgentState) {
  // In production, this would connect to your email service
  // emailContent is being passed in when the graph is invoked
  console.log(`Processing email from: ${state.senderEmail}`);
  return {};
}

async function classifyIntent(state: EmailAgentState) {
  console.log('Classifying email intent and urgency...');

  // Create structured LLM that returns EmailClassification
  const structuredLlm = llm.withStructuredOutput(EmailClassificationSchema);

  // Format the prompt on-demand
  const classificationPrompt = `
Analyze this customer email and classify it:

Email: ${state.emailContent}
From: ${state.senderEmail}

Provide classification, including intent, urgency, topic, and summary.
  `;

  try {
    // Get structured response directly as object
    const classification = await structuredLlm.invoke(classificationPrompt);
    console.log('Classification:', classification);

    return { classification };
  } catch (error) {
    console.error('Error classifying email:', error);
    // Fallback classification
    return {
      classification: {
        intent: 'question',
        urgency: 'medium',
        topic: 'general inquiry',
        summary: 'Unable to classify email automatically',
      },
    };
  }
}

async function searchDocumentation(state: EmailAgentState) {
  console.log('Searching documentation...');

  // Build search query from classification
  const classification = state.classification ?? {
    intent: 'question',
    topic: 'general',
  };

  try {
    // Mock search results - in production, this would integrate with your search API
    const searchResults = [
      `Documentation for ${classification.intent}: Basic information about ${classification.topic}`,
      `FAQ entry: Common questions related to ${classification.topic}`,
      `Knowledge base article: How to handle ${classification.intent} requests`,
    ];

    console.log('Found search results:', searchResults.length, 'items');
    return { searchResults: searchResults };
  } catch (error) {
    console.error('Search error:', error);
    return {
      searchResults: [`Search temporarily unavailable: ${error}`],
    };
  }
}

async function bugTracking(
  state: EmailAgentState
): Promise<Partial<EmailAgentState>> {
  console.log('Creating bug tracking ticket...');

  // Create ticket in your bug tracking system
  const ticketId = `BUG-1`;

  console.log(`Created ticket: ${ticketId}`);
  return { ticketId };
}

async function writeResponse(state: EmailAgentState) {
  console.log('Writing response...');

  const classification = state.classification ?? {
    intent: 'question',
    urgency: 'medium',
  };

  // Format context from raw state data on-demand
  const contextSections: string[] = [];

  if (state.searchResults) {
    const formattedDocs = state.searchResults
      .map((doc) => `- ${doc}`)
      .join('\n');
    contextSections.push(`Relevant documentation:\n${formattedDocs}`);
  }

  if (state.customerHistory) {
    contextSections.push(
      `Customer tier: ${state.customerHistory.tier ?? 'standard'}`
    );
  }

  // Build the prompt with formatted context
  const draftPrompt = `
Draft a response to this customer email:
${state.emailContent}

Email intent: ${classification.intent}
Urgency level: ${classification.urgency}

${contextSections.join('\n\n')}

Guidelines:
- Be professional and helpful
- Address their specific concern
- Use the provided documentation when relevant
- Be brief
  `;

  try {
    const response = await llm.invoke(draftPrompt);

    // Determine if human review is needed based on urgency and intent
    const needsReview =
      classification.urgency === 'high' ||
      classification.urgency === 'critical' ||
      classification.intent === 'complex';

    // Route to the appropriate next node
    const goto = needsReview ? 'humanReview' : 'sendReply';

    if (needsReview) console.log('Needs approval');

    return new Command({
      update: { draftResponse: response.content },
      goto,
    });
  } catch (error) {
    console.error('Error writing response:', error);
    return new Command({
      update: {
        draftResponse: 'Error generating response. Please try again.',
      },
      goto: 'humanReview',
    });
  }
}

async function humanReview(state: EmailAgentState) {
  // interrupt() must come first - any code before it will re-run on resume
  const humanDecision = interrupt({
    ...state,
    action: 'Please review and approve/edit this response',
  });

  if (humanDecision.approved) {
    const editedResponse = humanDecision.editedResponse ?? state.draftResponse;
    return new Command({
      update: { draftResponse: editedResponse },
      goto: 'sendReply',
    });
  }
  return new Command({
    update: {},
    goto: END,
  });
}

async function sendReply(
  state: EmailAgentState
) {
  // Integrate with email service
  const preview = state.draftResponse?.substring(0, 60) + '...';
  console.log(`Sending reply: ${preview}`);

  // In production, you would send the actual email here
  return {};
}

// Initialize Postgres checkpointer
const checkpointer = PostgresSaver.fromConnString(
  "postgresql://postgres:mysecretpassword@localhost:5432/postgres?sslmode=disable"
);

export const graph = new StateGraph(EmailStateDefinition)
  // Add nodes - nodes with Command returns need ends arrays
  .addNode('readEmail', readEmail)
  .addNode('classifyIntent', classifyIntent)
  .addNode('searchDocumentation', searchDocumentation)
  .addNode('bugTracking', bugTracking)
  .addNode('writeResponse', writeResponse, {ends: ['humanReview', 'sendReply'] })
  .addNode('humanReview', humanReview, {ends: ['sendReply', END] })
  .addNode('sendReply', sendReply)
  // Add edges
  .addEdge(START, 'readEmail')
  .addEdge('readEmail', 'classifyIntent')
  .addEdge('classifyIntent', 'searchDocumentation')
  .addEdge('classifyIntent', 'bugTracking')
  .addEdge('searchDocumentation', 'writeResponse')
  .addEdge('bugTracking', 'writeResponse')
  .addEdge('sendReply', END)
  // Compile with checkpointer for persistence
  .compile({ checkpointer });

// Helper function to create consistent metadata for observability
function createMetadata(email: { emailContent: string; senderEmail: string; emailId: string; threadId: string }, additional?: Record<string, any>) {
  return {
    // Correlation IDs (for linking across systems)
    thread_id: email.threadId,
    email_id: email.emailId,
    session_id: email.threadId, // Using threadId as session for this example
    
    // User and context information
    user_email: email.senderEmail,
      
    // System information
    environment: process.env.NODE_ENV || 'development',
    node_version: process.version,
    
    // Analytics tags
    tags: additional?.['tags'] || [],
    
    // Timestamps
    received_at: new Date().toISOString(),
    
    // Cost tracking category
    cost_center: 'customer_support',
    
    // Geographic information (if available)
    region: 'unknown', // Could be extracted from email headers
    
    // Allow additional metadata to be passed in
    ...additional
  };
}


if (import.meta.url === `file://${process.argv[1]}`) {

  // Test function to run the graph with proper configuration
  async function runEmailWorkflow() {
    // Setup checkpointer tables (only needs to be called once)
    await checkpointer.setup();
    console.log('PostgreSQL checkpointer initialized');
  
    // Test with multiple emails to generate significant data
    const testEmails = [
      {
        emailContent: "bella zì! cosa puoi fare?",
        senderEmail: "er@piotta.rm",
        emailId: "email-1",
        threadId: "thread-1"
      },
      {
        emailContent: "I found a critical bug in your payment system. Transactions are failing!",
        senderEmail: "urgent@customer.com",
        emailId: "email-2",
        threadId: "thread-2"
      },
      {
        emailContent: "Can you add dark mode to the app? It would be really nice to have.",
        senderEmail: "feature@request.com",
        emailId: "email-3",
        threadId: "thread-3"
      },
      {
        emailContent: "How do I reset my password? I can't seem to find the option.",
        senderEmail: "help@needed.com",
        emailId: "email-4",
        threadId: "thread-4"
      },
      {
        emailContent: "My billing shows duplicate charges. Please investigate immediately!",
        senderEmail: "billing@issue.com",
        emailId: "email-5",
        threadId: "thread-5"
      }
    ];
  
   /*  for (const email of testEmails) {
      console.log(`\n${'='.repeat(60)}`);
      console.log(`Processing: ${email.emailId} (${email.threadId})`);
      console.log('='.repeat(60));
      
      // Create metadata using helper function (see createMetadata function above)
      const metadata = createMetadata(email, {
        // Additional metadata for batch processing
        batch_run: true,
        email_index: testEmails.indexOf(email) + 1,
        total_emails: testEmails.length
      });
      
      const config = {
        configurable: {
          thread_id: email.threadId
        },
        metadata: metadata  // This will appear in LangSmith/Langfuse
      };
  
      try {
        const result = await graph.invoke({
          emailContent: email.emailContent,
          senderEmail: email.senderEmail,
          emailId: email.emailId,
        }, config);
        
        console.log('\nResult:', JSON.stringify(result, null, 2));
      } catch (error) {
        console.error(`Error processing ${email.emailId}:`, error);
      }
    }
  
    console.log('\n' + '='.repeat(60));
    console.log('All emails processed. Check PostgreSQL for stored data.');
    console.log('='.repeat(60)); */
  
  const email = {
    emailContent: "bella zì! cosa puoi fare?",
    senderEmail: "er@piotta.rm",
    emailId: "email-1",
    threadId: randomUUID()
  };

  console.log(`\n${'='.repeat(60)}`);
      console.log(`Processing: ${email.emailId} (${email.threadId})`);
      console.log('='.repeat(60));
      
      // Create metadata using helper function
      const metadata = createMetadata(email, {
        // Additional metadata specific to this invocation
        test_run: true,
        single_email_test: true
      });
      
      const config = {
        configurable: {
          thread_id: email.threadId
        },
        metadata: metadata  // This will appear in LangSmith/Langfuse
      };
  
      try {
        const result = await graph.invoke({
          emailContent: email.emailContent,
          senderEmail: email.senderEmail,
          emailId: email.emailId,
        }, config);
        
        console.log('\nResult:', JSON.stringify(result, null, 2));
      } catch (error) {
        console.error(`Error processing ${email.emailId}:`, error);
      }
  
  }
  
  // Execute the workflow
  runEmailWorkflow().catch(console.error);
}