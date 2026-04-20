<script setup lang="ts">
import { RouterLink } from "vue-router";

// No additional logic required; RouterLink import ensures type awareness for template usage.
</script>

<template>
  <div
    class="min-h-screen bg-gradient-to-b from-slate-900 via-slate-800 to-slate-900 text-white"
  >
    <header
      class="container mx-auto px-6 py-8 flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between"
    >
      <div>
        <h1 class="text-4xl font-bold tracking-tight sm:text-5xl">
          TagSakay RFID Operations Console
        </h1>
        <p class="mt-4 max-w-2xl text-lg text-slate-300">
          Streamline tricycle queue management with secure device onboarding,
          live RFID activity monitoring, and administrative dashboards designed
          for transport cooperatives.
        </p>
        <div class="mt-8 flex flex-col gap-4 sm:flex-row">
          <RouterLink
            to="/login"
            class="inline-flex items-center justify-center rounded-md bg-emerald-700 px-6 py-3 text-base font-semibold text-white shadow-lg shadow-emerald-900/30 transition hover:bg-emerald-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-300"
          >
            Sign In
          </RouterLink>
          <RouterLink
            to="/register"
            class="inline-flex items-center justify-center rounded-md border border-emerald-400 px-6 py-3 text-base font-semibold text-emerald-200 transition hover:border-emerald-300 hover:text-white"
          >
            Request Access
          </RouterLink>
        </div>
      </div>
      <div class="relative isolate mt-8 w-full max-w-xl lg:mt-0">
        <div
          class="absolute -top-4 -right-4 h-32 w-32 rounded-full bg-emerald-500/20 blur-3xl"
        ></div>
        <div
          class="rounded-2xl border border-white/10 bg-white/5 p-6 backdrop-blur"
        >
          <dl class="grid grid-cols-1 gap-6 sm:grid-cols-2">
            <div>
              <dt class="text-sm uppercase tracking-wider text-slate-400">
                Real-time Scans
              </dt>
              <dd class="mt-2 text-2xl font-semibold text-white">
                RFID dashboards with live updates and alerts.
              </dd>
            </div>
            <div>
              <dt class="text-sm uppercase tracking-wider text-slate-400">
                Device Control
              </dt>
              <dd class="mt-2 text-2xl font-semibold text-white">
                Remote registration mode & heartbeat visibility.
              </dd>
            </div>
            <div>
              <dt class="text-sm uppercase tracking-wider text-slate-400">
                Role Security
              </dt>
              <dd class="mt-2 text-2xl font-semibold text-white">
                Granular access for SuperAdmin, Admin, and Driver.
              </dd>
            </div>
            <div>
              <dt class="text-sm uppercase tracking-wider text-slate-400">
                Cloud Hosted
              </dt>
              <dd class="mt-2 text-2xl font-semibold text-white">
                Cloudflare Workers + Neon Postgres architecture.
              </dd>
            </div>
          </dl>
        </div>
      </div>
    </header>

    <section class="border-t border-white/10 bg-slate-900/80">
      <div
        class="container mx-auto grid max-w-6xl gap-10 px-6 py-16 md:grid-cols-2"
      >
        <div>
          <h2 class="text-2xl font-semibold text-white">
            Built for busy transport terminals
          </h2>
          <p class="mt-4 text-slate-300">
            TagSakay keeps operators in control with audit-ready logs, device
            health signals, and rate-limited APIs hardened for production
            cooperatives.
          </p>
        </div>
        <div class="space-y-6">
          <div class="rounded-xl border border-white/10 bg-white/5 p-6">
            <h3 class="text-lg font-semibold text-white">
              Unified Admin Console
            </h3>
            <p class="mt-2 text-sm text-slate-300">
              Manage users, devices, RFID tags, and backup API keys from one
              secure Vue.js interface backed by OWASP-compliant services.
            </p>
          </div>
          <div class="rounded-xl border border-white/10 bg-white/5 p-6">
            <h3 class="text-lg font-semibold text-white">
              Reliable Device Heartbeats
            </h3>
            <p class="mt-2 text-sm text-slate-300">
              Monitor ESP32 scanners through automated heartbeats, registration
              mode toggles, and device profile syncs.
            </p>
          </div>
          <div class="rounded-xl border border-white/10 bg-white/5 p-6">
            <h3 class="text-lg font-semibold text-white">
              Actionable Analytics
            </h3>
            <p class="mt-2 text-sm text-slate-300">
              Export queue activity, scan counts, and registration events
              directly from TagSakay for operational planning.
            </p>
          </div>
        </div>
      </div>
    </section>

    <footer class="border-t border-white/10 bg-slate-950/80">
      <div
        class="container mx-auto flex flex-col items-center justify-between gap-6 px-6 py-12 text-center md:flex-row md:text-left"
      >
        <div>
          <p class="text-sm text-slate-400">
            TagSakay © {{ new Date().getFullYear() }}. Queue management made
            simple.
          </p>
        </div>
        <div class="flex gap-4 text-sm text-slate-300">
          <RouterLink to="/login" class="hover:text-white">Sign In</RouterLink>
          <RouterLink to="/register" class="hover:text-white"
            >Request Access</RouterLink
          >
        </div>
      </div>
    </footer>
  </div>
</template>
```}
