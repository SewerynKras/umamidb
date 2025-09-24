# Umami Analytics System

System analityki Umami do trackowania użytkowników w aplikacjach.

## Uruchomienie

```bash
docker compose up -d
```

## Konfiguracja

1. Otwórz https://umami.golemdb.io
2. Zaloguj się przy pierwszym uruchomieniu:
   - Login: `admin`
   - Hasło: `[sprawdź UMAMI_ADMIN_PASSWORD w .env]`
3. Zmień hasło po pierwszym logowaniu
4. Dodaj nową stronę do trackowania

## Dodawanie trackingu do aplikacji

Do każdej aplikacji dodaj tracking script:

```html
<script
  async
  src="https://umamidb.online/script.js"
  data-website-id="YOUR_WEBSITE_ID"
></script>
```

Gdzie `YOUR_WEBSITE_ID` to ID wygenerowane w panelu Umami.

## Używanie w innych projektach

W każdym projekcie Docker Compose użyj sieci `moon_golem_network`:

```yaml
networks:
  default:
    external: true
    name: moon_golem_network
```

Wtedy tracking script będzie dostępny przez sieć Docker.

## Hasła

Bezpieczne hasła są ustawione w pliku `.env`.

**Ważne**: Po pierwszym logowaniu zmień domyślne hasło administratora!