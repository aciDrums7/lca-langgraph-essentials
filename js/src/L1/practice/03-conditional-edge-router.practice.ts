import { Command, END, START, StateGraph } from '@langchain/langgraph';
import { registry } from '@langchain/langgraph/zod';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import z from 'zod';
import { getUserInput } from '../../utils.js';

dotenv.config({ path: './.env' });

const StateDefinition = z.object({
  stringList: z.array(z.string()).register(registry, {
    reducer: {
      fn: (state: string[], nodeAddition: string[]) =>
        state.concat(nodeAddition),
    },
    default: () => [],
  }),
});

type State = z.infer<typeof StateDefinition>;

function nodeA(state: State): Command {
  const select = state.stringList.at(-1);
  let nextNode: string;

  if (select === 'B') nextNode = 'B';
  else if (select === 'C') nextNode = 'C';
  else nextNode = END;

  // ? Dynamic way to return next node, here we could have also an LLM router to decide where to go next
  return new Command({
    update: { stringList: ['nodeA called'] } as State,
    goto: nextNode,
  });
}

function nodeB(state: State): Partial<State> {
  return { stringList: ['nodeB called'] };
}

function nodeC(state: State): Partial<State> {
  return { stringList: ['nodeC called'] };
}

export const graph = new StateGraph(StateDefinition)
  // Nodes
  .addNode('A', nodeA, { ends: ['B', 'C'] }) //? Needed for dynamic routing
  .addNode('B', nodeB)
  .addNode('C', nodeC)
  // Edges
  .addEdge(START, 'A')
  .addEdge('B', END)
  .addEdge('C', END)
  // Compile
  .compile();

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  console.log('\n=== L1: Conditional Edge Router Example ===\n');

  console.log(
    'This example demonstrates conditional routing using addConditionalEdges.'
  );
  console.log(
    'Enter "B" to go to node B, "C" to go to node C or anything else to quit.\n'
  );

  // Single example run
  const user = await getUserInput('B, C, or anything else to quit: ');

  const inputState: State = {
    stringList: [user],
  };

  console.log(`Running graph with input: "${user}"`);
  const result = await graph.invoke(inputState);
  console.log('Result:', result);

  console.log('\n=== Takeaways ===');
  console.log('- addConditionalEdges separates routing logic from node logic');
  console.log('- Router function receives state and returns next node name');
  console.log('- Node function only updates state, not control flow');
  console.log('- Cleaner separation of concerns compared to Command approach');
  console.log(
    '- Router function must return one of the specified destinations\n'
  );
}
