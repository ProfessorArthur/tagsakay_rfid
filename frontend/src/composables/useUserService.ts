/**
 * Enhanced User Service with improved error handling and loading states
 * Uses useApiState composable for consistent state management
 */
import { useApiState } from "../composables/useApiState";
import userService from "../services/user";
import type { User, UserCredentials, UserUpdateData } from "../services/user";

export function useUserService() {
  // Individual API states for different operations
  const userListState = useApiState<User[]>([]);
  const createUserState = useApiState<User>();
  const updateUserState = useApiState<User>();
  const deleteUserState = useApiState<void>();
  const singleUserState = useApiState<User>();

  /**
   * Load all users with enhanced error handling
   */
  const loadUsers = async () => {
    return await userListState.execute(() => userService.getUsers(), {
      maxRetries: 2,
      retryDelay: 1000,
    });
  };

  /**
   * Load single user
   */
  const loadUser = async (id: number) => {
    return await singleUserState.execute(() => userService.getUser(id), {
      maxRetries: 2,
    });
  };

  /**
   * Create new user with validation
   */
  const createUser = async (userData: UserCredentials) => {
    // Client-side validation
    if (userData.email) {
      const emailValidation = userService.validateEmail(userData.email);
      if (!emailValidation.valid) {
        createUserState.setError(emailValidation.error || "Invalid email");
        return null;
      }
    }

    if (userData.name) {
      const nameValidation = userService.validateName(userData.name);
      if (!nameValidation.valid) {
        createUserState.setError(nameValidation.error || "Invalid name");
        return null;
      }
    }

    const result = await createUserState.execute(
      () => userService.createUser(userData),
      { maxRetries: 1 }
    );

    // Refresh user list after successful creation
    if (result) {
      await loadUsers();
    }

    return result;
  };

  /**
   * Update user with validation
   */
  const updateUser = async (id: number, userData: UserUpdateData) => {
    // Client-side validation
    if (userData.email) {
      const emailValidation = userService.validateEmail(userData.email);
      if (!emailValidation.valid) {
        updateUserState.setError(emailValidation.error || "Invalid email");
        return null;
      }
    }

    if (userData.name) {
      const nameValidation = userService.validateName(userData.name);
      if (!nameValidation.valid) {
        updateUserState.setError(nameValidation.error || "Invalid name");
        return null;
      }
    }

    const result = await updateUserState.execute(
      () => userService.updateUser(id, userData),
      { maxRetries: 1 }
    );

    // Refresh user list after successful update
    if (result) {
      await loadUsers();
    }

    return result;
  };

  /**
   * Delete user
   */
  const deleteUser = async (id: number) => {
    const result = await deleteUserState.execute(
      () => userService.deleteUser(id),
      { maxRetries: 1 }
    );

    // Refresh user list after successful deletion
    if (result !== null) {
      await loadUsers();
    }

    return result;
  };

  /**
   * Refresh user list
   */
  const refreshUsers = async () => {
    await loadUsers();
  };

  /**
   * Reset all states
   */
  const resetAll = () => {
    userListState.reset();
    createUserState.reset();
    updateUserState.reset();
    deleteUserState.reset();
    singleUserState.reset();
  };

  /**
   * Find user by email (from loaded list)
   */
  const findUserByEmail = (email: string): User | undefined => {
    return userListState.data.value?.find((user) => user.email === email);
  };

  /**
   * Filter users by role (from loaded list)
   */
  const getUsersByRole = (role: string): User[] => {
    return userListState.data.value?.filter((user) => user.role === role) || [];
  };

  /**
   * Get user statistics (from loaded list)
   */
  const getUserStats = () => {
    const users = userListState.data.value || [];
    return {
      total: users.length,
      active: users.filter((u) => u.isActive).length,
      inactive: users.filter((u) => !u.isActive).length,
      drivers: users.filter((u) => u.role === "driver").length,
      admins: users.filter((u) => u.role === "admin").length,
      superadmins: users.filter((u) => u.role === "superadmin").length,
    };
  };

  return {
    // State access
    users: userListState.data,
    usersLoading: userListState.loading,
    usersError: userListState.error,

    currentUser: singleUserState.data,
    currentUserLoading: singleUserState.loading,
    currentUserError: singleUserState.error,

    createLoading: createUserState.loading,
    createError: createUserState.error,

    updateLoading: updateUserState.loading,
    updateError: updateUserState.error,

    deleteLoading: deleteUserState.loading,
    deleteError: deleteUserState.error,

    // Actions
    loadUsers,
    loadUser,
    createUser,
    updateUser,
    deleteUser,
    refreshUsers,
    resetAll,

    // Utilities
    findUserByEmail,
    getUsersByRole,
    getUserStats,

    // Validation helpers
    validateEmail: userService.validateEmail,
    validateName: userService.validateName,
  };
}

export type { User, UserCredentials, UserUpdateData };
