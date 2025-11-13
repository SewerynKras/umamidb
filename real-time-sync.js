#!/usr/bin/env node

const { createWalletClient, http } = require('@arkiv-network/sdk');
const { kaolin } = require('@arkiv-network/sdk/chains');
const { privateKeyToAccount } = require('@arkiv-network/sdk/accounts');
const { ExpirationTime, jsonToPayload } = require('@arkiv-network/sdk/utils');
const { Pool } = require('pg');
require('dotenv').config();

// Konfiguracja
const UMAMI_DB_URL = process.env.DATABASE_URL;
const ARKIV_CONFIG = {
  chainId: Number(process.env.ARKIV_CHAIN_ID || 60138453025),
  rpcUrl: process.env.ARKIV_RPC_URL || 'https://kaolin.hoodi.arkiv.network/rpc',
  wsUrl: process.env.ARKIV_WS_URL || 'wss://kaolin.hoodi.arkiv.network/rpc/ws',
  privateKey: process.env.ARKIV_PRIVATE_KEY
};
const HAS_CHAIN_OVERRIDE = Boolean(process.env.ARKIV_CHAIN_ID || process.env.ARKIV_RPC_URL || process.env.ARKIV_WS_URL);

// Batch & Queue Configuration
const BATCH_SIZE = 10;
const BATCH_TIMEOUT = 5000; // 5 seconds
const MAX_RETRIES = 3;
const RETRY_DELAY = 1000; // 1 second

// PostgreSQL client
const umami = new Pool({
  connectionString: UMAMI_DB_URL
});

let arkivClient;
let arkivAccount;

function buildChainConfig() {
  if (!HAS_CHAIN_OVERRIDE && ARKIV_CONFIG.chainId === kaolin.id) {
    return kaolin;
  }

  const defaultRpc = {
    http: [ARKIV_CONFIG.rpcUrl]
  };

  if (ARKIV_CONFIG.wsUrl) {
    defaultRpc.webSocket = [ARKIV_CONFIG.wsUrl];
  }

  return {
    ...kaolin,
    id: ARKIV_CONFIG.chainId,
    rpcUrls: {
      ...kaolin.rpcUrls,
      default: defaultRpc
    }
  };
}

function normalisePrivateKey(value) {
  if (!value.startsWith('0x')) {
    return `0x${value}`;
  }
  return value;
}

function toAttributes(entries) {
  const attributes = new Map();

  entries.forEach(([key, value]) => {
    if (key === undefined || key === null || value === undefined || value === null) {
      return;
    }

    if (typeof value === 'number') {
      attributes.set(key, { key, value });
    } else {
      attributes.set(key, { key, value: String(value) });
    }
  });

  return Array.from(attributes.values());
}

function formatTimestamp(value) {
  if (!value) {
    return new Date().toISOString();
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return new Date().toISOString();
  }

  return date.toISOString();
}

// Queue system for batching
class SyncQueue {
  constructor() {
    this.queue = [];
    this.processing = false;
    this.batchTimer = null;
  }

  async add(data) {
    this.queue.push(data);

    // Start batch timer if not already running
    if (!this.batchTimer && !this.processing) {
      this.batchTimer = setTimeout(() => this.processBatch(), BATCH_TIMEOUT);
    }

    // Process immediately if batch is full
    if (this.queue.length >= BATCH_SIZE) {
      this.clearBatchTimer();
      await this.processBatch();
    }
  }

  clearBatchTimer() {
    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }
  }

  async processBatch() {
    if (this.processing || this.queue.length === 0) {
      return;
    }

    this.processing = true;
    this.clearBatchTimer();

    const batch = this.queue.splice(0, BATCH_SIZE);
    console.log(`📦 Processing batch of ${batch.length} items`);

    try {
      await this.syncBatchToArkiv(batch);
      console.log(`✅ Batch of ${batch.length} items synced successfully`);
    } catch (error) {
      console.error(`❌ Batch sync failed:`, error.message);
      // Re-queue failed items for retry
      await this.retryBatch(batch);
    }

    this.processing = false;

    // Process next batch if queue has items
    if (this.queue.length > 0) {
      setTimeout(() => this.processBatch(), 100);
    }
  }

  async retryBatch(batch, retryCount = 0) {
    if (retryCount >= MAX_RETRIES) {
      console.error(`💀 Batch failed after ${MAX_RETRIES} retries, dropping ${batch.length} items`);
      return;
    }

    console.log(`🔄 Retrying batch (attempt ${retryCount + 1}/${MAX_RETRIES})`);

    // Exponential backoff
    await new Promise(resolve => setTimeout(resolve, RETRY_DELAY * Math.pow(2, retryCount)));

    try {
      await this.syncBatchToArkiv(batch);
      console.log(`✅ Batch retry ${retryCount + 1} succeeded`);
    } catch (error) {
      console.error(`❌ Batch retry ${retryCount + 1} failed:`, error.message);
      await this.retryBatch(batch, retryCount + 1);
    }
  }

  async syncBatchToArkiv(batch) {
    await initGolem();
    const syncTime = Math.floor(Date.now() / 1000);

    const creates = batch.map(item => ({
      payload: jsonToPayload(item.data),
      contentType: 'application/json',
      attributes: toAttributes([
        ['type', item.type],
        ['source', 'umami'],
        ['website_id', item.website_id],
        ['timestamp', formatTimestamp(item.timestamp)],
        ['umami_id', item.umami_id],
        ['sync_time', syncTime],
        ['batch_size', batch.length],
        ...(item.metadata ? Object.entries(item.metadata) : [])
      ]),
      expiresIn: calculateBTL(30)
    }));

    const { createdEntities } = await arkivClient.mutateEntities({ creates });

    if (createdEntities.length !== creates.length) {
      throw new Error(`Expected ${creates.length} receipts, got ${createdEntities.length}`);
    }

    return createdEntities;
  }
}

// Global queue instance
const syncQueue = new SyncQueue();

// Inicjalizacja Arkiv DB
async function initGolem() {
  if (arkivClient) {
    return arkivClient;
  }

  if (!ARKIV_CONFIG.privateKey) {
    throw new Error('ARKIV_PRIVATE_KEY not set in .env');
  }

  const privateKey = normalisePrivateKey(ARKIV_CONFIG.privateKey.trim());
  arkivAccount = privateKeyToAccount(privateKey);

  arkivClient = createWalletClient({
    account: arkivAccount,
    chain: buildChainConfig(),
    transport: http(ARKIV_CONFIG.rpcUrl)
  });

  console.log('✅ Connected to Arkiv DB');
  console.log('📍 Address:', arkivAccount.address);

  return arkivClient;
}

// BTL calculation
function calculateBTL(days = 1) {
  return ExpirationTime.fromDays(days);
}

// Real-time sync functions
async function syncPageview(websiteEvent) {
  const createdAtIso = formatTimestamp(websiteEvent.created_at);
  const data = {
    type: 'pageview',
    website_id: websiteEvent.website_id,
    umami_id: websiteEvent.event_id,
    timestamp: createdAtIso,
    data: {
      event_id: websiteEvent.event_id,
      website_id: websiteEvent.website_id,
      session_id: websiteEvent.session_id,
      url_path: websiteEvent.url_path,
      url_query: websiteEvent.url_query,
      referrer_path: websiteEvent.referrer_path,
      referrer_domain: websiteEvent.referrer_domain,
      page_title: websiteEvent.page_title,
      hostname: websiteEvent.hostname,
      created_at: createdAtIso
    },
    metadata: {
      url_path: websiteEvent.url_path || '',
      hostname: websiteEvent.hostname || '',
      referrer_domain: websiteEvent.referrer_domain || ''
    }
  };

  await syncQueue.add(data);
}

async function syncCustomEvent(websiteEvent) {
  const createdAtIso = formatTimestamp(websiteEvent.created_at);
  const data = {
    type: 'event',
    website_id: websiteEvent.website_id,
    umami_id: websiteEvent.event_id,
    timestamp: createdAtIso,
    data: {
      event_id: websiteEvent.event_id,
      website_id: websiteEvent.website_id,
      session_id: websiteEvent.session_id,
      event_name: websiteEvent.event_name,
      url_path: websiteEvent.url_path,
      hostname: websiteEvent.hostname,
      created_at: createdAtIso
    },
    metadata: {
      event_name: websiteEvent.event_name || '',
      url_path: websiteEvent.url_path || '',
      hostname: websiteEvent.hostname || ''
    }
  };

  await syncQueue.add(data);
}

async function syncSession(session) {
  const createdAtIso = formatTimestamp(session.created_at);
  const data = {
    type: 'session',
    website_id: session.website_id,
    umami_id: session.session_id,
    timestamp: createdAtIso,
    data: {
      session_id: session.session_id,
      website_id: session.website_id,
      browser: session.browser,
      os: session.os,
      device: session.device,
      screen: session.screen,
      language: session.language,
      country: session.country,
      region: session.region,
      city: session.city,
      created_at: createdAtIso
    },
    metadata: {
      country: session.country || 'unknown',
      device: session.device || 'unknown',
      browser: session.browser || 'unknown',
      os: session.os || 'unknown'
    }
  };

  await syncQueue.add(data);
}

// Database listeners for real-time sync
async function setupDatabaseListeners() {
  const client = await umami.connect();

  // Listen for new website events (pageviews and custom events)
  await client.query('LISTEN website_event_insert');
  await client.query('LISTEN session_insert');

  client.on('notification', async (msg) => {
    try {
      const payload = JSON.parse(msg.payload);

      switch (msg.channel) {
        case 'website_event_insert':
          if (payload.event_type === 1) { // Pageview
            await syncPageview(payload);
          } else if (payload.event_type === 2) { // Custom event
            await syncCustomEvent(payload);
          }
          break;

        case 'session_insert':
          await syncSession(payload);
          break;
      }
    } catch (error) {
      console.error(`❌ Error processing notification:`, error.message);
    }
  });

  console.log('👂 Database listeners set up for real-time sync');
}

// Setup database triggers (run once)
async function setupDatabaseTriggers() {
  const client = await umami.connect();

  try {
    // Create trigger function for website_event
    await client.query(`
      CREATE OR REPLACE FUNCTION notify_website_event()
      RETURNS trigger AS $$
      BEGIN
        PERFORM pg_notify('website_event_insert', row_to_json(NEW)::text);
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);

    // Create trigger for website_event
    await client.query(`
      DROP TRIGGER IF EXISTS website_event_notify_trigger ON website_event;
      CREATE TRIGGER website_event_notify_trigger
        AFTER INSERT ON website_event
        FOR EACH ROW EXECUTE FUNCTION notify_website_event();
    `);

    // Create trigger function for session
    await client.query(`
      CREATE OR REPLACE FUNCTION notify_session()
      RETURNS trigger AS $$
      BEGIN
        PERFORM pg_notify('session_insert', row_to_json(NEW)::text);
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);

    // Create trigger for session
    await client.query(`
      DROP TRIGGER IF EXISTS session_notify_trigger ON session;
      CREATE TRIGGER session_notify_trigger
        AFTER INSERT ON session
        FOR EACH ROW EXECUTE FUNCTION notify_session();
    `);

    console.log('✅ Database triggers set up successfully');
  } finally {
    client.release();
  }
}

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n🛑 Shutting down real-time sync...');

  // Process remaining items in queue
  if (syncQueue.queue.length > 0) {
    console.log(`📤 Processing remaining ${syncQueue.queue.length} items...`);
    await syncQueue.processBatch();
  }

  await umami.end();
  process.exit(0);
});

// Main function
async function main() {
  try {
    console.log('🚀 Starting Umami → Arkiv DB real-time sync...');

    await initGolem();
    await setupDatabaseTriggers();
    await setupDatabaseListeners();

    console.log('🎉 Real-time sync is running!');
    console.log(`📊 Batch size: ${BATCH_SIZE}, timeout: ${BATCH_TIMEOUT}ms`);
    console.log(`🔄 Max retries: ${MAX_RETRIES}, retry delay: ${RETRY_DELAY}ms`);

    // Keep process running
    process.stdin.resume();

  } catch (error) {
    console.error('❌ Real-time sync failed:', error.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  syncQueue,
  syncPageview,
  syncCustomEvent,
  syncSession,
  initGolem
};