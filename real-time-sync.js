#!/usr/bin/env node

const { createClient } = require('golem-base-sdk');
const { Pool } = require('pg');
require('dotenv').config();

// Konfiguracja
const UMAMI_DB_URL = process.env.DATABASE_URL;
const GOLEM_CONFIG = {
  chainId: 60138453025,
  rpcUrl: 'https://kaolin.holesky.golem-base.io/rpc',
  wsUrl: 'wss://kaolin.holesky.golem-base.io/ws',
  privateKey: process.env.GOLEM_PRIVATE_KEY
};

// Batch & Queue Configuration
const BATCH_SIZE = 10;
const BATCH_TIMEOUT = 5000; // 5 seconds
const MAX_RETRIES = 3;
const RETRY_DELAY = 1000; // 1 second

// PostgreSQL client
const umami = new Pool({
  connectionString: UMAMI_DB_URL
});

let golemClient;

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
      await this.syncBatchToGolem(batch);
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
      await this.syncBatchToGolem(batch);
      console.log(`✅ Batch retry ${retryCount + 1} succeeded`);
    } catch (error) {
      console.error(`❌ Batch retry ${retryCount + 1} failed:`, error.message);
      await this.retryBatch(batch, retryCount + 1);
    }
  }

  async syncBatchToGolem(batch) {
    // Convert batch items to Golem entities
    const entities = batch.map(item => ({
      data: Buffer.from(JSON.stringify(item.data)),
      btl: calculateBTL(30), // 30 days
      stringAnnotations: [
        { key: 'type', value: item.type },
        { key: 'source', value: 'umami' },
        { key: 'website_id', value: item.website_id || '' },
        { key: 'timestamp', value: item.timestamp || new Date().toISOString() },
        ...(item.metadata ? Object.entries(item.metadata).map(([k, v]) => ({ key: k, value: String(v) })) : [])
      ],
      numericAnnotations: [
        { key: 'umami_id', value: item.umami_id || 0 },
        { key: 'sync_time', value: Math.floor(Date.now() / 1000) },
        { key: 'batch_size', value: batch.length }
      ]
    }));

    // Batch write to Golem DB
    const receipts = await golemClient.createEntities(entities);

    if (receipts.length !== entities.length) {
      throw new Error(`Expected ${entities.length} receipts, got ${receipts.length}`);
    }

    return receipts;
  }
}

// Global queue instance
const syncQueue = new SyncQueue();

// Inicjalizacja Golem DB
async function initGolem() {
  if (!GOLEM_CONFIG.privateKey) {
    throw new Error('GOLEM_PRIVATE_KEY not set in .env');
  }

  const accountData = {
    tag: 'privatekey',
    data: Buffer.from(GOLEM_CONFIG.privateKey.replace('0x', ''), 'hex')
  };

  golemClient = await createClient(
    GOLEM_CONFIG.chainId,
    accountData,
    GOLEM_CONFIG.rpcUrl,
    GOLEM_CONFIG.wsUrl
  );

  console.log('✅ Connected to Golem DB');
  console.log('📍 Address:', await golemClient.getOwnerAddress());
}

// BTL calculation
function calculateBTL(days = 1) {
  const blocksPerDay = (24 * 60 * 60) / 2;
  return Math.floor(days * blocksPerDay);
}

// Real-time sync functions
async function syncPageview(websiteEvent) {
  const data = {
    type: 'pageview',
    website_id: websiteEvent.website_id,
    umami_id: websiteEvent.event_id,
    timestamp: websiteEvent.created_at.toISOString(),
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
      created_at: websiteEvent.created_at.toISOString()
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
  const data = {
    type: 'event',
    website_id: websiteEvent.website_id,
    umami_id: websiteEvent.event_id,
    timestamp: websiteEvent.created_at.toISOString(),
    data: {
      event_id: websiteEvent.event_id,
      website_id: websiteEvent.website_id,
      session_id: websiteEvent.session_id,
      event_name: websiteEvent.event_name,
      url_path: websiteEvent.url_path,
      hostname: websiteEvent.hostname,
      created_at: websiteEvent.created_at.toISOString()
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
  const data = {
    type: 'session',
    website_id: session.website_id,
    umami_id: session.session_id,
    timestamp: session.created_at.toISOString(),
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
      created_at: session.created_at.toISOString()
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
    console.log('🚀 Starting Umami → Golem DB real-time sync...');

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