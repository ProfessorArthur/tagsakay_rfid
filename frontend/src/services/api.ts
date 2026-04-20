import axios, { AxiosError } from "axios";
import { API_CONFIG } from "../config/env";

const API_URL = API_CONFIG.BASE_URL;
const isDevMode = import.meta.env.DEV;

// Response format from backend-workers
interface ApiResponse<T = any> {
  success: boolean;
  message?: string;
  data?: T;
  error?: string;
  errors?: string[];
  retryAfter?: string;
}

// Create axios instance with base URL
const apiClient = axios.create({
  baseURL: API_URL,
  headers: {
    "Content-Type": "application/json",
    Accept: "application/json",
  },
  timeout: API_CONFIG.TIMEOUT,
  decompress: true, // Enable automatic decompression
});

// Add request interceptor to include auth token
apiClient.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem("token");
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Add response interceptor to handle common errors and new response format
apiClient.interceptors.response.use(
  (response) => {
    // Debug logging for troubleshooting
    if (isDevMode) {
      console.log("API Response:", {
        url: response.config.url,
        status: response.status,
        contentType: response.headers["content-type"],
        dataType: typeof response.data,
        dataLength: response.data ? String(response.data).length : 0,
        dataPreview:
          typeof response.data === "string"
            ? response.data.substring(0, 100)
            : response.data,
      });
    }

    // Backend-workers uses { success, data, message } format
    // Transform to maintain backward compatibility
    if (response.data && typeof response.data === "object") {
      const apiResponse = response.data as ApiResponse;

      // If response has success field, handle new format
      if ("success" in apiResponse) {
        if (!apiResponse.success) {
          // API returned success: false, treat as error
          return Promise.reject({
            response: {
              status: response.status,
              data: apiResponse,
            },
            message: apiResponse.message || "Request failed",
          });
        }

        // For successful responses, return the data field if it exists
        // This maintains compatibility with existing code
        if (apiResponse.data !== undefined) {
          response.data = apiResponse.data;
        }
      }
    }

    return response;
  },
  (error: AxiosError<ApiResponse>) => {
    // Enhanced error logging
    if (isDevMode) {
      console.error("API Error:", {
        url: error.config?.url,
        method: error.config?.method,
        status: error.response?.status,
        statusText: error.response?.statusText,
        contentType: error.response?.headers?.["content-type"],
        responseType: typeof error.response?.data,
        responseLength: error.response?.data
          ? String(error.response?.data).length
          : 0,
        responsePreview: error.response?.data
          ? String(error.response?.data).substring(0, 200)
          : "No response data",
        message: error.message,
      });
    }

    const apiResponse = error.response?.data;

    // Handle 401 Unauthorized
    if (error.response?.status === 401) {
      localStorage.removeItem("token");
      localStorage.removeItem("user");
      window.location.href = "/login";
      return Promise.reject(error);
    }

    // Handle 429 Rate Limiting
    if (error.response?.status === 429) {
      const retryAfter = apiResponse?.retryAfter || "later";
      error.message = `Too many requests. Please try again ${retryAfter}.`;
    }

    // Handle 415 Unsupported Media Type
    if (error.response?.status === 415) {
      error.message = "Invalid content type. Please check your request format.";
    }

    // Handle validation errors (400 with errors array)
    if (error.response?.status === 400 && apiResponse?.errors) {
      error.message = apiResponse.errors.join(", ");
    }

    // Handle generic error message
    if (apiResponse?.message) {
      error.message = apiResponse.message;
    }

    return Promise.reject(error);
  }
);

export default apiClient;
export type { ApiResponse };
