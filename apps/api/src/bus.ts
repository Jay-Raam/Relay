import { createPubSub } from 'graphql-yoga';
import type { Reading } from '@relay/types';

/** In-process fan-out of new readings to GraphQL subscribers (SSE connections). */
export function createReadingBus() {
  return createPubSub<{ reading: [Reading] }>();
}

export type ReadingBus = ReturnType<typeof createReadingBus>;
