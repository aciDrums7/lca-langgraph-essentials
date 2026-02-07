import { END, START, StateGraph } from '@langchain/langgraph';
import { registry } from '@langchain/langgraph/zod';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import z from 'zod';
import { getUserInput } from '../../utils.js';

dotenv.config({ path: './.env' });

const StateDefinition = z.object({
  stringList: z.array(z.string()).register(registry, {
    reducer: {
      fn: (left: string[], right: string[]) => left.concat(right),
    },
    default: () => [],
  }),
});

type State = z.infer<typeof StateDefinition>;

function nodeA(): Partial<State> {
  return { stringList: ['nodeA called'] };
}

function nodeB(): Partial<State> {
  return { stringList: ['nodeB called'] };
}

function nodeC(): Partial<State> {
  return { stringList: ['nodeC called'] };
}

function routeFromA(state: State): string {
  const select = state.stringList.at(0);

  if (select === 'B') return 'B';
  else if (select === 'C') return 'C';
  else return END;
}

export const graph = new StateGraph(StateDefinition)
  // Nodes
  .addNode('A', nodeA)
  .addNode('B', nodeB)
  .addNode('C', nodeC)
  // Edges
  .addEdge(START, 'A')
  .addConditionalEdges('A', routeFromA)
  .addEdge('B', END)
  .addEdge('C', END)
  // Compile
  .compile();

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  console.log('\n=== L1: Conditional Edges Example ===\n');

  console.log(
    'This example demonstrates conditional routing based on user input.'
  );
  console.log(
    'Enter "B" to go to node B, "C" to go to node C, or anything else to quit.\n'
  );

  // Single example run
  const user = await getUserInput('B, C or anything else to quit: ');

  const inputState: State = {
    stringList: [user],
  };

  console.log(`Running graph with input: "${user}"`);
  const result = await graph.invoke(inputState);
  console.log('Result:', result);

  console.log('\n=== Takeaways ===');
  console.log(
    '- Command in return statement updates both state and control path'
  );
  console.log('- Command "goto" allows you to name the next node');
  console.log('- Must be careful to match destination node name');
  console.log('- Return type annotation helps with type checking');
  console.log('- Conditional logic determines the execution path\n');
}
