import { END, START, StateGraph } from '@langchain/langgraph';
import { fileURLToPath } from 'url';
import z from 'zod';
import dotenv from 'dotenv';

dotenv.config({ path: './.env' });

export const StateDefinition = z.object({
  nlist: z.array(z.string()),
});

type State = z.infer<typeof StateDefinition>;

function nodeA(state: State) {
  console.log(`node A is receiving ${JSON.stringify(state.nlist)}`);
  const note = 'Hello World from node A!';
  console.log(note);
  return { nlist: [note] };
}

export const graph = new StateGraph(StateDefinition)
  .addNode('a', nodeA)
  .addEdge(START, 'a')
  .addEdge('a', END)
  .compile();

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  console.log('\n=== L1: Simple Node Example ===\n');

  // Run the graph with initial state
  const initialState: State = {
    nlist: ['Hello Node A, how are you?'],
  };

  console.log('Running graph with initial state:', initialState);
  const result = await graph.invoke(initialState);
  console.log('Final result:', result);

  console.log('\n=== Takeaways ===');
  console.log('- State: All nodes can share the same state');
  console.log('- Nodes are just functions');
  console.log(
    '- Runtime initializes input state and determines which nodes to run'
  );
  console.log(
    '- Node receives state as input and updates state with return value'
  );
  console.log('- Graph returns final value of state\n');
}
