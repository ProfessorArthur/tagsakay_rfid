/**
 * Composable for standardized API state management
 * Provides consistent loading, error, and success state handling
 */
import { ref, computed } from "vue";

export function useApiState<T = any>(initialData: T | null = null) {
  const data = ref(initialData);
  const loading = ref(false);
  const error = ref<string | null>(null);
  const success = ref(false);
  const retryCount = ref(0);

  // Computed getters
  const isLoading = computed(() => loading.value);
  const hasError = computed(() => !!error.value);
  const hasData = computed(() => !!data.value);
  const isSuccess = computed(() => success.value && !error.value);

  // State setters
  const setLoading = (loadingState: boolean) => {
    loading.value = loadingState;
    if (loadingState) {
      error.value = null;
      success.value = false;
    }
  };

  const setData = (newData: T) => {
    data.value = newData;
    loading.value = false;
    error.value = null;
    success.value = true;
  };

  const setError = (errorValue: string | Error) => {
    error.value =
      typeof errorValue === "string" ? errorValue : errorValue.message;
    loading.value = false;
    success.value = false;
  };

  const reset = () => {
    data.value = initialData;
    loading.value = false;
    error.value = null;
    success.value = false;
    retryCount.value = 0;
  };

  const incrementRetry = () => {
    retryCount.value++;
  };

  // API operation wrapper with built-in error handling
  const execute = async <R = T>(
    operation: () => Promise<R>,
    options: {
      showError?: boolean;
      maxRetries?: number;
      retryDelay?: number;
    } = {}
  ): Promise<R | null> => {
    const { showError = true, maxRetries = 0, retryDelay = 1000 } = options;

    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        setLoading(true);

        if (attempt > 0) {
          // Add delay before retry
          await new Promise((resolve) => setTimeout(resolve, retryDelay));
          incrementRetry();
        }

        const result = await operation();
        setData(result as T);
        return result;
      } catch (error: any) {
        lastError = error;

        // Don't retry on authentication errors or client errors (4xx)
        if (
          error.response?.status === 401 ||
          error.response?.status === 403 ||
          (error.response?.status >= 400 && error.response?.status < 500)
        ) {
          break;
        }

        // Continue retrying for server errors (5xx) or network errors
        if (attempt === maxRetries) {
          break;
        }
      }
    }

    if (showError && lastError) {
      setError(lastError);
    }

    return null;
  };

  return {
    // Computed
    isLoading,
    hasError,
    hasData,
    isSuccess,

    // Actions
    setLoading,
    setData,
    setError,
    reset,
    execute,

    // Direct data access
    data,
    error,
    loading,
    success,
    retryCount,
  };
}

/**
 * Enhanced API state with pagination support
 */
export function usePaginatedApiState<T = any>() {
  const baseState = useApiState<T[]>([]);

  const pagination = ref({
    page: 1,
    pageSize: 10,
    total: 0,
    totalPages: 0,
  });

  const hasNextPage = computed(
    () => pagination.value.page < pagination.value.totalPages
  );
  const hasPrevPage = computed(() => pagination.value.page > 1);

  const setPagination = (page: number, pageSize: number, total: number) => {
    pagination.value = {
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
    };
  };

  const nextPage = () => {
    if (hasNextPage.value) {
      pagination.value.page++;
    }
  };

  const prevPage = () => {
    if (hasPrevPage.value) {
      pagination.value.page--;
    }
  };

  const goToPage = (page: number) => {
    const maxPage = pagination.value.totalPages || 1;
    pagination.value.page = Math.max(1, Math.min(page, maxPage));
  };

  return {
    ...baseState,
    pagination: pagination.value,
    hasNextPage,
    hasPrevPage,
    setPagination,
    nextPage,
    prevPage,
    goToPage,
  };
}
