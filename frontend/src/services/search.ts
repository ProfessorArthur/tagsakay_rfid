import { ref } from "vue";

// Global search string shared across the top bar and pages
export const globalSearch = ref("");

export function clearGlobalSearch() {
  globalSearch.value = "";
}
