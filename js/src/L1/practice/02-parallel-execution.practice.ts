import { registry } from '@langchain/langgraph/zod';
import { fileURLToPath } from 'url';
import z from 'zod';
import { END, START, StateGraph } from '@langchain/langgraph';
import dotenv from 'dotenv';

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

function nodeA(state: State) {
  console.log(`Adding "A" to current state: `, state.stringList);
  return { stringList: ['A'] };
}

function nodeB(state: State) {
  console.log(`Adding "B" to current state: `, state.stringList);
  return { stringList: ['B'] };
}

function nodeC(state: State) {
  console.log(`Adding "C" to current state: `, state.stringList);
  return { stringList: ['C'] };
}

function nodeBB(state: State) {
  console.log(`Adding "BB" to current state: `, state.stringList);
  return { stringList: ['BB'] };
}

function nodeCC(state: State) {
  console.log(`Adding "CC" to current state: `, state.stringList);
  return { stringList: ['CC'] };
}

function nodeD(state: State) {
  console.log(`Adding "D" to current state: `, state.stringList);
  return { stringList: ['D'] };
}

export const graph = new StateGraph(StateDefinition)
  // nodes
  .addNode('A', nodeA)
  .addNode('B', nodeB)
  .addNode('C', nodeC)
  .addNode('BB', nodeBB)
  .addNode('CC', nodeCC)
  .addNode('D', nodeD)
  // edges
  .addEdge(START, 'A')
  .addEdge('A', 'C')
  .addEdge('A', 'B')
  .addEdge('B', 'BB')
  .addEdge('C', 'CC')
  .addEdge('BB', 'D')
  .addEdge('CC', 'D')
  .addEdge('D', END)
  .compile();

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  console.log('\n=== L1: Parallel Execution Example ===\n');

  // Run the graph with initial state
  const initialState: State = {
    stringList: ['Initial String:'],
  };

  console.log('Running graph with initial state:', initialState);
  const result = await graph.invoke(initialState);
  console.log('Final result:', result);

  console.log('\n=== Takeaways ===');
  console.log(
    '- State passed to nodes "bb" and "cc" is the result of both "b" and "c"'
  );
  console.log('- Edges convey control, not data');
  console.log('- Data is stored to state from all active nodes at end of step');
  console.log('- Nodes b and c operate in parallel');
  console.log('- Reducer function merges values returned');
  console.log('- Results from nodes b, c are stored before starting bb and cc');
  console.log('- Control follows edges, not data\n');
}
