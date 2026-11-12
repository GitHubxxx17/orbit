import { InMemoryEventStore } from '../src/event-store.js';
import { InMemorySessionStore } from '../src/session-store.js';
import { eventStoreContract, sessionStoreContract } from '../src/testing.js';

eventStoreContract('in memory', (clock, ids) => new InMemoryEventStore(clock, ids));
sessionStoreContract('in memory', (clock) => new InMemorySessionStore(clock));
