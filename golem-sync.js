#!/usr/bin/env node

const { createClient, createROClient } = require('golem-base-sdk');
const { Pool } = require('pg');
require('dotenv').config();

// Konfiguracja
const UMAMI_DB_URL = process.env.DATABASE_URL;
const GOLEM_CONFIG = {
  chainId: 60138453025, // Holesky testnet (poprawne)
  rpcUrl: 'https://kaolin.holesky.golem-base.io/rpc',
  wsUrl: 'wss://kaolin.holesky.golem-base.io/ws', // Poprawny WebSocket URL
  privateKey: process.env.GOLEM_PRIVATE_KEY
};

// PostgreSQL client dla Umami
const umami = new Pool({
  connectionString: UMAMI_DB_URL
});

let golemClient;

// Inicjalizacja Golem DB
async function initGolem() {
  if (!GOLEM_CONFIG.privateKey) {
    throw new Error('GOLEM_PRIVATE_KEY not set in .env');
  }

  // Poprawny format accountData zgodnie z SDK
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

// Funkcja obliczania BTL (Blocks To Live)
function calculateBTL(days = 1) {
  const blocksPerDay = (24 * 60 * 60) / 2; // ~43200 bloków/dzień (2s/blok)
  return Math.floor(days * blocksPerDay);
}

// Funkcja zapisu do Golem DB
async function saveToGolem(data, type, metadata = {}) {
  const entity = {
    data: Buffer.from(JSON.stringify(data)),
    btl: calculateBTL(1), // 1 dzień
    stringAnnotations: [
      { key: 'type', value: type },
      { key: 'source', value: 'umami' },
      { key: 'timestamp', value: new Date().toISOString() },
      ...Object.entries(metadata).map(([k, v]) => ({ key: k, value: String(v) }))
    ],
    numericAnnotations: [
      { key: 'sync_time', value: Math.floor(Date.now() / 1000) }
    ]
  };

  const receipts = await golemClient.createEntities([entity]);
  return receipts[0];
}

// Sync pageviews (najważniejsze!)
async function syncPageviews(limit = 1000) {
  console.log('📊 Syncing pageviews...');

  const query = `
    SELECT
      p.id,
      p.website_id,
      p.session_id,
      p.created_at,
      p.url,
      p.referrer,
      w.name as website_name,
      w.domain as website_domain
    FROM pageview p
    JOIN website w ON p.website_id = w.id
    WHERE p.created_at > NOW() - INTERVAL '1 hour'
    ORDER BY p.created_at DESC
    LIMIT $1
  `;

  const result = await umami.query(query, [limit]);

  if (result.rows.length === 0) {
    console.log('📭 No new pageviews to sync');
    return;
  }

  // Batch sync do Golem DB
  const entities = result.rows.map(row => ({
    data: Buffer.from(JSON.stringify(row)),
    btl: calculateBTL(1),
    stringAnnotations: [
      { key: 'type', value: 'pageview' },
      { key: 'source', value: 'umami' },
      { key: 'website_id', value: row.website_id },
      { key: 'website_domain', value: row.website_domain },
      { key: 'url', value: row.url },
      { key: 'timestamp', value: row.created_at.toISOString() }
    ],
    numericAnnotations: [
      { key: 'umami_id', value: row.id },
      { key: 'sync_time', value: Math.floor(Date.now() / 1000) }
    ]
  }));

  const receipts = await golemClient.createEntities(entities);
  console.log(`✅ Synced ${receipts.length} pageviews to Golem DB`);
}

// Sync events (custom tracking)
async function syncEvents(limit = 1000) {
  console.log('🎯 Syncing events...');

  const query = `
    SELECT
      e.id,
      e.website_id,
      e.session_id,
      e.created_at,
      e.url,
      e.event_name,
      e.event_data,
      w.name as website_name,
      w.domain as website_domain
    FROM event e
    JOIN website w ON e.website_id = w.id
    WHERE e.created_at > NOW() - INTERVAL '1 hour'
    ORDER BY e.created_at DESC
    LIMIT $1
  `;

  const result = await umami.query(query, [limit]);

  if (result.rows.length > 0) {
    const entities = result.rows.map(row => ({
      data: Buffer.from(JSON.stringify(row)),
      btl: calculateBTL(1),
      stringAnnotations: [
        { key: 'type', value: 'event' },
        { key: 'source', value: 'umami' },
        { key: 'website_id', value: row.website_id },
        { key: 'event_name', value: row.event_name },
        { key: 'timestamp', value: row.created_at.toISOString() }
      ],
      numericAnnotations: [
        { key: 'umami_id', value: row.id },
        { key: 'sync_time', value: Math.floor(Date.now() / 1000) }
      ]
    }));

    const receipts = await golemClient.createEntities(entities);
    console.log(`✅ Synced ${receipts.length} events to Golem DB`);
  }
}

// Sync sessions
async function syncSessions(limit = 500) {
  console.log('👥 Syncing sessions...');

  const query = `
    SELECT
      s.id,
      s.session_id,
      s.website_id,
      s.created_at,
      s.hostname,
      s.browser,
      s.os,
      s.device,
      s.screen,
      s.language,
      s.country,
      w.name as website_name,
      w.domain as website_domain
    FROM session s
    JOIN website w ON s.website_id = w.id
    WHERE s.created_at > NOW() - INTERVAL '1 hour'
    ORDER BY s.created_at DESC
    LIMIT $1
  `;

  const result = await umami.query(query, [limit]);

  if (result.rows.length > 0) {
    const entities = result.rows.map(row => ({
      data: Buffer.from(JSON.stringify(row)),
      btl: calculateBTL(1),
      stringAnnotations: [
        { key: 'type', value: 'session' },
        { key: 'source', value: 'umami' },
        { key: 'website_id', value: row.website_id },
        { key: 'country', value: row.country || 'unknown' },
        { key: 'device', value: row.device || 'unknown' },
        { key: 'timestamp', value: row.created_at.toISOString() }
      ],
      numericAnnotations: [
        { key: 'umami_id', value: row.id },
        { key: 'sync_time', value: Math.floor(Date.now() / 1000) }
      ]
    }));

    const receipts = await golemClient.createEntities(entities);
    console.log(`✅ Synced ${receipts.length} sessions to Golem DB`);
  }
}

// Sync website metadata
async function syncWebsites() {
  console.log('🌐 Syncing websites metadata...');

  const query = `
    SELECT
      id,
      name,
      domain,
      share_id,
      created_at,
      updated_at
    FROM website
    ORDER BY updated_at DESC
  `;

  const result = await umami.query(query);

  if (result.rows.length > 0) {
    const entities = result.rows.map(row => ({
      data: Buffer.from(JSON.stringify(row)),
      btl: calculateBTL(2), // 2 dni dla metadata
      stringAnnotations: [
        { key: 'type', value: 'website_metadata' },
        { key: 'source', value: 'umami' },
        { key: 'website_id', value: row.id },
        { key: 'domain', value: row.domain },
        { key: 'name', value: row.name }
      ],
      numericAnnotations: [
        { key: 'umami_id', value: parseInt(row.id) },
        { key: 'sync_time', value: Math.floor(Date.now() / 1000) }
      ]
    }));

    const receipts = await golemClient.createEntities(entities);
    console.log(`✅ Synced ${receipts.length} websites to Golem DB`);
  }
}

// Funkcja pełnej synchronizacji
async function fullSync() {
  try {
    console.log('🚀 Starting Umami → Golem DB sync...');

    await initGolem();

    // Sync w kolejności ważności
    await syncPageviews();
    await syncEvents();
    await syncSessions();
    await syncWebsites();

    console.log('✅ Sync completed successfully!');

  } catch (error) {
    console.error('❌ Sync failed:', error);
    process.exit(1);
  } finally {
    await umami.end();
  }
}

// Funkcja zapytań do Golem DB
async function queryGolemData(type, filters = {}) {
  if (!golemClient) {
    await initGolem();
  }

  // Pobierz wszystkie entities właściciela
  const ownerAddress = await golemClient.getOwnerAddress();
  const allEntityKeys = await golemClient.getEntitiesOfOwner(ownerAddress);

  const matchingData = [];

  // Filtruj po annotations
  for (const entityKey of allEntityKeys) {
    try {
      const metadata = await golemClient.getEntityMetaData(entityKey);

      // Sprawdź czy to właściwy typ i źródło
      const isCorrectType = metadata.stringAnnotations.some(
        ann => ann.key === 'type' && ann.value === type
      );
      const isFromUmami = metadata.stringAnnotations.some(
        ann => ann.key === 'source' && ann.value === 'umami'
      );

      if (!isCorrectType || !isFromUmami) continue;

      // Sprawdź dodatkowe filtry
      let matchesFilters = true;
      for (const [key, value] of Object.entries(filters)) {
        const hasMatchingAnnotation = metadata.stringAnnotations.some(
          ann => ann.key === key && ann.value === String(value)
        );
        if (!hasMatchingAnnotation) {
          matchesFilters = false;
          break;
        }
      }

      if (matchesFilters) {
        const data = await golemClient.getStorageValue(entityKey);
        matchingData.push(JSON.parse(data.toString()));
      }
    } catch (error) {
      console.warn(`Error processing entity ${entityKey}:`, error.message);
    }
  }

  return matchingData;
}

// CLI interface
async function main() {
  const command = process.argv[2];

  switch (command) {
    case 'sync':
      await fullSync();
      break;

    case 'query':
      const type = process.argv[3];
      const websiteId = process.argv[4];

      if (!type) {
        console.log('Usage: node golem-sync.js query <type> [website_id]');
        console.log('Types: pageview, event, session, website_metadata');
        process.exit(1);
      }

      await initGolem();
      const filters = websiteId ? { website_id: websiteId } : {};
      const data = await queryGolemData(type, filters);
      console.log(`Found ${data.length} ${type} records`);
      console.log(JSON.stringify(data.slice(0, 5), null, 2)); // Pokaż pierwsze 5
      break;

    default:
      console.log('Usage:');
      console.log('  node golem-sync.js sync              # Sync Umami data to Golem DB');
      console.log('  node golem-sync.js query <type>      # Query data from Golem DB');
      console.log('  node golem-sync.js query pageview    # Get pageviews');
      console.log('  node golem-sync.js query event       # Get events');
      break;
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  initGolem,
  syncPageviews,
  syncEvents,
  syncSessions,
  syncWebsites,
  queryGolemData
};