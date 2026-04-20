# 🚀 Cloudflare Pages Deployment Guide

Complete step-by-step guide to deploy your TagSakay frontend to Cloudflare Pages.

---

## 📋 Prerequisites

### 1. Cloudflare Account

- Create account at https://dash.cloudflare.com
- Free tier includes Cloudflare Pages with unlimited deployments

### 2. Domain Name (Optional but recommended)

- Your own domain or use Cloudflare's free subdomain
- If using custom domain, add it to Cloudflare first

### 3. Git Repository

- Push your code to GitHub, GitLab, or Gitbucket
- (Cloudflare Pages integrates directly with Git)

### 4. Required Access

- Cloudflare account with admin privileges
- Git repository with push access

---

## ⚡ Quick Start (5 minutes)

### Option 1: Deploy via Wrangler CLI (Fastest)

```bash
# 1. Install Wrangler CLI
npm install -g wrangler

# 2. Login to Cloudflare
wrangler login
# Browser will open for authentication

# 3. Navigate to frontend directory
cd c:\Users\Myles\Documents\TagSakay_Capstone\frontend

# 4. Build frontend
npm run build

# 5. Deploy to Cloudflare Pages
wrangler pages deploy dist --project-name=tagsakay-frontend

# ✅ Done! Your site is live!
```

**Output:**

```
✅ Deployment complete!
🎉 Site URL: https://tagsakay-frontend.pages.dev
```

---

## 🔧 Step-by-Step Deployment Guide

### Step 1: Prepare Your Frontend

```bash
cd c:\Users\Myles\Documents\TagSakay_Capstone\frontend

# Install dependencies
npm install

# Verify build works locally
npm run build

# Check dist folder was created
dir dist

# Expected output:
# - dist/index.html
# - dist/assets/
# - dist/style.css
# - dist/js/
```

### Step 2: Verify Environment Configuration

**For Production:**

Update `.env.production` with your actual backend API URL:

```bash
# .env.production
VITE_API_URL=https://api.yourdomain.com/api

# Or if using Cloudflare Workers subdomain:
VITE_API_URL=https://tagsakay-api.yourdomain.com/api
```

Verify in your code that environment variables are used correctly:

```typescript
// src/config/env.ts
export const API_URL =
  import.meta.env.VITE_API_URL || "http://localhost:8787/api";
```

### Step 3: Create Cloudflare Pages Project

#### Option A: Via Dashboard

1. **Open Cloudflare Dashboard**

   - Go to https://dash.cloudflare.com

2. **Select Your Domain**

   - Choose your domain (or create new)

3. **Navigate to Pages**

   - Left sidebar → Pages

4. **Create Project**

   - Click "Create a project"
   - Choose "Connect to Git"

5. **Connect GitHub/GitLab**

   - Authorize Cloudflare
   - Select your repository
   - Select branch (main)

6. **Configure Build Settings**

   - Framework: Vue (Vite)
   - Build command: `npm run build`
   - Build output directory: `dist`
   - Environment variables:
     - Name: `VITE_API_URL`
     - Value: `https://api.yourdomain.com/api`

7. **Deploy**
   - Click "Save and Deploy"
   - Wait 2-5 minutes for build

#### Option B: Via Wrangler CLI (Recommended)

```bash
# 1. Build your frontend
cd frontend
npm run build

# 2. Install Wrangler if not already installed
npm install -g wrangler

# 3. Login to Cloudflare
wrangler login

# 4. Deploy
wrangler pages deploy dist --project-name=tagsakay-frontend

# 5. Set environment variables
wrangler pages secrets create VITE_API_URL --project-name=tagsakay-frontend
# Enter: https://api.yourdomain.com/api
```

### Step 4: Configure Custom Domain (Optional)

**Connect Your Domain:**

1. **In Cloudflare Dashboard:**

   - Go to Pages → Your Project
   - Settings → Custom domains
   - Add custom domain

2. **Update DNS Records:**

   - Cloudflare will provide DNS records to add
   - Add CNAME record pointing to your Pages deployment

3. **Verify Domain:**
   - Wait for DNS propagation (can take minutes)
   - Test: `curl https://yourdomain.com`

**Example DNS Setup:**

```
Type: CNAME
Name: www
Target: tagsakay-frontend.pages.dev
Proxy Status: Proxied (orange cloud)
```

---

## 🔄 Automated Deployment (GitHub Actions)

### Create GitHub Actions Workflow

**File: `.github/workflows/deploy-frontend.yml`**

```yaml
name: Deploy Frontend to Cloudflare Pages

on:
  push:
    branches:
      - main
    paths:
      - "frontend/**"
      - ".github/workflows/deploy-frontend.yml"

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: "18"
          cache: "npm"
          cache-dependency-path: frontend/package-lock.json

      - name: Install dependencies
        run: |
          cd frontend
          npm ci

      - name: Build
        run: |
          cd frontend
          npm run build
        env:
          VITE_API_URL: https://api.tagsakay.com/api

      - name: Deploy to Cloudflare Pages
        uses: cloudflare/pages-action@v1
        with:
          apiToken: ${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          projectName: tagsakay-frontend
          directory: frontend/dist
          gitHubToken: ${{ secrets.GITHUB_TOKEN }}
```

### Setup GitHub Secrets

1. **Get Cloudflare API Token:**

   - Go to https://dash.cloudflare.com/profile/api-tokens
   - Create token with "Cloudflare Pages Edit" permission
   - Copy token

2. **Get Cloudflare Account ID:**

   - Go to https://dash.cloudflare.com/
   - Bottom left corner, copy Account ID

3. **Add to GitHub Secrets:**

   - Go to your repo → Settings → Secrets and variables → Actions
   - Add:
     - `CLOUDFLARE_API_TOKEN` = your API token
     - `CLOUDFLARE_ACCOUNT_ID` = your account ID

4. **Now every push to main will auto-deploy!**

---

## 🔐 Environment Variables in Production

### Set via Dashboard

1. **Open Cloudflare Dashboard**

   - Pages → Your Project → Settings → Environment variables

2. **Add Variable**

   - Variable name: `VITE_API_URL`
   - Value: `https://api.yourdomain.com/api`
   - Click "Encrypt" if sensitive

3. **Redeploy**
   - Settings → Deployments
   - Click "Retry build" on latest deployment

### Set via Wrangler CLI

```bash
# Set for current deployment
wrangler pages functions secrets create VITE_API_URL \
  --project-name=tagsakay-frontend
# Enter: https://api.yourdomain.com/api

# View all secrets
wrangler pages functions secrets list --project-name=tagsakay-frontend
```

---

## ✅ Post-Deployment Verification

### 1. Test Frontend Loads

```bash
# Test your deployed site
curl https://tagsakay-frontend.pages.dev

# Or open in browser
# https://tagsakay-frontend.pages.dev
```

### 2. Verify API Connection

```bash
# Check if API URL is correctly configured
curl https://tagsakay-frontend.pages.dev/config

# Should show your backend API is configured
```

### 3. Test User Login

1. Open https://tagsakay-frontend.pages.dev
2. Navigate to Login page
3. Enter test credentials:
   - Email: `admin@tagsakay.local`
   - Password: `Admin123!@#`
4. Should redirect to dashboard

### 4. Check DevTools Console

Open browser DevTools (F12) → Console:

```javascript
// Should show your API URL
console.log(import.meta.env.VITE_API_URL);
// Output: https://api.yourdomain.com/api
```

### 5. Monitor Deployment

In Cloudflare Dashboard:

- Pages → Your Project → Deployments
- View build logs and status
- Check for errors

---

## 📊 Production Optimization

### Enable Analytics

```bash
# In Cloudflare Dashboard
# Settings → Analytics Engine → Enable
```

### Configure Caching

**In Cloudflare Dashboard:**

1. Go to Pages → Your Project → Settings
2. Under "Build settings":
   - Cache on Save: Enabled
   - Build cache retention: 30 minutes (default)

### Security Headers

Create `_headers` file in `public/` directory:

```
/*
  X-Content-Type-Options: nosniff
  X-Frame-Options: DENY
  X-XSS-Protection: 1; mode=block
  Referrer-Policy: strict-origin-when-cross-origin
  Permissions-Policy: geolocation=(), microphone=(), camera=()
```

### Redirects & Rewrites

Create `_redirects` file in `public/` directory:

```
# Redirect non-www to www
https://tagsakay-frontend.pages.dev/* https://www.tagsakay-frontend.pages.dev/:splat 301

# Rewrite SPA routes (Vue Router)
/* /index.html 200

# Redirect old URLs
/old-page /new-page 301
```

### Compression

Enable Brotli compression in Cloudflare:

1. Dashboard → Your Domain → Settings
2. Browser rendering: Mirage (optional)
3. HTTP/3: On
4. Brotli: On

---

## 🚨 Troubleshooting

### Issue: Build Fails

**Check build logs:**

```bash
# 1. In Cloudflare Dashboard
# Pages → Your Project → Deployments → Failed deployment → View build logs

# 2. Common causes:
# - Missing environment variables
# - Node version mismatch
# - Dependency issues
```

**Fix:**

```bash
# Rebuild locally first
npm install
npm run build

# Check for errors
npm run type-check  # TypeScript errors
npm run preview     # Test production build locally
```

### Issue: API Connection Fails

**Diagnose:**

```bash
# 1. Check API URL in browser console
# F12 → Console
console.log(import.meta.env.VITE_API_URL)

# 2. Verify backend is accessible
curl https://api.yourdomain.com/api/health

# 3. Check CORS headers
curl -I https://api.yourdomain.com/api/health
# Look for: Access-Control-Allow-Origin
```

**Fix:**

```bash
# 1. Verify environment variable
# Dashboard → Settings → Environment variables

# 2. Rebuild and redeploy
wrangler pages deploy dist --project-name=tagsakay-frontend

# 3. Clear cache (if needed)
# Dashboard → Caching → Purge cache
```

### Issue: Blank Page

**Diagnose:**

```bash
# 1. Check browser console for errors
# F12 → Console → Look for red errors

# 2. Check network requests
# F12 → Network → Look for failed requests

# 3. Test build locally
npm run preview
```

**Fix:**

```bash
# 1. Check dependencies are installed
npm install

# 2. Rebuild
npm run build

# 3. Verify dist folder has files
dir dist
```

### Issue: 404 on Refresh

**Cause:** Vue Router SPA routes not configured

**Fix:**

Create `public/_redirects`:

```
/* /index.html 200
```

Then redeploy:

```bash
npm run build
wrangler pages deploy dist --project-name=tagsakay-frontend
```

---

## 📈 Monitoring & Analytics

### View Performance Metrics

In Cloudflare Dashboard:

- Pages → Your Project → Analytics
- View:
  - Page views
  - Unique visitors
  - Response time
  - Error rate

### Set Up Error Tracking

```bash
# 1. In Cloudflare Workers (backend)
# Add error logging endpoint

# 2. In frontend, catch and report errors
window.addEventListener('error', (event) => {
  console.error('Frontend error:', event.error);
  // Optional: send to error tracking service
});

// Vue error handler
app.config.errorHandler = (err, instance, info) => {
  console.error('Vue error:', err, info);
};
```

### Enable Rate Limiting (Optional)

In Cloudflare Dashboard:

- Firewall → Rate Limiting
- Create rule:
  - Path: `/*`
  - Rate: 100 requests per 10 seconds
  - Action: Challenge

---

## 🔄 Rollback to Previous Deployment

If something goes wrong:

```bash
# 1. In Cloudflare Dashboard
# Pages → Your Project → Deployments

# 2. Find previous successful deployment
# Click "...menu" → "View details"

# 3. Click "Rollback to this deployment"
# Site will revert immediately

# Or via CLI:
wrangler pages deployments rollback --project-name=tagsakay-frontend
```

---

## 📚 Useful Cloudflare Pages Commands

```bash
# List all projects
wrangler pages project list

# View project details
wrangler pages project info --project-name=tagsakay-frontend

# View deployments
wrangler pages deployments list --project-name=tagsakay-frontend

# View specific deployment
wrangler pages deployment info --project-name=tagsakay-frontend

# Trigger a rebuild
wrangler pages deployments create --project-name=tagsakay-frontend

# Set secrets
wrangler pages functions secrets create MY_SECRET --project-name=tagsakay-frontend

# Delete project (careful!)
wrangler pages project delete --project-name=tagsakay-frontend
```

---

## 🎯 Complete Deployment Checklist

- [ ] Frontend builds locally (`npm run build`)
- [ ] No TypeScript errors (`npm run type-check`)
- [ ] Environment variables configured
- [ ] Backend API is accessible
- [ ] CORS configured on backend
- [ ] Git repository ready and pushed
- [ ] Cloudflare account created
- [ ] Domain added to Cloudflare (if using custom domain)
- [ ] Cloudflare Pages project created
- [ ] Build settings configured
- [ ] Deployment triggered
- [ ] Site loads without errors
- [ ] Login page works
- [ ] API requests succeed
- [ ] Custom domain configured (if applicable)
- [ ] SSL certificate issued (automatic)
- [ ] Analytics enabled (optional)
- [ ] Redirects configured (if needed)
- [ ] Security headers set (if needed)

---

## 🚀 Next Steps

1. **Immediately:** Deploy to Cloudflare Pages using Wrangler or Dashboard
2. **Test:** Verify frontend loads and can connect to backend
3. **Domain:** Setup custom domain for production URL
4. **Monitor:** Check analytics and error logs regularly
5. **Automate:** Setup GitHub Actions for automatic deployments on push
6. **Optimize:** Enable Cloudflare security and performance features

---

**Your TagSakay frontend is now production-ready!** 🎉

Deploy with confidence knowing:

- ✅ Global CDN for fast performance
- ✅ Automatic HTTPS/SSL
- ✅ DDoS protection included
- ✅ 99.9% uptime SLA
- ✅ Free tier includes unlimited deployments

**Happy deploying!** 🚀
