#!/usr/bin/env node

const https = require('https');
const http = require('http');

// Konfiguracja
const UMAMI_URL = process.env.UMAMI_URL || 'https://umami.golemdb.io';
const USERNAME = process.env.UMAMI_USERNAME || 'admin';
const PASSWORD = process.env.UMAMI_PASSWORD;

if (!PASSWORD) {
  console.error('❌ UMAMI_PASSWORD environment variable is required');
  process.exit(1);
}

// Funkcja do wykonania HTTP request
function makeRequest(url, options, postData = null) {
  return new Promise((resolve, reject) => {
    const lib = url.startsWith('https') ? https : http;

    const req = lib.request(url, options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          resolve({ status: res.statusCode, data: parsed });
        } catch (e) {
          resolve({ status: res.statusCode, data: data });
        }
      });
    });

    req.on('error', reject);

    if (postData) {
      req.write(JSON.stringify(postData));
    }
    req.end();
  });
}

// Funkcja logowania
async function login() {
  const options = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    }
  };

  const loginData = {
    username: USERNAME,
    password: PASSWORD
  };

  try {
    const response = await makeRequest(`${UMAMI_URL}/api/auth/login`, options, loginData);

    if (response.status === 200 && response.data.token) {
      return response.data.token;
    } else {
      throw new Error(`Login failed: ${response.status} - ${JSON.stringify(response.data)}`);
    }
  } catch (error) {
    throw new Error(`Login error: ${error.message}`);
  }
}

// Funkcja pobierania stron
async function getWebsites(token) {
  const options = {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    }
  };

  try {
    const response = await makeRequest(`${UMAMI_URL}/api/websites`, options);

    if (response.status === 200) {
      return response.data;
    } else {
      throw new Error(`Failed to get websites: ${response.status} - ${JSON.stringify(response.data)}`);
    }
  } catch (error) {
    throw new Error(`Get websites error: ${error.message}`);
  }
}

// Funkcja wyszukiwania strony po domenie
function findWebsiteByDomain(websitesResponse, domain) {
  const normalizedDomain = domain.replace(/^https?:\/\//, '').replace(/\/$/, '');
  const websites = websitesResponse.data || websitesResponse;

  return websites.find(website => {
    const siteDomain = website.domain.replace(/^https?:\/\//, '').replace(/\/$/, '');
    return siteDomain === normalizedDomain || siteDomain.includes(normalizedDomain);
  });
}

// Główna funkcja
async function main() {
  const domain = process.argv[2];

  if (!domain) {
    console.log('Usage: node get-website-id.js <domain>');
    console.log('Example: node get-website-id.js example.com');
    process.exit(1);
  }

  try {
    console.log('Logging in...');
    const token = await login();

    console.log('Getting websites...');
    const websites = await getWebsites(token);

    console.log('Searching for domain:', domain);
    const website = findWebsiteByDomain(websites, domain);

    if (website) {
      console.log('Website found:');
      console.log(`ID: ${website.id}`);
      console.log(`Name: ${website.name}`);
      console.log(`Domain: ${website.domain}`);
      console.log(`Website UUID: ${website.websiteUuid || website.shareId}`);

      // Export as environment variable format
      console.log(`\nAdd to your .env:`);
      console.log(`UMAMI_WEBSITE_ID=${website.id}`);
    } else {
      console.log('Website not found for domain:', domain);
      console.log('\nAvailable websites:');
      const sites = websites.data || websites;
      sites.forEach(site => {
        console.log(`- ${site.name}: ${site.domain} (ID: ${site.id})`);
      });
    }

  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

main();