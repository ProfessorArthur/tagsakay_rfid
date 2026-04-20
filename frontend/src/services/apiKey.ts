import apiClient from "./api";
import type { ApiResponse } from "./api";

interface ApiKey {
  id: string;
  name: string;
  deviceId: string;
  description: string | null;
  prefix: string;
  permissions: string[];
  lastUsed: string | null;
  isActive: boolean;
  createdBy: number;
  createdAt: string;
  updatedAt: string;
  macAddress?: string;
}

interface CreateApiKeyData {
  name: string;
  deviceId: string;
  macAddress?: string;
  description?: string;
  permissions?: string[];
}

interface ApiKeyResponse extends ApiKey {
  key: string; // Full key is only returned on creation
}

interface UpdateApiKeyData {
  name?: string;
  description?: string;
  permissions?: string[];
  isActive?: boolean;
}

/**
 * Validate API key name
 */
const validateApiKeyName = (
  name: string
): { valid: boolean; error?: string } => {
  if (!name || name.trim().length === 0) {
    return { valid: false, error: "API key name is required" };
  }

  if (name.length < 3 || name.length > 100) {
    return {
      valid: false,
      error: "API key name must be between 3 and 100 characters",
    };
  }

  return { valid: true };
};

/**
 * Validate device ID format
 */
const validateDeviceId = (
  deviceId: string
): { valid: boolean; error?: string } => {
  if (!deviceId || deviceId.trim().length === 0) {
    return { valid: false, error: "Device ID is required" };
  }

  // Device ID should be alphanumeric, typically MAC address without colons
  const deviceIdRegex = /^[a-zA-Z0-9-_]{6,50}$/;
  if (!deviceIdRegex.test(deviceId)) {
    return {
      valid: false,
      error: "Invalid device ID format (alphanumeric, 6-50 characters)",
    };
  }

  return { valid: true };
};

const apiKeyService = {
  /**
   * Create a new API key for a device
   * Note: The full API key is only returned once during creation
   */
  async createApiKey(
    data: CreateApiKeyData
  ): Promise<ApiResponse<ApiKeyResponse>> {
    // Client-side validation
    const nameValidation = validateApiKeyName(data.name);
    if (!nameValidation.valid) {
      throw new Error(nameValidation.error);
    }

    const deviceIdValidation = validateDeviceId(data.deviceId);
    if (!deviceIdValidation.valid) {
      throw new Error(deviceIdValidation.error);
    }

    try {
      const response = await apiClient.post("/keys", data);
      return response.data;
    } catch (error: any) {
      if (error.response?.status === 400) {
        const apiResponse = error.response.data as ApiResponse;
        if (apiResponse.errors && apiResponse.errors.length > 0) {
          throw new Error(apiResponse.errors.join(", "));
        }
      }
      throw new Error(error.message || "Failed to create API key");
    }
  },

  /**
   * List all API keys (without the full key value)
   */
  async listApiKeys(): Promise<ApiResponse<ApiKey[]>> {
    try {
      const response = await apiClient.get("/keys");
      return response.data || { success: false, data: [] };
    } catch (error: any) {
      console.error("Failed to fetch API keys:", error);
      return { success: false, data: [] };
    }
  },

  /**
   * Update an existing API key
   */
  async updateApiKey(id: string, data: UpdateApiKeyData): Promise<ApiKey> {
    // Client-side validation
    if (data.name) {
      const nameValidation = validateApiKeyName(data.name);
      if (!nameValidation.valid) {
        throw new Error(nameValidation.error);
      }
    }

    try {
      const response = await apiClient.put(`/keys/${id}`, data);
      return response.data;
    } catch (error: any) {
      if (error.response?.status === 400) {
        const apiResponse = error.response.data as ApiResponse;
        if (apiResponse.errors && apiResponse.errors.length > 0) {
          throw new Error(apiResponse.errors.join(", "));
        }
      }
      throw new Error(error.message || "Failed to update API key");
    }
  },

  /**
   * Delete an API key permanently
   */
  async deleteApiKey(id: string): Promise<void> {
    try {
      await apiClient.delete(`/keys/${id}`);
    } catch (error: any) {
      throw new Error(error.message || "Failed to delete API key");
    }
  },

  /**
   * Revoke an API key (alias for delete)
   * API keys are securely hashed using PBKDF2 in backend-workers
   */
  async revokeApiKey(id: string): Promise<void> {
    return this.deleteApiKey(id);
  },

  /**
   * Get API key by ID
   */
  async getApiKey(id: string): Promise<ApiKey> {
    try {
      const response = await apiClient.get(`/keys/${id}`);
      return response.data;
    } catch (error: any) {
      throw new Error(error.message || "Failed to fetch API key");
    }
  },

  // Export validation helpers
  validateApiKeyName,
  validateDeviceId,
};

export default apiKeyService;
export type { ApiKey, CreateApiKeyData, UpdateApiKeyData, ApiKeyResponse };
