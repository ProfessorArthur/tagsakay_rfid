import { createRouter, createWebHistory } from "vue-router";
import type { RouteRecordRaw } from "vue-router";
import LandingPage from "../views/LandingPage.vue";

const isLoggedIn = (): boolean => !!localStorage.getItem("token");

const getStoredRole = (): string | null => {
  const userStr = localStorage.getItem("user");
  if (!userStr || userStr === "undefined" || userStr === "null") {
    return null;
  }

  try {
    const parsed = JSON.parse(userStr) as { role?: unknown };
    return typeof parsed.role === "string" ? parsed.role : null;
  } catch {
    localStorage.removeItem("user");
    return null;
  }
};

const isAdmin = (): boolean => {
  const role = getStoredRole();
  return role === "admin" || role === "superadmin";
};

// Import components with webpack chunk names for better caching
const Login = () => import(/* webpackChunkName: "auth" */ "../views/Login.vue");
const Register = () =>
  import(/* webpackChunkName: "auth" */ "../views/Register.vue");
const VerifyEmail = () =>
  import(/* webpackChunkName: "auth" */ "../views/VerifyEmail.vue");
const Dashboard = () =>
  import(/* webpackChunkName: "dashboard" */ "../views/Dashboard.vue");

const Profile = () =>
  import(/* webpackChunkName: "profile" */ "../views/Profile.vue");
const Settings = () =>
  import(/* webpackChunkName: "settings" */ "../views/Settings.vue");

const RfidCardManagement = () =>
  import(/* webpackChunkName: "rfid" */ "../views/RfidCardManagement.vue");
const RfidScans = () =>
  import(/* webpackChunkName: "rfid" */ "../views/RfidScans.vue");
const ApiKeyManagement = () =>
  import(/* webpackChunkName: "admin" */ "../views/ApiKeyManagement.vue");
const DeviceManagement = () =>
  import(/* webpackChunkName: "device" */ "../views/DeviceManagement.vue");
const DeviceRegistration = () =>
  import(/* webpackChunkName: "device" */ "../views/DeviceRegistration.vue");
const UserManagement = () =>
  import(/* webpackChunkName: "admin" */ "../views/UserManagement.vue");
const OnboardingWizard = () =>
  import(/* webpackChunkName: "admin" */ "../views/OnboardingWizard.vue");
const NotFound = () =>
  import(/* webpackChunkName: "error" */ "../views/NotFound.vue");

const routes: RouteRecordRaw[] = [
  {
    path: "/",
    name: "Landing",
    component: LandingPage,
    meta: { publicLanding: true },
  },
  {
    path: "/login",
    name: "Login",
    component: Login,
    meta: { requiresGuest: true },
  },
  {
    path: "/register",
    name: "Register",
    component: Register,
    meta: { requiresGuest: true },
  },
  {
    path: "/verify-email",
    name: "VerifyEmail",
    component: VerifyEmail,
    meta: { requiresGuest: true },
  },
  {
    path: "/dashboard",
    name: "Dashboard",
    component: Dashboard,
    meta: { requiresAuth: true },
  },
  {
    path: "/profile",
    name: "Profile",
    component: Profile,
    meta: { requiresAuth: true },
  },
  {
    path: "/settings",
    name: "Settings",
    component: Settings,
    meta: { requiresAuth: true },
  },
  {
    path: "/rfid",
    name: "RfidManagement",
    component: RfidCardManagement,
    meta: { requiresAuth: true, requiresAdmin: true },
  },
  {
    path: "/rfid/scans",
    name: "RfidScans",
    component: RfidScans,
    meta: { requiresAuth: true, requiresAdmin: true },
  },
  {
    path: "/users",
    name: "UserManagement",
    component: UserManagement,
    meta: { requiresAuth: true, requiresAdmin: true },
  },
  {
    path: "/apikeys",
    name: "ApiKeyManagement",
    component: ApiKeyManagement,
    meta: { requiresAuth: true, requiresAdmin: true },
  },
  {
    path: "/devices",
    name: "DeviceManagement",
    component: DeviceManagement,
    meta: { requiresAuth: true, requiresAdmin: true },
  },
  {
    path: "/devices/register",
    name: "DeviceRegistration",
    component: DeviceRegistration,
    meta: { requiresAuth: true, requiresAdmin: true },
  },
  {
    path: "/onboarding",
    name: "OnboardingWizard",
    component: OnboardingWizard,
    meta: { requiresAuth: true, requiresAdmin: true },
  },
  {
    path: "/:pathMatch(.*)*",
    name: "NotFound",
    component: NotFound,
  },
];

const router = createRouter({
  history: createWebHistory(),
  routes,
});

// Navigation guards
router.beforeEach((to, _, next) => {
  const loggedIn = isLoggedIn();
  const admin = isAdmin();

  if (to.meta.publicLanding && loggedIn) {
    return next("/dashboard");
  }

  // Check if route requires guest (not logged in)
  if (to.meta.requiresGuest && loggedIn) {
    return next("/dashboard");
  }

  // Check if route requires authentication
  if (to.meta.requiresAuth && !loggedIn) {
    return next("/login");
  }

  // Check if route requires admin role
  if (to.meta.requiresAdmin && !admin) {
    return next("/dashboard");
  }

  next();
});

export default router;
