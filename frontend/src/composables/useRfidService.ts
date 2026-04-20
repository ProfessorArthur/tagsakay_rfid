/**
 * Enhanced RFID Service with improved error handling and loading states
 * Uses useApiState composable for consistent state management
 */
import { useApiState } from "../composables/useApiState";
import rfidService from "../services/rfid";
import type { Rfid, RfidScan, RegisterRfidData } from "../services/rfid";

export function useRfidService() {
  // Individual API states for different operations
  const rfidListState = useApiState<Rfid[]>([]);
  const unregisteredCardsState = useApiState<Rfid[]>([]);
  const registerState = useApiState<Rfid>();
  const updateState = useApiState<Rfid>();

  /**
   * Load all RFID cards with enhanced error handling
   */
  const loadRfidCards = async () => {
    return await rfidListState.execute(() => rfidService.getAllRfidCards(), {
      maxRetries: 2,
      retryDelay: 1000,
    });
  };

  /**
   * Load unregistered cards with retry logic
   */
  const loadUnregisteredCards = async () => {
    return await unregisteredCardsState.execute(
      () => rfidService.getUnregisteredCards(),
      { maxRetries: 2, retryDelay: 1000 }
    );
  };

  /**
   * Register RFID card with validation
   */
  const registerRfidCard = async (data: RegisterRfidData) => {
    // Client-side validation first
    const validation = rfidService.validateRfidTag(data.tagId);
    if (!validation.valid) {
      registerState.setError(validation.error || "Invalid RFID tag");
      return null;
    }

    return await registerState.execute(() => rfidService.registerRfid(data), {
      maxRetries: 1,
    });
  };

  /**
   * Update RFID card status
   */
  const updateRfidStatus = async (id: string, isActive: boolean) => {
    return await updateState.execute(
      () => rfidService.updateRfidStatus(id, isActive),
      { maxRetries: 1 }
    );
  };

  /**
   * Get RFID info with caching
   */
  const getRfidInfo = async (id: string) => {
    const singleRfidState = useApiState<Rfid>();

    return await singleRfidState.execute(() => rfidService.getRfidInfo(id), {
      maxRetries: 2,
    });
  };

  /**
   * Refresh all data
   */
  const refreshAll = async () => {
    await Promise.all([loadRfidCards(), loadUnregisteredCards()]);
  };

  /**
   * Reset all states
   */
  const resetAll = () => {
    rfidListState.reset();
    unregisteredCardsState.reset();
    registerState.reset();
    updateState.reset();
  };

  return {
    // State access
    rfidCards: rfidListState.data,
    rfidCardsLoading: rfidListState.loading,
    rfidCardsError: rfidListState.error,

    unregisteredCards: unregisteredCardsState.data,
    unregisteredCardsLoading: unregisteredCardsState.loading,
    unregisteredCardsError: unregisteredCardsState.error,

    registerLoading: registerState.loading,
    registerError: registerState.error,

    updateLoading: updateState.loading,
    updateError: updateState.error,

    // Actions
    loadRfidCards,
    loadUnregisteredCards,
    registerRfidCard,
    updateRfidStatus,
    getRfidInfo,
    refreshAll,
    resetAll,

    // Validation helper
    validateRfidTag: rfidService.validateRfidTag,
  };
}

export type { Rfid, RfidScan, RegisterRfidData };
