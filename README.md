# 📊 Umami Analytics - Arkiv DB Edition

Privacy-first web analytics with blockchain backup powered by Arkiv DB storage.

## ✨ Features

- **🔒 Privacy First**: No cookies, no cross-site tracking, GDPR compliant
- **⚡ Lightweight**: 2KB tracking script that won't slow down your website
- **⛓️ Blockchain Backup**: Automatic data sync to Arkiv DB for decentralized storage
- **🌐 Multi-Website**: Track multiple websites from one dashboard
- **📊 Real-time Analytics**: Live dashboard with essential metrics
- **🚀 Self-hosted**: Full control over your data

## 🛠️ Tech Stack

- **Frontend**: Next.js 15, React 18, Tailwind CSS
- **Backend**: Node.js, PostgreSQL 15, Prisma ORM
- **Blockchain**: Arkiv DB (Kaolin testnet)
- **Infrastructure**: Docker Compose, Traefik reverse proxy
- **Analytics**: Real-time tracking with session management

## 🚀 Quick Start

### Prerequisites
- Docker & Docker Compose
- Traefik reverse proxy (for SSL)

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/m00npl/umamidb.git
   cd umamidb
   ```

2. **Configure environment**
   ```bash
   cp .env.example .env
   # Edit .env with your settings
   ```

3. **Start services**
   ```bash
   docker compose up -d
   ```

4. **Access dashboard**
   - Open: <https://umami.golemdb.io>
   - Login: `admin`
   - Password: `[check UMAMI_ADMIN_PASSWORD in .env]`

## 🔧 Configuration

### Environment Variables

Create `.env` file with:

```env
# Umami Configuration
DATABASE_URL=postgresql://umami_user:YOUR_DB_PASSWORD@db:5432/umami
APP_SECRET=YOUR_APP_SECRET

# Umami API Access
UMAMI_URL=https://umami.golemdb.io
UMAMI_USERNAME=admin
UMAMI_PASSWORD=YOUR_PASSWORD

# PostgreSQL
POSTGRES_DB=umami
POSTGRES_USER=umami_user
POSTGRES_PASSWORD=YOUR_DB_PASSWORD

# Arkiv Configuration
ARKIV_PRIVATE_KEY=0xYOUR_PRIVATE_KEY
ARKIV_CHAIN_ID=60138453025
ARKIV_RPC_URL=https://kaolin.hoodi.arkiv.network/rpc
ARKIV_WS_URL=wss://kaolin.hoodi.arkiv.network/rpc/ws
```

### Adding Websites

Use the automated setup script:

```bash
node setup-all-projects.js
```

Or manually through the dashboard at <https://umami.golemdb.io/dashboard>

## 📈 Adding Tracking to Your Website

Add this script to your website's `<head>` section:

```html
<script
  async
  src="https://umami.golemdb.io/script.js"
  data-website-id="YOUR_WEBSITE_ID"
></script>
```

### With Docker Compose

Add to your service in `docker-compose.yml`:

```yaml
networks:
  default:
    external: true
    name: moon_golem_network
```

Then add Traefik labels for script proxying:

```yaml
labels:
  - "traefik.http.routers.myapp-script.rule=Host(\`myapp.com\`) && Path(\`/script.js\`)"
  - "traefik.http.routers.myapp-script.service=umami-app@docker"
```

## ⛓️ Arkiv DB Integration

### Real-time Sync

Data is automatically synced to Golem DB blockchain **in real-time** using a sophisticated queue system:

- **🚀 Instant Sync**: Data synced immediately after being recorded in Umami
- **📦 Batch Processing**: Queue batches up to 10 items or 5-second timeout
- **🔄 Retry Logic**: Exponential backoff with 3 retry attempts (1s → 2s → 4s)
- **💾 Database Triggers**: PostgreSQL triggers for instant notifications
- **⚡ Performance**: Optimized for high throughput with minimal latency

### Synced Data Types

- **Pageviews**: URL, referrer, timestamp, hostname
- **Events**: Custom events with metadata and event names
- **Sessions**: User sessions, device info, geolocation
- **Websites**: Site metadata and domain information

### Data Retention & Storage

- **Database**: Indefinite PostgreSQL storage
- **Blockchain**: 30 days retention (BTL: ~1,296,000 blocks)
- **Annotations**: Smart tagging with type, source, website_id, timestamp
- **Querying**: Efficient blockchain queries using annotation filters

### Sync Services

#### Real-time Sync (Default)

```bash
# Runs automatically with main services
docker compose up -d
```

#### Legacy Manual Sync

```bash
# One-time sync for historical data
docker compose --profile sync up golem-sync
```

### Monitoring Real-time Sync

```bash
# View real-time sync logs
docker compose logs golem-realtime-sync -f

# Check sync service status
docker compose ps golem-realtime-sync
```

## 🔍 API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/auth/login` | Authenticate user |
| GET | `/api/websites` | List websites |
| POST | `/api/websites` | Create website |
| GET | `/api/websites/:id/stats` | Get analytics |
| POST | `/api/send` | Receive tracking data |
| GET | `/script.js` | Tracking script |

## 📊 Configured Websites

The following websites are pre-configured:

- **CopyPal** (copypal.online)
- **DrawioDB** (drawiodb.online)
- **FileDB** (filedb.online)
- **ImageDB** (imagedb.online)
- **WebDB** (webdb.site)

## 🛡️ Security

- **No Tracking Cookies**: Fully cookieless tracking
- **IP Hashing**: Anonymized visitor identification
- **GDPR Compliant**: No consent banners required
- **Encrypted Backup**: Secure blockchain storage
- **Environment Secrets**: All credentials in `.env`

## 🔧 Development

### Running Sync Services

```bash
# Install dependencies
bun install

# Run real-time sync
node real-time-sync.js

# Run legacy manual sync
node golem-sync.js sync

# Query blockchain data
node golem-sync.js query
```

### Database Access

```bash
docker compose exec db psql -U umami_user -d umami
```

## 📁 Project Structure

```text
├── docker-compose.yml      # Main services configuration
├── real-time-sync.js       # Real-time blockchain sync with queue
├── golem-sync.js          # Legacy manual sync script
├── setup-all-projects.js  # Automated website setup
├── public/
│   └── index.html         # Landing page
├── .env                   # Environment configuration
└── README.md             # This file
```

## 🤝 Contributing

1. Fork the repository
2. Create feature branch
3. Make changes
4. Test thoroughly
5. Submit pull request

## 📜 License

MIT License - see LICENSE file for details

## 🔗 Links

- **Live Demo**: <https://umami.golemdb.io>
- **Dashboard**: <https://umami.golemdb.io/dashboard>
- **Umami Official**: <https://umami.is>
- **Arkiv Network**: <https://arkiv.network>

---

Built with ❤️ for the decentralized web
