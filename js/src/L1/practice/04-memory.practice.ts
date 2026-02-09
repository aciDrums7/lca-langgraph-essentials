import {
  Command,
  END,
  MemorySaver,
  START,
  StateGraph,
} from '@langchain/langgraph';
import { registry } from '@langchain/langgraph/zod';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { z } from 'zod/v4';
import { getUserInput } from '../../utils.js';

dotenv.config({ path: './.env' });

const StateDefinition = z.object({
  nlist: z.array(z.string()).register(registry, {
    reducer: { fn: (left: string[], right: string[]) => left.concat(right) },
    default: () => [],
  }),
});

type State = z.infer<typeof StateDefinition>;

function nodeA(state: State): Command {
  const select = state.nlist.at(-1);
  let nextNode: string;
  if (select === 'b') nextNode = 'B';
  else if (select === 'c') nextNode = 'C';
  else nextNode = END;

  return new Command({
    update: {},
    goto: nextNode,
  });
}

function nodeB(): Partial<State> {
  return { nlist: ['B'] };
}

function nodeC(): Partial<State> {
  return { nlist: ['C'] };
}

// Define the checkpointer to use for persistence
const memory = new MemorySaver();

const graph = new StateGraph(StateDefinition)
  // Nodes
  .addNode('A', nodeA, { ends: ['B', 'C'] })
  .addNode('B', nodeB)
  .addNode('C', nodeC)
  // Edges
  .addEdge(START, 'A')
  .addEdge('B', END)
  .addEdge('C', END)
  // Compile
  .compile({ checkpointer: memory });

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  console.log('\n=== L1: Multi-Thread Memory Example ===\n');

  console.log(
    'This example demonstrates multi-threaded execution with memory/checkpointer.'
  );
  console.log(
    'Try running the graph with different thread IDs to see how state is maintained across threads.'
  );

  while (true) {
    const threadId = await getUserInput('Enter thread ID, or q to quit: ');

    if (threadId === 'q') {
      console.log('Quitting...');
      break;
    }

    const config = {
      configurable: { thread_id: threadId },
    };

    console.log(`=== Thread '${threadId}' Operations ===`);

    while (true) {
      console.log(
        'Enter "b" to go to node B, "c" to go to node C, or "q" to quit.\n'
      );

      const input = await getUserInput('b, c, or q to quit: ');
      const inputState: State = {
        nlist: [input],
      };

      const result = await graph.invoke(inputState, config);
      console.log(`Thread '${threadId}' after '${input}':`, result);

      if (result.nlist.at(-1) === 'q') {
        console.log('Exitting thread...');
        break;
      }
    }
  }
  console.log('\nNotice how each thread maintains its own separate state!');
}
