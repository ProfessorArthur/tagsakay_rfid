import type { ApiResponse } from "./api";
import { API_CONFIG } from "../config/env";

const getApiClient = async () => {
  const module = await import("./api");
  return module.default;
};

interface LoginCredentials {
  email: string;
  password: string;
}

interface RegisterData {
  name: string;
  email: string;
  password: string;
  role?: string;
  rfidTag?: string;
}

interface User {
  id: number;
  name: string;
  email: string;
  role: string;
  isActive: boolean;
  rfidTag?: string;
  createdAt?: string;
  updatedAt?: string;
}

interface AuthResponse {
  token: string;
  user: User;
  expiresIn?: string;
}

interface PasswordStrengthResult {
  valid: boolean;
  score: number;
  feedback: string[];
}

const authService = {
  /**
   * Login with email and password
   * Handles rate limiting (5 attempts/min) and account lockout (5 failed attempts)
   */
  async login(credentials: LoginCredentials): Promise<AuthResponse> {
    console.log("Login attempt:", {
      email: credentials.email,
      apiUrl: API_CONFIG.BASE_URL,
    });

    try {
      const apiClient = await getApiClient();
      const response = await apiClient.post("/auth/login", credentials);
      console.log("Login response received:", {
        status: response.status,
        headers: response.headers,
        dataType: typeof response.data,
        dataKeys: response.data ? Object.keys(response.data) : "no data",
      });

      // Validate response structure
      if (!response.data) {
        throw new Error("Empty response from server");
      }

      const authData = response.data as AuthResponse;

      // Validate required fields
      if (!authData.token || !authData.user) {
        console.error("Invalid auth response structure:", authData);
        throw new Error("Invalid response format from server");
      }

      return authData;
    } catch (error: any) {
      // Enhanced error handling for rate limiting and account lockout
      if (error.response?.status === 429) {
        const data = error.response.data as ApiResponse;
        throw new Error(
          data.message || "Too many login attempts. Please try again later."
        );
      }

      if (error.response?.status === 403) {
        const data = error.response.data as ApiResponse;
        throw new Error(
          data.message || "Account is locked. Please try again later."
        );
      }

      // Log detailed error information for debugging
      console.error("Login error:", {
        status: error.response?.status,
        statusText: error.response?.statusText,
        data: error.response?.data,
        message: error.message,
      });

      // Generic error message for failed login (security best practice)
      throw new Error(error.message || "Invalid email or password");
    }
  },

  /**
   * Register new user with password strength validation
   */
  async register(userData: RegisterData): Promise<any> {
    try {
      const apiClient = await getApiClient();
      const response = await apiClient.post("/auth/register", userData);
      return response.data;
    } catch (error: any) {
      // Handle validation errors
      if (error.response?.status === 400) {
        const data = error.response.data as ApiResponse;
        if (data.errors && data.errors.length > 0) {
          throw new Error(data.errors.join(", "));
        }
      }

      throw new Error(error.message || "Registration failed");
    }
  },

  /**
   * Validate password strength (client-side check before submission)
   * Matches backend OWASP requirements
   */
  validatePasswordStrength(password: string): PasswordStrengthResult {
    const feedback: string[] = [];
    let score = 0;

    // Length check (require strong password minimum)
    if (password.length < 15) {
      feedback.push("Password must be at least 15 characters");
      return { valid: false, score: 0, feedback };
    }

    // Score increases for longer passwords
    if (password.length >= 15) score++;
    if (password.length >= 20) score++;

    // Complexity checks
    if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score++;
    if (/\d/.test(password)) score++;
    if (/[^a-zA-Z0-9]/.test(password)) score++;

    // Common patterns (weak passwords)
    const weakPatterns = [
      /^[0-9]+$/,
      /^[a-zA-Z]+$/,
      /password/i,
      /admin/i,
      /123456/,
      /qwerty/i,
    ];

    if (weakPatterns.some((pattern) => pattern.test(password))) {
      score = Math.max(0, score - 2);
      feedback.push("Avoid common patterns and words");
    }

    // Feedback based on score
    if (score === 0) {
      feedback.push("Very weak password");
    } else if (score === 1) {
      feedback.push("Weak password - add more variety");
    } else if (score === 2) {
      feedback.push("Fair password - consider adding symbols");
    } else if (score === 3) {
      feedback.push("Good password");
    } else if (score >= 4) {
      feedback.push("Strong password");
    }

    return {
      valid: password.length >= 15,
      score,
      feedback,
    };
  },

  /**
   * Verify email with 6-digit code
   * Called after user clicks verification link or enters code manually
   */
  async verifyEmail(email: string, code: string): Promise<AuthResponse> {
    try {
      const apiClient = await getApiClient();
      const response = await apiClient.post("/auth/verify-email", {
        email,
        code,
      });
      return response.data;
    } catch (error: any) {
      if (error.response?.status === 400) {
        const data = error.response.data as ApiResponse;
        throw new Error(data.message || "Invalid verification code");
      }

      if (error.response?.status === 404) {
        throw new Error("User not found");
      }

      throw new Error(error.message || "Verification failed");
    }
  },

  /**
   * Refresh JWT token (token expires in 4 hours)
   */
  async refreshToken(): Promise<AuthResponse> {
    const apiClient = await getApiClient();
    const response = await apiClient.post("/auth/refresh");
    return response.data;
  },

  /**
   * Logout and clear all session data
   */
  async logout(): Promise<void> {
    try {
      const apiClient = await getApiClient();
      // Call logout endpoint (will be used for token blacklisting)
      await apiClient.post("/auth/logout");
    } catch (error) {
      // Continue with local cleanup even if API call fails
      console.error("Logout API error:", error);
    } finally {
      this.clearSession();
    }
  },

  /**
   * Clear session data (local)
   */
  clearSession(): void {
    localStorage.removeItem("token");
    localStorage.removeItem("user");

    // Dispatch storage event to notify all components
    window.dispatchEvent(new Event("storage"));

    // Clear any session cookies
    document.cookie.split(";").forEach(function (c) {
      document.cookie = c
        .replace(/^ +/, "")
        .replace(/=.*/, "=;expires=" + new Date().toUTCString() + ";path=/");
    });
  },

  getUser(): User | null {
    const userStr = localStorage.getItem("user");
    if (!userStr || userStr === "undefined" || userStr === "null") {
      return null;
    }
    try {
      return JSON.parse(userStr);
    } catch (error) {
      console.error("Failed to parse user data from localStorage:", error);
      // Clear corrupted data
      localStorage.removeItem("user");
      return null;
    }
  },

  isLoggedIn(): boolean {
    return !!localStorage.getItem("token");
  },

  isAdmin(): boolean {
    const user = this.getUser();
    return user?.role === "admin" || user?.role === "superadmin";
  },

  isSuperAdmin(): boolean {
    const user = this.getUser();
    return user?.role === "superadmin";
  },

  saveUserData(data: AuthResponse): void {
    // Enhanced validation with detailed logging
    if (!data) {
      console.error(
        "Invalid auth data provided to saveUserData: data is null/undefined"
      );
      return;
    }

    if (typeof data !== "object") {
      console.error(
        "Invalid auth data provided to saveUserData: data is not an object",
        typeof data,
        data
      );
      return;
    }

    if (!data.token || typeof data.token !== "string") {
      console.error(
        "Invalid auth data provided to saveUserData: missing or invalid token",
        data
      );
      return;
    }

    if (!data.user || typeof data.user !== "object") {
      console.error(
        "Invalid auth data provided to saveUserData: missing or invalid user object",
        data
      );
      return;
    }

    try {
      // Validate that we can serialize the user data
      const userJson = JSON.stringify(data.user);
      JSON.parse(userJson); // Test that it's valid JSON

      localStorage.setItem("token", data.token);
      localStorage.setItem("user", userJson);

      // Store token expiration time (4 hours from now)
      const expiresAt = Date.now() + 4 * 60 * 60 * 1000;
      localStorage.setItem("tokenExpiresAt", expiresAt.toString());
    } catch (error) {
      console.error(
        "Failed to save user data - JSON serialization error:",
        error,
        data
      );
      // Clear any potentially corrupted data
      localStorage.removeItem("token");
      localStorage.removeItem("user");
      localStorage.removeItem("tokenExpiresAt");
    }
  },

  /**
   * Check if token is expired or will expire soon (within 5 minutes)
   */
  shouldRefreshToken(): boolean {
    const expiresAtStr = localStorage.getItem("tokenExpiresAt");
    if (!expiresAtStr) return true;

    const expiresAt = parseInt(expiresAtStr);
    const fiveMinutes = 5 * 60 * 1000;

    return Date.now() >= expiresAt - fiveMinutes;
  },
};

export default authService;
export type {
  User,
  LoginCredentials,
  RegisterData,
  AuthResponse,
  PasswordStrengthResult,
};
