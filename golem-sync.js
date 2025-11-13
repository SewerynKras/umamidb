#!/usr/bin/env node

const { createWalletClient, http } = require('@arkiv-network/sdk');
const { kaolin } = require('@arkiv-network/sdk/chains');
const { privateKeyToAccount } = require('@arkiv-network/sdk/accounts');
const { ExpirationTime, jsonToPayload } = require('@arkiv-network/sdk/utils');
const { eq } = require('@arkiv-network/sdk/query');
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

// PostgreSQL client dla Umami
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

// Funkcja obliczania TTL w sekundach
function calculateBTL(days = 1) {
  return ExpirationTime.fromDays(days);
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

// Funkcja zapisu do Arkiv DB
async function saveToArkiv(data, type, metadata = {}, expiresInDays = 1) {
  await initGolem();

  const attributes = toAttributes([
    ['type', type],
    ['source', 'umami'],
    ['timestamp', new Date().toISOString()],
    ['sync_time', Math.floor(Date.now() / 1000)],
    ...Object.entries(metadata)
  ]);

  return arkivClient.createEntity({
    payload: jsonToPayload(data),
    contentType: 'application/json',
    attributes,
    expiresIn: calculateBTL(expiresInDays)
  });
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

  await initGolem();
  const syncTime = Math.floor(Date.now() / 1000);

  const creates = result.rows.map(row => ({
    payload: jsonToPayload({
      ...row,
      created_at: formatTimestamp(row.created_at)
    }),
    contentType: 'application/json',
    attributes: toAttributes([
      ['type', 'pageview'],
      ['source', 'umami'],
      ['website_id', row.website_id],
      ['website_domain', row.website_domain],
      ['url', row.url],
      ['timestamp', formatTimestamp(row.created_at)],
      ['umami_id', row.id],
      ['sync_time', syncTime]
    ]),
    expiresIn: calculateBTL(1)
  }));

  const { createdEntities } = await arkivClient.mutateEntities({ creates });
  console.log(`✅ Synced ${createdEntities.length} pageviews to Arkiv DB`);
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

  if (result.rows.length === 0) {
    console.log('📭 No new events to sync');
    return;
  }

  await initGolem();
  const syncTime = Math.floor(Date.now() / 1000);

  const creates = result.rows.map(row => ({
    payload: jsonToPayload({
      ...row,
      created_at: formatTimestamp(row.created_at)
    }),
    contentType: 'application/json',
    attributes: toAttributes([
      ['type', 'event'],
      ['source', 'umami'],
      ['website_id', row.website_id],
      ['event_name', row.event_name],
      ['timestamp', formatTimestamp(row.created_at)],
      ['umami_id', row.id],
      ['sync_time', syncTime]
    ]),
    expiresIn: calculateBTL(1)
  }));

  const { createdEntities } = await arkivClient.mutateEntities({ creates });
  console.log(`✅ Synced ${createdEntities.length} events to Arkiv DB`);
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

  if (result.rows.length === 0) {
    console.log('📭 No new sessions to sync');
    return;
  }

  await initGolem();
  const syncTime = Math.floor(Date.now() / 1000);

  const creates = result.rows.map(row => ({
    payload: jsonToPayload({
      ...row,
      created_at: formatTimestamp(row.created_at)
    }),
    contentType: 'application/json',
    attributes: toAttributes([
      ['type', 'session'],
      ['source', 'umami'],
      ['website_id', row.website_id],
      ['country', row.country || 'unknown'],
      ['device', row.device || 'unknown'],
      ['timestamp', formatTimestamp(row.created_at)],
      ['umami_id', row.id],
      ['session_id', row.session_id],
      ['sync_time', syncTime]
    ]),
    expiresIn: calculateBTL(1)
  }));

  const { createdEntities } = await arkivClient.mutateEntities({ creates });
  console.log(`✅ Synced ${createdEntities.length} sessions to Arkiv DB`);
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

  if (result.rows.length === 0) {
    console.log('📭 No website metadata changes to sync');
    return;
  }

  await initGolem();
  const syncTime = Math.floor(Date.now() / 1000);

  const creates = result.rows.map(row => ({
    payload: jsonToPayload({
      ...row,
      created_at: formatTimestamp(row.created_at),
      updated_at: formatTimestamp(row.updated_at)
    }),
    contentType: 'application/json',
    attributes: toAttributes([
      ['type', 'website_metadata'],
      ['source', 'umami'],
      ['website_id', row.id],
      ['domain', row.domain],
      ['name', row.name],
      ['timestamp', formatTimestamp(row.updated_at || row.created_at)],
      ['umami_id', row.id],
      ['sync_time', syncTime]
    ]),
    expiresIn: calculateBTL(2)
  }));

  const { createdEntities } = await arkivClient.mutateEntities({ creates });
  console.log(`✅ Synced ${createdEntities.length} websites to Arkiv DB`);
}

// Funkcja pełnej synchronizacji
async function fullSync() {
  try {
    console.log('🚀 Starting Umami → Arkiv DB sync...');

    await initGolem();

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

// Funkcja zapytań do Arkiv DB
async function queryGolemData(type, filters = {}) {
  await initGolem();

  const predicates = [
    eq('source', 'umami'),
    eq('type', type)
  ];

  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === null) {
      continue;
    }
    predicates.push(eq(key, typeof value === 'number' ? value : String(value)));
  }

  const results = [];
  const pageSize = 200;

  const builder = arkivClient
    .buildQuery()
    .ownedBy(arkivAccount.address)
    .withAttributes(true)
    .withPayload(true)
    .limit(pageSize)
    .where(predicates);

  let queryResult = await builder.fetch();
  results.push(...queryResult.entities.map(entity => entity.toJson()));

  while (queryResult.hasNextPage()) {
    await queryResult.next();
    results.push(...queryResult.entities.map(entity => entity.toJson()));
  }

  return results;
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
      console.log('  node golem-sync.js sync              # Sync Umami data to Arkiv DB');
      console.log('  node golem-sync.js query <type>      # Query data from Arkiv DB');
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