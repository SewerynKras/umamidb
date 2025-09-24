#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

// Konfiguracja Umami
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

// Funkcja logowania do Umami
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
      throw new Error(`Login failed: ${response.status}`);
    }
  } catch (error) {
    throw new Error(`Login error: ${error.message}`);
  }
}

// Funkcja pobierania wszystkich stron
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
      return response.data.data || response.data;
    } else {
      throw new Error(`Failed to get websites: ${response.status}`);
    }
  } catch (error) {
    throw new Error(`Get websites error: ${error.message}`);
  }
}

// Funkcja tworzenia nowej strony
async function createWebsite(token, name, domain) {
  const options = {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    }
  };

  const websiteData = {
    name: name,
    domain: domain
  };

  try {
    const response = await makeRequest(`${UMAMI_URL}/api/websites`, options, websiteData);
    if (response.status === 200 || response.status === 201) {
      return response.data;
    } else {
      throw new Error(`Failed to create website: ${response.status} - ${JSON.stringify(response.data)}`);
    }
  } catch (error) {
    throw new Error(`Create website error: ${error.message}`);
  }
}

// Funkcja wykrywania domeny z różnych źródeł
function detectDomain(projectPath) {
  const sources = [
    // Z docker-compose.yml - labels
    () => {
      try {
        const composePath = path.join(projectPath, 'docker-compose.yml');
        if (fs.existsSync(composePath)) {
          const content = fs.readFileSync(composePath, 'utf8');

          // Szukaj traefik.http.routers.*.rule=Host(`domain.com`)
          const hostMatch = content.match(/traefik\.http\.routers\.[^=]*\.rule=Host\(`([^`]+)`\)/);
          if (hostMatch) {
            return hostMatch[1];
          }

          // Szukaj traefik.frontend.rule=Host:domain.com
          const frontendMatch = content.match(/traefik\.frontend\.rule=Host:([^\\s,]+)/);
          if (frontendMatch) {
            return frontendMatch[1];
          }

          // Szukaj - "domain.com:port"
          const portMatch = content.match(/- "([^:]+):\d+"/);
          if (portMatch) {
            return portMatch[1];
          }
        }
      } catch (e) {
        // ignore
      }
      return null;
    },

    // Z .env - DOMAIN, URL itp
    () => {
      try {
        const envPath = path.join(projectPath, '.env');
        if (fs.existsSync(envPath)) {
          const content = fs.readFileSync(envPath, 'utf8');

          const domainMatch = content.match(/^DOMAIN=(.+)$/m) ||
                            content.match(/^APP_URL=https?:\/\/([^\\s\\/]+)/m) ||
                            content.match(/^URL=https?:\/\/([^\\s\\/]+)/m) ||
                            content.match(/^HOST=([^\\s]+)$/m);

          if (domainMatch) {
            return domainMatch[1].replace(/\/$/, '');
          }
        }
      } catch (e) {
        // ignore
      }
      return null;
    },

    // Z package.json - homepage
    () => {
      try {
        const packagePath = path.join(projectPath, 'package.json');
        if (fs.existsSync(packagePath)) {
          const content = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
          if (content.homepage) {
            const url = new URL(content.homepage);
            return url.hostname;
          }
        }
      } catch (e) {
        // ignore
      }
      return null;
    }
  ];

  for (const source of sources) {
    const domain = source();
    if (domain) {
      return domain;
    }
  }

  return null;
}

// Funkcja aktualizacji .env
function updateEnvFile(projectPath, websiteId) {
  const envPath = path.join(projectPath, '.env');
  let content = '';

  if (fs.existsSync(envPath)) {
    content = fs.readFileSync(envPath, 'utf8');
  }

  // Sprawdź czy już istnieje UMAMI_WEBSITE_ID
  if (content.includes('UMAMI_WEBSITE_ID=')) {
    // Zamień istniejący
    content = content.replace(/UMAMI_WEBSITE_ID=.*/g, `UMAMI_WEBSITE_ID=${websiteId}`);
  } else {
    // Dodaj nowy
    content += `\n# Umami Analytics\nUMAMI_WEBSITE_ID=${websiteId}\n`;
  }

  fs.writeFileSync(envPath, content);
}

// Funkcja znajdowania strony po domenie
function findWebsiteByDomain(websites, domain) {
  const normalizedDomain = domain.replace(/^https?:\/\//, '').replace(/\/$/, '');

  return websites.find(website => {
    const siteDomain = website.domain.replace(/^https?:\/\//, '').replace(/\/$/, '');
    return siteDomain === normalizedDomain ||
           siteDomain === `*.${normalizedDomain}` ||
           (siteDomain.startsWith('*.') && normalizedDomain.endsWith(siteDomain.substring(2)));
  });
}

// Główna funkcja
async function main() {
  const projectPath = process.argv[2] || process.cwd();

  console.log(`🔍 Scanning project: ${projectPath}`);

  // Wykryj domenę
  const domain = detectDomain(projectPath);
  if (!domain) {
    console.error('❌ Could not detect domain. Please check your docker-compose.yml or .env file.');
    console.log('Expected formats:');
    console.log('- docker-compose.yml: traefik.http.routers.*.rule=Host(`domain.com`)');
    console.log('- .env: DOMAIN=domain.com or APP_URL=https://domain.com');
    process.exit(1);
  }

  console.log(`🌐 Detected domain: ${domain}`);

  try {
    // Zaloguj do Umami
    console.log('🔐 Logging in to Umami...');
    const token = await login();

    // Pobierz listę stron
    console.log('📋 Getting websites from Umami...');
    const websites = await getWebsites(token);

    // Sprawdź czy strona już istnieje
    let website = findWebsiteByDomain(websites, domain);

    if (website) {
      console.log(`✅ Website found: ${website.name} (${website.domain})`);
    } else {
      // Stwórz nową stronę
      console.log(`➕ Creating new website for ${domain}...`);
      const projectName = path.basename(projectPath);
      website = await createWebsite(token, projectName, domain);
      console.log(`✅ Website created: ${website.name} (${website.domain})`);
    }

    // Aktualizuj .env
    console.log('📝 Updating .env file...');
    updateEnvFile(projectPath, website.id);

    console.log(`🎉 Setup complete!`);
    console.log(`📊 Website ID: ${website.id}`);
    console.log(`🔗 Tracking URL: ${UMAMI_URL}/websites/${website.id}`);
    console.log(`\n📋 Add this to your HTML:`);
    console.log(`<script async src="/script.js" data-website-id="${website.id}"></script>`);

  } catch (error) {
    console.error(`❌ Error: ${error.message}`);
    process.exit(1);
  }
}

main();