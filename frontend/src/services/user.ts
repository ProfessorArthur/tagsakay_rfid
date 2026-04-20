import apiClient from "./api";
import type { ApiResponse } from "./api";

// User service interfaces
export interface UserCredentials {
  name?: string;
  email: string;
  password: string;
  role?: string;
  isActive?: boolean;
}

export interface UserUpdateData {
  name?: string;
  email?: string;
  password?: string;
  role?: string;
  isActive?: boolean;
}

export interface User {
  id: number;
  name: string;
  email: string;
  role: "driver" | "admin" | "superadmin";
  isActive: boolean;
  rfidTag?: string;
  rfids?: Array<{
    id: string;
    tagId: string;
    isActive: boolean;
    lastScanned?: string | null;
  }>;
  rfidTags?: Array<{
    id: string;
    tagId: string;
    isActive: boolean;
    lastScanned?: string | null;
  }>;
  createdAt: string;
  updatedAt: string;
}

export interface GetUsersOptions {
  forceRefresh?: boolean;
  includeRfids?: boolean;
}

/**
 * Client-side email validation (matches backend RFC 5321)
 */
const validateEmail = (email: string): { valid: boolean; error?: string } => {
  if (!email || email.length === 0) {
    return { valid: false, error: "Email is required" };
  }

  if (email.length > 320) {
    return { valid: false, error: "Email is too long" };
  }

  const emailRegex =
    /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;

  if (!emailRegex.test(email)) {
    return { valid: false, error: "Invalid email format" };
  }

  return { valid: true };
};

/**
 * Client-side name validation
 */
const validateName = (name: string): { valid: boolean; error?: string } => {
  if (!name || name.trim().length === 0) {
    return { valid: false, error: "Name is required" };
  }

  if (name.length < 2 || name.length > 100) {
    return { valid: false, error: "Name must be between 2 and 100 characters" };
  }

  return { valid: true };
};

// Client-side cache for users (separate buckets by includeRfids option)
const _usersCache = new Map<string, User[]>();
const _usersCacheAt = new Map<string, number>();
const USER_CACHE_TTL_MS = 1000 * 60 * 3; // 3 minutes default

// Get all users with optional cache
const getUsers = async (
  optionsOrForceRefresh: GetUsersOptions | boolean = {}
): Promise<User[]> => {
  const options: GetUsersOptions =
    typeof optionsOrForceRefresh === "boolean"
      ? { forceRefresh: optionsOrForceRefresh }
      : optionsOrForceRefresh;

  const includeRfids = options.includeRfids ?? true;
  const forceRefresh = options.forceRefresh ?? false;
  const cacheKey = includeRfids ? "with-rfids" : "without-rfids";

  // Return cached users if still fresh and not forced
  const now = Date.now();
  const cachedUsers = _usersCache.get(cacheKey);
  const cachedAt = _usersCacheAt.get(cacheKey) ?? 0;
  if (
    !forceRefresh &&
    cachedUsers &&
    now - cachedAt < USER_CACHE_TTL_MS
  ) {
    return cachedUsers;
  }

  try {
    const response = await apiClient.get("/users", {
      params: {
        includeRfids,
      },
    });
    const rawUsers = Array.isArray(response.data)
      ? response.data
      : Array.isArray(response?.data?.data)
      ? response.data.data
      : [];

    const normalized = rawUsers.map((user: User) => ({
      ...user,
      rfids: user.rfids ?? user.rfidTags ?? [],
      rfidTags: user.rfidTags ?? user.rfids ?? [],
    }));
    // Save to cache
    _usersCache.set(cacheKey, normalized);
    _usersCacheAt.set(cacheKey, Date.now());
    return normalized;
  } catch (error: any) {
    console.error("Failed to fetch users:", error);
    throw new Error(error.message || "Failed to fetch users");
  }
};

// Get a specific user
const getUser = async (id: number): Promise<User> => {
  try {
    const response = await apiClient.get(`/users/${id}`);
    const user = response.data as User;
    return {
      ...user,
      rfids: user.rfids ?? user.rfidTags ?? [],
      rfidTags: user.rfidTags ?? user.rfids ?? [],
    };
  } catch (error: any) {
    console.error(`Failed to fetch user ${id}:`, error);
    throw new Error(error.message || "Failed to fetch user");
  }
};

// Force-invalidate user cache
const invalidateUsersCache = () => {
  _usersCache.clear();
  _usersCacheAt.clear();
};

// Create a new user
const createUser = async (userData: UserCredentials): Promise<User> => {
  // Client-side validation
  if (userData.email) {
    const emailValidation = validateEmail(userData.email);
    if (!emailValidation.valid) {
      throw new Error(emailValidation.error);
    }
  }

  if (userData.name) {
    const nameValidation = validateName(userData.name);
    if (!nameValidation.valid) {
      throw new Error(nameValidation.error);
    }
  }

  try {
    const response = await apiClient.post("/users", userData);
    // Invalidate cache since new user created
    invalidateUsersCache();
    return response.data;
  } catch (error: any) {
    // Handle validation errors from backend
    if (error.response?.status === 400) {
      const apiResponse = error.response.data as ApiResponse;
      if (apiResponse.errors && apiResponse.errors.length > 0) {
        throw new Error(apiResponse.errors.join(", "));
      }
    }
    throw new Error(error.message || "Failed to create user");
  }
};

// Update a user
const updateUser = async (
  id: number,
  userData: UserUpdateData
): Promise<User> => {
  // Client-side validation
  if (userData.email) {
    const emailValidation = validateEmail(userData.email);
    if (!emailValidation.valid) {
      throw new Error(emailValidation.error);
    }
  }

  if (userData.name) {
    const nameValidation = validateName(userData.name);
    if (!nameValidation.valid) {
      throw new Error(nameValidation.error);
    }
  }

  try {
    const response = await apiClient.put(`/users/${id}`, userData);
    // Invalidate cache since user updated
    invalidateUsersCache();
    return response.data;
  } catch (error: any) {
    if (error.response?.status === 400) {
      const apiResponse = error.response.data as ApiResponse;
      if (apiResponse.errors && apiResponse.errors.length > 0) {
        throw new Error(apiResponse.errors.join(", "));
      }
    }
    throw new Error(error.message || "Failed to update user");
  }
};

// Delete a user
const deleteUser = async (id: number): Promise<void> => {
  try {
    await apiClient.delete(`/users/${id}`);
  } catch (error: any) {
    console.error(`Failed to delete user ${id}:`, error);
    throw new Error(error.message || "Failed to delete user");
  }
};

// Ensure cache is invalidated on delete
const deleteUserAndInvalidate = async (id: number) => {
  await deleteUser(id);
  invalidateUsersCache();
};

export default {
  getUsers,
  getUser,
  createUser,
  updateUser,
  deleteUser: deleteUserAndInvalidate,
  // Expose cache invalidation for consumers who need a forced refresh
  invalidateUsersCache,
  validateEmail,
  validateName,
};
