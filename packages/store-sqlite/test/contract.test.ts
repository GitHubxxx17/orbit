import { eventStoreContract, sessionStoreContract } from '@orbit/core/testing';

import { openStores } from '../src/index.js';

// The same suites the in-memory stores pass. If these pass, the server cannot tell them apart.
eventStoreContract('sqlite', (clock, ids) => openStores(':memory:', { clock, ids }).events);
sessionStoreContract('sqlite', (clock) => openStores(':memory:', { clock }).sessions);
