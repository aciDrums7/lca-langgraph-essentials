import {
  Command,
  END,
  interrupt,
  MemorySaver,
  START,
  StateGraph,
} from '@langchain/langgraph';
import { registry } from '@langchain/langgraph/zod';
import dotenv from 'dotenv';
import { z } from 'zod';
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
  console.log("Entered 'A' node");
  const select = state.nlist.at(-1);
  let nextNode: string;
  if (select === 'b') nextNode = 'B';
  else if (select === 'c') nextNode = 'C';
  else if (select === 'q') nextNode = END;
  else {
    const interruptHumanInput = interrupt({
      message: `💥 Unexpected input ${select}! Continue? `,
    });
    console.log('Interrupt response:', interruptHumanInput);

    if (interruptHumanInput === 'continue') {
      nextNode = 'b';
    } else {
      nextNode = END;
      return new Command({
        update: { nlist: ['q'] },
        goto: nextNode,
      });
    }
  }

  return new Command({
    update: {},
    goto: nextNode,
  });
}

function nodeB(): Partial<State> {
  console.log("Entered 'B' node");
  return { nlist: ['B'] };
}

function nodeC(): Partial<State> {
  console.log("Entered 'C' node");
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

// Check if result contains an interrupt
function hasInterrupt(result: any): result is { __interrupt__: any[] } {
  return result && result.__interrupt__ && Array.isArray(result.__interrupt__);
}

// Example usage with interrupt handling
async function main() {
  console.log('\n=== L1: Interrupts Example ===\n');

  console.log(
    'This example demonstrates human-in-the-loop patterns with interrupts.'
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
      console.log(
        'Try entering unexpected input (not "b", "c", or "q") to trigger an interrupt.\n'
      );

      const input = await getUserInput('b, c, or q to quit: ');
      const inputState: State = {
        nlist: [input],
      };

      let result = await graph.invoke(inputState, config);

      // Check if an interrupt occurred
      if (hasInterrupt(result)) {
        console.log(`${'-'.repeat(80)}`);
        console.log('Interrupt:', result);

        const interruptMessage = result.__interrupt__.at(-1);
        const msg = interruptMessage.value?.message || 'Continue?';
        const human = await getUserInput(`\n${msg}: `);

        //! Resume with human response
        result = await graph.invoke(new Command({ resume: human }), config);
        console.log(`${'-'.repeat(80)}`);
      }

      console.log(`Thread '${threadId}' after '${input}':`, result);

      if (result.nlist.at(-1) === 'q') {
        console.log('Exitting thread...');
        break;
      }
    }
  }

  console.log('\n=== Takeaways ===');
  console.log(
    '- interrupt() statement pauses operation and returns value in __interrupt__ field'
  );
  console.log(
    '- When graph is invoked with Command containing resume, operation continues'
  );
  console.log('- Node is restarted from the beginning');
  console.log('- Checkpointer replays responses to interrupts');
  console.log(
    '- Enables human oversight and intervention in automated workflows\n'
  );
}

main().catch(console.error);
