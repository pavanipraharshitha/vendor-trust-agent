import dotenv from 'dotenv';
import { HindsightClient } from '@vectorize-io/hindsight-client';
import { buildSeedDataset, buildHindsightMemories } from '../server/data/seed-data.js';

dotenv.config();

const apiKey = process.env.HINDSIGHT_API_KEY;
const baseUrl = process.env.HINDSIGHT_BASE_URL || 'https://api.hindsight.vectorize.io';
const bankId = process.env.HINDSIGHT_BANK_ID || 'LedgerMind AP Memory';

if (!apiKey) {
  console.error('Missing HINDSIGHT_API_KEY in .env');
  process.exit(1);
}

const client = new HindsightClient({ baseUrl, apiKey });
const dataset = buildSeedDataset();
const memories = buildHindsightMemories(dataset);

try {
  try {
    await client.createBank(bankId, {
      name: 'LedgerMind AP Memory',
      background: 'Persistent operational memory for Accounts Payable vendor behavior, payment history, exceptions, resolutions and verification controls.',
      disposition: { skepticism: 5, literalism: 4, empathy: 1 }
    });
    console.log(`Created memory bank: ${bankId}`);
  } catch (e) {
    console.log(`Bank already exists or create returned an error: ${e.message}`);
  }

  for (let i = 0; i < memories.length; i++) {
    const item = memories[i];
    await client.retain(bankId, item.content, {
      context: item.context,
      timestamp: new Date(item.timestamp),
      metadata: item.metadata
    });
    if ((i + 1) % 10 === 0 || i === memories.length - 1) console.log(`Retained ${i + 1}/${memories.length} memories`);
  }
  console.log(`SUCCESS: seeded ${memories.length} memories into ${bankId}`);
} catch (error) {
  console.error('Hindsight seeding failed:', error);
  process.exit(1);
}
