#!/usr/bin/env node

const { createClient } = require('golem-base-sdk');
const https = require('https');
const http = require('http');
require('dotenv').config();

// Konfiguracja Umami
const UMAMI_URL = 'https://umami.golemdb.io';
const USERNAME = process.env.UMAMI_USERNAME || 'admin';
const PASSWORD = process.env.UMAMI_PASSWORD;

if (!PASSWORD) {
  console.error('❌ UMAMI_PASSWORD environment variable is required');
  process.exit(1);
}

// Lista projektów do skonfigurowania
const PROJECTS = [
  {
    name: 'CopyPal',
    domain: 'copypal.online',
    description: 'AI-powered copy-paste tool for developers'
  },
  {
    name: 'DrawioDB',
    domain: 'drawiodb.online',
    description: 'Drawing and graphics storage on Golem DB'
  },
  {
    name: 'FileDB',
    domain: 'filedb.online',
    description: 'File storage and sharing on Golem DB'
  },
  {
    name: 'ImageDB',
    domain: 'imagedb.online',
    description: 'Image chunking middleware for Golem DB'
  },
  {
    name: 'WebDB',
    domain: 'webdb.site',
    description: 'Static site hosting on Golem DB'
  }
];

// HTTP request helper
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

// Login to Umami
async function loginToUmami() {
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

// Get all websites from Umami
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
      throw new Error(`Failed to get websites: ${response.status} - ${JSON.stringify(response.data)}`);
    }
  } catch (error) {
    throw new Error(`Get websites error: ${error.message}`);
  }
}

// Create new website in Umami
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

// Find website by domain
function findWebsiteByDomain(websites, domain) {
  const normalizedDomain = domain.replace(/^https?:\/\//, '').replace(/\/$/, '');

  return websites.find(website => {
    const siteDomain = website.domain.replace(/^https?:\/\//, '').replace(/\/$/, '');
    return siteDomain === normalizedDomain ||
           siteDomain === `*.${normalizedDomain}` ||
           (siteDomain.startsWith('*.') && normalizedDomain.endsWith(siteDomain.substring(2)));
  });
}

// Setup all projects
async function setupAllProjects() {
  try {
    console.log('🚀 Setting up Umami tracking for all projects...');

    // Login to Umami
    console.log('🔐 Logging into Umami...');
    const token = await loginToUmami();

    // Get existing websites
    console.log('📋 Getting existing websites...');
    const websites = await getWebsites(token);

    const results = [];

    // Process each project
    for (const project of PROJECTS) {
      console.log(`\n📊 Processing ${project.name} (${project.domain})...`);

      // Check if website already exists
      let website = findWebsiteByDomain(websites, project.domain);

      if (website) {
        console.log(`✅ Website already exists: ${website.name}`);
        results.push({
          project: project.name,
          domain: project.domain,
          websiteId: website.id,
          status: 'existing'
        });
      } else {
        console.log(`➕ Creating new website for ${project.domain}...`);
        try {
          website = await createWebsite(token, project.name, project.domain);
          console.log(`✅ Website created: ${website.name}`);
          results.push({
            project: project.name,
            domain: project.domain,
            websiteId: website.id,
            status: 'created'
          });
        } catch (error) {
          console.error(`❌ Failed to create website for ${project.name}: ${error.message}`);
          results.push({
            project: project.name,
            domain: project.domain,
            websiteId: null,
            status: 'failed',
            error: error.message
          });
        }
      }
    }

    // Summary
    console.log('\n🎉 Setup completed!');
    console.log('\n📋 Summary:');
    console.log('═'.repeat(80));

    results.forEach(result => {
      const status = result.status === 'existing' ? '✅ Existing' :
                    result.status === 'created' ? '🆕 Created' : '❌ Failed';

      console.log(`${status} | ${result.project.padEnd(12)} | ${result.domain.padEnd(20)} | ${result.websiteId || 'N/A'}`);

      if (result.status !== 'failed') {
        console.log(`         | Add to .env: UMAMI_WEBSITE_ID=${result.websiteId}`);
        console.log(`         | Tracking: <script async src="/script.js" data-website-id="${result.websiteId}"></script>`);
      }
      console.log('');
    });

    // Generate tracking documentation
    console.log('\n📝 Next steps:');
    console.log('1. Add UMAMI_WEBSITE_ID to each project\'s .env file');
    console.log('2. Add tracking script to frontend templates');
    console.log('3. Restart services to apply Traefik proxy changes');
    console.log('4. Test tracking by visiting websites');

    console.log('\n🔧 Restart services:');
    results.filter(r => r.status !== 'failed').forEach(result => {
      const projectDir = result.project.toLowerCase().replace('db', 'db');
      console.log(`cd ~/projects/${projectDir} && docker compose up -d`);
    });

  } catch (error) {
    console.error(`❌ Setup failed: ${error.message}`);
    process.exit(1);
  }
}

// CLI interface
if (require.main === module) {
  setupAllProjects();
}

module.exports = {
  setupAllProjects,
  PROJECTS
};