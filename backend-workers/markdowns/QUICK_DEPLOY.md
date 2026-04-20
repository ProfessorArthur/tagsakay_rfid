# Quick Deployment Guide - TagSakay Domain

**Prerequisites:** Domain added to Cloudflare with nameservers configured

---

## 🚀 5-Minute Production Deploy

### 1. DNS Setup (Cloudflare Dashboard)

```
DNS > Records > Add:
- Type: A, Name: api, Content: 192.0.2.1, Proxy: ON
- Type: CNAME, Name: app, Content: api.tagsakay.com, Proxy: ON
```

### 2. Deploy Backend (PowerShell)

```powershell
cd backend-workers
npm run deploy
npx wrangler secret put DATABASE_URL --env production
npx wrangler secret put JWT_SECRET --env production
```

### 3. Configure Custom Domain

```
Cloudflare Dashboard > Workers & Pages > tagsakay-api-production
> Settings > Domains & Routes > Add Custom Domain > api.tagsakay.com
```

### 4. Deploy Frontend

```powershell
cd frontend
npm run build
npx wrangler pages deploy dist --project-name=tagsakay-frontend
```

Then add custom domain `app.tagsakay.com` in Pages dashboard.

### 5. Test Everything

```powershell
# Test backend
curl https://api.tagsakay.com/api/health

# Test frontend (browser)
https://app.tagsakay.com

# ESP32 already configured - just flash and power on
```

---

## 📱 ESP32 Quick Flash

**Production firmware already configured in Config.h:**

- Domain: api.tagsakay.com ✅
- SSL: Enabled (WSS) ✅
- Port: 443 ✅

```
Arduino IDE > Open TagSakay_Fixed_Complete.ino > Upload
Serial Monitor > Watch for "Connected to api.tagsakay.com"
```

---

## 🔍 Quick Troubleshooting

**Backend 404:** Wait 5 minutes for DNS propagation
**Frontend blank:** Check browser console, rebuild with `npm run build`
**ESP32 can't connect:** Verify WiFi and check Serial Monitor errors
**CORS errors:** Verify `app.tagsakay.com` in backend CORS config

---

**Full documentation:** See `DOMAIN_SETUP.md`
