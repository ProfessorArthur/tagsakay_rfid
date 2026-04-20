<script setup lang="ts">
import useToast from "../composables/useToast";
const { success: toastSuccess, error: toastError } = useToast();
import {
  ref,
  onMounted,
  onBeforeUnmount,
  computed,
  defineAsyncComponent,
} from "vue";
import authService from "../services/auth";
import userService from "../services/user";
import type { User } from "../services/auth";
import rfidStatsService, { type DashboardStats } from "../services/rfidStats";
import rfidService, { type RfidEventType } from "../services/rfid";
import { buildCsvBlob } from "../utils/csv.ts";
import { ChartComponents } from "../utils/chartConfig";
import type { ChartData, ChartOptions } from "chart.js";

const RfidChart = defineAsyncComponent(() =>
  import("../components/RfidChart.vue")
);
const RfidDeviceStatus = defineAsyncComponent(() =>
  import("../components/RfidDeviceStatus.vue")
);
const RfidQueueMatrix = defineAsyncComponent(() =>
  import("../components/RfidQueueMatrix.vue")
);

// Lazy load chart components using Vue's defineAsyncComponent (avoids async setup)
const Line = defineAsyncComponent(() =>
  ChartComponents.Line().then((m: any) => m?.default ?? m)
);

const Pie = defineAsyncComponent(() =>
  ChartComponents.Pie().then((m: any) => m?.default ?? m)
);

const Bar = defineAsyncComponent(() =>
  ChartComponents.Bar().then((m: any) => m?.default ?? m)
);

// Use Philippines time throughout PDFs and displayed timestamps
const TIME_ZONE = "Asia/Manila";

const pdfLoading = ref(false);
const pdfPreviewModal = ref(false);
const pdfBlobUrl = ref<string | null>(null);

const user = ref<User | null>(null);
const loading = ref(true);
const activePeriod = ref<"weekly" | "monthly">("weekly");
const isDriver = computed(() => user.value?.role === "driver");
const themeName = ref<"light" | "dark">("light");

const syncThemeName = () => {
  if (typeof document === "undefined") {
    return;
  }

  const current = document.documentElement.getAttribute("data-theme");
  themeName.value = current === "dark" ? "dark" : "light";
};

const handleThemeChange = () => {
  syncThemeName();
};

const axisTickColor = computed(() =>
  themeName.value === "dark"
    ? "rgba(203, 213, 225, 0.78)"
    : "rgba(17, 24, 39, 0.78)"
);

const axisGridColor = computed(() =>
  themeName.value === "dark"
    ? "rgba(203, 213, 225, 0.12)"
    : "rgba(15, 23, 42, 0.14)"
);

const userRoleColors = [
  "rgba(59, 130, 246, 1)",
  "rgba(96, 165, 250, 1)",
  "rgba(147, 195, 255, 1)",
];

// Driver-specific data
const driverScans = ref<any[]>([]);
const driverStats = ref({
  totalScans: 0,
  thisWeekScans: 0,
  thisMonthScans: 0,
  lastScanTime: null as string | null,
});

type ScanStatusFilter = "all" | "success" | "failed" | "unauthorized";

const statusFilterOptions: Array<{ label: string; value: ScanStatusFilter }> = [
  { label: "All", value: "all" },
  { label: "Successful", value: "success" },
  { label: "Failed", value: "failed" },
  { label: "Unauthorized", value: "unauthorized" },
];

const scanStatusFilter = ref<ScanStatusFilter>("all");
const filteredDriverScans = computed(() => {
  const activeFilter = scanStatusFilter.value;
  if (activeFilter === "all") {
    return driverScans.value;
  }
  return driverScans.value.filter((scan: any) => {
    const status = String(scan.status || "").toLowerCase();
    return status === activeFilter;
  });
});

const statusClassMap: Record<string, string> = {
  success: "border-success text-success",
  failed: "border-warning text-warning",
  unauthorized: "border-error text-error",
};

// Export filters for admin scan CSV
const today = new Date();
const defaultExportStart = new Date(today);
defaultExportStart.setUTCDate(defaultExportStart.getUTCDate() - 6);

const formatDateInput = (date: Date): string => {
  return date.toISOString().split("T")[0];
};

const exportStartDate = ref(formatDateInput(defaultExportStart));
const exportEndDate = ref(formatDateInput(today));
const exportEventFilter = ref<RfidEventType | "all">("all");
const exportStatusFilter = ref<ScanStatusFilter>("all");
const exportLimit = ref<number>(10000);
const columnOptions = ref([
  { key: "rfidTagId", label: "RFID Tag" },
  { key: "userName", label: "User Name" },
  { key: "userEmail", label: "User Email" },
  { key: "userRole", label: "User Role" },
  { key: "status", label: "Status" },
  { key: "eventType", label: "Event Type" },
  { key: "location", label: "Location" },
  { key: "unitNumber", label: "Unit Number" },
  { key: "deviceId", label: "Device ID" },
  { key: "deviceName", label: "Device Name" },
  { key: "scanTimeLocal", label: "Scan Time (Local)" },
  { key: "scanTimeUTC", label: "Scan Time (UTC)" },
]);
const selectedColumns = ref<string[]>(
  columnOptions.value.map((c) => c.key).filter((k) => k !== "deviceName")
);
const showColumnSelector = ref(false);
const selectAllColumns = () => {
  selectedColumns.value = columnOptions.value.map((c: any) => c.key);
};
const clearAllColumns = () => {
  selectedColumns.value = [];
};

const emptyDashboard: DashboardStats = {
  scans: {
    today: { total: 0, success: 0, failed: 0, unauthorized: 0 },
    yesterday: { total: 0 },
    rollingSevenDays: { total: 0, success: 0 },
    monthToDate: { total: 0, success: 0 },
    weeklyBuckets: [],
    monthlyBuckets: [],
  },
  cards: { total: 0, createdThisMonth: 0 },
  devices: {
    total: 0,
    active: 0,
    online: 0,
    registrationModeEnabled: 0,
  },
  users: {
    total: 0,
    createdThisMonth: 0,
    drivers: 0,
    admins: 0,
    superadmins: 0,
  },
};

const dashboardStats = ref<DashboardStats>(emptyDashboard);

const todayScans = computed(() => {
  if (isDriver.value) {
    return driverStats.value.totalScans;
  }
  return dashboardStats.value.scans.today.total;
});

const yesterdayScans = computed(
  () => dashboardStats.value.scans.yesterday.total
);
const scanDelta = computed(() => todayScans.value - yesterdayScans.value);
const scanDeltaClass = computed(() =>
  scanDelta.value >= 0 ? "text-success" : "text-error"
);
const scanDeltaLabel = computed(() => {
  const delta = scanDelta.value;
  if (delta === 0) {
    return "No change vs yesterday";
  }
  const direction = delta > 0 ? "higher" : "lower";
  return `${Math.abs(delta)} ${direction} than yesterday`;
});

const cardsTotal = computed(() => dashboardStats.value.cards.total);
const cardsCreatedThisMonth = computed(
  () => dashboardStats.value.cards.createdThisMonth
);

const activeDevices = computed(() => dashboardStats.value.devices.online);
const registrationModeDevices = computed(
  () => dashboardStats.value.devices.registrationModeEnabled
);

const totalUsers = computed(() => dashboardStats.value.users.total);
const usersCreatedThisMonth = computed(
  () => dashboardStats.value.users.createdThisMonth
);

const userStats = computed(() => dashboardStats.value.users);

const weeklyScanBuckets = computed(
  () => dashboardStats.value.scans.weeklyBuckets
);
const monthlyScanBuckets = computed(
  () => dashboardStats.value.scans.monthlyBuckets
);

// Chart Data
const formatDailyLabel = (isoDate: string) => {
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) {
    return isoDate;
  }
  return date.toLocaleDateString(undefined, {
    month: "short",
    day: "2-digit",
  });
};

const formatMonthLabel = (isoMonth: string) => {
  const [year, month] = isoMonth.split("-").map(Number);
  if (!year || !month) {
    return isoMonth;
  }
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString(undefined, {
    month: "short",
    year: "numeric",
  });
};

const dailyTripsData = computed<ChartData<"line">>(() => {
  const useMonthly = activePeriod.value === "monthly";

  // Defensive checks: ensure buckets are arrays before mapping
  const monthlyBuckets = Array.isArray(monthlyScanBuckets.value)
    ? monthlyScanBuckets.value
    : [];
  const weeklyBuckets = Array.isArray(weeklyScanBuckets.value)
    ? weeklyScanBuckets.value
    : [];

  const buckets = useMonthly
    ? monthlyBuckets.map((bucket) => ({
        label: formatMonthLabel(bucket.month),
        total: bucket.total,
      }))
    : weeklyBuckets.map((bucket) => ({
        label: formatDailyLabel(bucket.date),
        total: bucket.total,
      }));

  if (!buckets.length) {
    return {
      labels: useMonthly
        ? ["Apr", "May", "Jun", "Jul", "Aug", "Sep"]
        : ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
      datasets: [
        {
          label: useMonthly ? "Monthly Scans" : "Daily Scans",
          backgroundColor: "rgba(59, 130, 246, 0.2)",
          borderColor: "rgba(59, 130, 246, 1)",
          data: useMonthly
            ? [220, 380, 450, 410, 390, 480]
            : [145, 170, 165, 165, 185, 185, 180],
          tension: 0.4,
          fill: true,
        },
      ],
    };
  }

  return {
    labels: buckets.map((bucket) => bucket.label),
    datasets: [
      {
        label: useMonthly ? "Monthly Scans" : "Daily Scans",
        backgroundColor: "rgba(59, 130, 246, 0.2)",
        borderColor: "rgba(59, 130, 246, 1)",
        data: buckets.map((bucket) => bucket.total),
        tension: 0.4,
        fill: true,
      },
    ],
  };
});

const dailyTripsOptions = computed<ChartOptions<"line">>(() => ({
  responsive: true,
  maintainAspectRatio: false,
  scales: {
    y: {
      beginAtZero: true,
      grid: { color: axisGridColor.value },
      ticks: { color: axisTickColor.value },
    },
    x: {
      grid: { display: false },
      ticks: { color: axisTickColor.value },
    },
  },
  plugins: { legend: { display: false } },
}));

const userAccessData = computed<ChartData<"pie">>(() => ({
  labels: ["Drivers", "Admins", "Super Admins"],
  datasets: [
    {
      backgroundColor: userRoleColors,
      data: [
        userStats.value.drivers,
        userStats.value.admins,
        userStats.value.superadmins,
      ],
      borderWidth: 0,
    },
  ],
}));

const userAccessOptions = computed<ChartOptions<"pie">>(() => ({
  responsive: true,
  maintainAspectRatio: false,
  plugins: { legend: { display: false } },
}));

const historicalTripsData = computed<ChartData<"bar">>(() => {
  // Defensive check: ensure buckets is an array
  const buckets = Array.isArray(monthlyScanBuckets.value)
    ? monthlyScanBuckets.value
    : [];

  if (!buckets.length) {
    return {
      labels: ["Apr", "May", "Jun", "Jul", "Aug", "Sep"],
      datasets: [
        {
          label: "Scans",
          backgroundColor: "rgba(59, 130, 246, 0.8)",
          data: [220, 380, 450, 410, 390, 480],
          borderRadius: 4,
        },
      ],
    };
  }

  return {
    labels: buckets.map((bucket) => formatMonthLabel(bucket.month)),
    datasets: [
      {
        label: "Scans",
        backgroundColor: "rgba(59, 130, 246, 0.8)",
        data: buckets.map((bucket) => bucket.total),
        borderRadius: 4,
      },
    ],
  };
});

const historicalTripsOptions = computed<ChartOptions<"bar">>(() => ({
  responsive: true,
  maintainAspectRatio: false,
  scales: {
    y: { display: false, beginAtZero: true },
    x: { display: false },
  },
  plugins: { legend: { display: false } },
}));

// Methods
const loadStatistics = async () => {
  loading.value = true;
  try {
    if (isDriver.value) {
      // Driver view: Load only their own scan history
      const currentUser = authService.getUser();
      if (currentUser) {
        const endDate = new Date();
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - 30); // Last 30 days

        const history = await rfidService.getMyScanHistory({
          startDate: startDate.toISOString(),
          endDate: endDate.toISOString(),
          limit: 1000,
        });

        if (!history || !Array.isArray(history.scans)) {
          console.error("getMyScanHistory did not return valid data:", history);
          driverScans.value = [];
          driverStats.value.totalScans = 0;
          driverStats.value.thisWeekScans = 0;
          driverStats.value.thisMonthScans = 0;
          driverStats.value.lastScanTime = null;
          return;
        }

        driverScans.value = history.scans;
        driverStats.value.totalScans = driverScans.value.length;

        const weekAgo = new Date();
        weekAgo.setDate(weekAgo.getDate() - 7);
        driverStats.value.thisWeekScans = driverScans.value.filter(
          (scan: any) => new Date(scan.scanTime) > weekAgo
        ).length;

        const monthAgo = new Date();
        monthAgo.setDate(monthAgo.getDate() - 30);
        driverStats.value.thisMonthScans = driverScans.value.filter(
          (scan: any) => new Date(scan.scanTime) > monthAgo
        ).length;

        driverStats.value.lastScanTime =
          driverScans.value.length > 0 ? driverScans.value[0].scanTime : null;
      }
    } else {
      // Admin view: Load full dashboard stats
      const stats = await rfidStatsService.getDashboardStats();
      dashboardStats.value = stats;
    }
  } catch (error) {
    console.error("Failed to load statistics:", error);
    dashboardStats.value = emptyDashboard;
  } finally {
    loading.value = false;
  }
};
/* istanbul ignore next */
void selectAllColumns;
/* istanbul ignore next */
void clearAllColumns;

const downloadPdf = async () => {
  if (!user.value || !filteredDriverScans.value.length) return;

  pdfLoading.value = true;
  try {
    const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");

    const pdfDoc = await PDFDocument.create();
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    // Helper functions
    const addPage = (title: string) => {
      const page = pdfDoc.addPage();
      const { width, height } = page.getSize();
      const marginLeft = 40;
      const marginRight = 40;
      let y = height - 40;

      // Title
      page.drawText(title, {
        x: marginLeft,
        y,
        size: 16,
        font: boldFont,
        color: rgb(0, 0, 0),
      });
      y -= 20;

      // Subtitle with generation date (Philippine time)
      page.drawText(
        `Generated on ${new Date().toLocaleString(undefined, {
          timeZone: TIME_ZONE,
        })}`,
        {
          x: marginLeft,
          y,
          size: 10,
          font,
          color: rgb(0.4, 0.4, 0.4),
        }
      );
      y -= 30;

      return { page, width, height, marginLeft, marginRight, y };
    };

    // robust wrapText — breaks long single words if necessary
    const wrapText = (
      text: string,
      maxWidth: number,
      fontRef: any,
      fontSize: number
    ) => {
      const safe = (v?: unknown) => {
        if (v === undefined || v === null) return "—";
        const s = String(v).trim();
        return s.length ? s : "—";
      };
      const sanitized = safe(text);
      const words = sanitized.split(/\s+/);
      const lines: string[] = [];
      let current = "";

      words.forEach((word) => {
        const candidate = current ? `${current} ${word}` : word;
        if (fontRef.widthOfTextAtSize(candidate, fontSize) <= maxWidth) {
          current = candidate;
          return;
        }

        if (fontRef.widthOfTextAtSize(word, fontSize) > maxWidth) {
          if (current) {
            lines.push(current);
            current = "";
          }
          let piece = "";
          for (let i = 0; i < word.length; i++) {
            piece += word[i];
            if (fontRef.widthOfTextAtSize(piece, fontSize) > maxWidth) {
              const fit = piece.slice(0, -1) || piece;
              lines.push(fit);
              piece = piece.slice(-1);
            }
          }
          if (piece) lines.push(piece);
          return;
        }

        if (current) lines.push(current);
        current = word;
      });
      if (current) lines.push(current);
      return lines.length ? lines : ["—"];
    };

    const drawTable = (
      page: any,
      headers: string[],
      rows: string[][],
      startY: number,
      colWidths: number[],
      opts?: { headerFontSize?: number; cellFontSize?: number }
    ) => {
      const headerFontSize = opts?.headerFontSize ?? 10;
      const cellFontSize = opts?.cellFontSize ?? 9;
      const lineHeight = Math.max(12, Math.ceil(cellFontSize * 1.25));

      let { width, height } = page.getSize();
      const marginLeft = 40;
      const usableWidth = width - marginLeft - 40;
      let y = startY;

      const headerHeight = Math.max(headerFontSize + 12, lineHeight + 6);

      const drawHeader = () => {
        page.drawRectangle({
          x: marginLeft,
          y: y - headerHeight + 5,
          width: usableWidth,
          height: headerHeight,
          color: rgb(0.9, 0.9, 0.9),
        });
        let x = marginLeft + 5;
        for (let i = 0; i < headers.length; i++) {
          page.drawText(headers[i], {
            x: x + 2,
            y: y - 6,
            size: headerFontSize,
            font: boldFont,
            color: rgb(0, 0, 0),
          });
          x += colWidths[i];
        }
        y -= headerHeight;
      };

      drawHeader();

      for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
        const row = rows[rowIndex];

        const wrappedCells: string[][] = [];
        let maxLines = 1;
        for (let i = 0; i < row.length; i++) {
          const cellText = String(row[i] ?? "");
          const cellMaxWidth = Math.max(colWidths[i] - 8, 8);
          const lines = wrapText(cellText, cellMaxWidth, font, cellFontSize);
          wrappedCells.push(lines);
          maxLines = Math.max(maxLines, lines.length);
        }

        const thisRowHeight = maxLines * lineHeight + 8;

        if (y - thisRowHeight <= 60) {
          page = pdfDoc.addPage();
          ({ width, height } = page.getSize());
          y = height - 40;
          drawHeader();
        }

        const isEven = rowIndex % 2 === 0;
        if (isEven) {
          page.drawRectangle({
            x: marginLeft,
            y: y - thisRowHeight + 5,
            width: usableWidth,
            height: thisRowHeight,
            color: rgb(0.98, 0.98, 0.98),
          });
        }

        page.drawRectangle({
          x: marginLeft,
          y: y - thisRowHeight + 5,
          width: usableWidth,
          height: thisRowHeight,
          borderColor: rgb(0.8, 0.8, 0.8),
          borderWidth: 0.5,
        });

        let x = marginLeft + 5;
        for (let c = 0; c < wrappedCells.length; c++) {
          const lines = wrappedCells[c];
          for (let li = 0; li < lines.length; li++) {
            const textY = y - 4 - li * lineHeight;
            page.drawText(lines[li], {
              x: x + 2,
              y: textY,
              size: cellFontSize,
              font,
              color: rgb(0, 0, 0),
            });
          }
          x += colWidths[c];
        }

        y -= thisRowHeight;
      }

      return { page, y };
    };

    const drawBarChart = (
      page: any,
      data: { label: string; value: number }[],
      startY: number,
      title: string
    ) => {
      const { width } = page.getSize();
      const marginLeft = 40;
      const marginRight = 40;
      let y = startY;

      // Title
      page.drawText(title, {
        x: marginLeft,
        y,
        size: 10,
        font: boldFont,
        color: rgb(0, 0, 0),
      });
      y -= 20;

      // Check if we have valid data
      if (!data || data.length === 0) {
        page.drawText("No data available", {
          x: marginLeft,
          y: y - 20,
          size: 8,
          font,
          color: rgb(0.5, 0.5, 0.5),
        });
        return y - 50;
      }

      const chartWidth = width - marginLeft - marginRight;
      const chartHeight = 80; // Reduced from 120
      const maxValue = Math.max(...data.map((d) => d.value)) || 1; // Ensure maxValue is at least 1
      const barWidth = Math.max((chartWidth / data.length) * 0.8, 8); // Minimum bar width
      const spacing = Math.max((chartWidth / data.length) * 0.2, 2); // Minimum spacing
      const chartBottom = y - chartHeight;

      // Draw bars
      let x = marginLeft;
      for (const item of data) {
        const safeValue = Number.isFinite(item.value) ? Math.max(item.value, 0) : 0;
        const barHeight =
          safeValue > 0 ? Math.max((safeValue / maxValue) * chartHeight, 1) : 0;
        const barX = x + spacing / 2;
        const barY = chartBottom;

        // Ensure coordinates are valid numbers
        if (isNaN(barX) || isNaN(barY) || isNaN(barWidth) || isNaN(barHeight)) {
          console.warn("Invalid bar coordinates:", {
            barX,
            barY,
            barWidth,
            barHeight,
          });
          continue;
        }

        // Draw bar
        if (barHeight > 0) {
          page.drawRectangle({
            x: barX,
            y: barY,
            width: barWidth,
            height: barHeight,
            color: rgb(0.2, 0.6, 1),
          });
        }

        // Draw value on top of bar (smaller font)
        page.drawText(safeValue.toString(), {
          x: barX + barWidth / 2 - 3,
          y: barY + barHeight + 4,
          size: 6,
          font,
          color: rgb(0, 0, 0),
        });

        // Draw label below bar (smaller font)
        page.drawText(item.label, {
          x: barX + barWidth / 2 - 8,
          y: chartBottom - 10,
          size: 6,
          font,
          color: rgb(0, 0, 0),
        });

        x += barWidth + spacing;
      }

      return chartBottom - 24; // Reduced spacing
    };

    const drawPieChart = (
      page: any,
      data: { label: string; value: number; color: [number, number, number] }[],
      startY: number,
      title: string
    ) => {
      const marginLeft = 40;
      let y = startY;

      // Title
      page.drawText(title, {
        x: marginLeft,
        y,
        size: 10,
        font: boldFont,
        color: rgb(0, 0, 0),
      });
      y -= 20;

      const centerX = marginLeft + 80; // Moved left to make room for legend
      const centerY = y - 40; // Smaller chart
      const radius = 35; // Reduced from 50
      let startAngle = 0;
      const total = data.reduce((sum, d) => sum + d.value, 0);

      // Check if we have valid data
      if (total === 0) {
        page.drawText("No data available", {
          x: marginLeft,
          y: y - 20,
          size: 8,
          font,
          color: rgb(0.5, 0.5, 0.5),
        });
        return y - 80; // Reduced spacing
      }

      // Draw pie slices
      for (const item of data) {
        const percentage = item.value / total;
        const endAngle = startAngle + percentage * 2 * Math.PI;

        // Draw slice
        page.drawCircle({
          x: centerX,
          y: centerY,
          size: radius,
          color: rgb(item.color[0], item.color[1], item.color[2]),
          borderColor: rgb(1, 1, 1),
          borderWidth: 1,
          startAngle,
          endAngle,
        });

        // Draw legend (smaller)
        const legendX = marginLeft + 170; // Adjusted position
        const legendY = y - 70 + data.indexOf(item) * 15; // Tighter spacing

        page.drawRectangle({
          x: legendX,
          y: legendY - 3,
          width: 10,
          height: 8,
          color: rgb(item.color[0], item.color[1], item.color[2]),
        });

        page.drawText(`${item.label}: ${item.value}`, {
          x: legendX + 15,
          y: legendY,
          size: 7,
          font,
          color: rgb(0, 0, 0),
        });

        startAngle = endAngle;
      }

      return y - 80; // Reduced spacing
    };

    // Process data for charts
    const scans = filteredDriverScans.value;

    // Daily activity data (last 7 days)
    const dailyData = [];
    for (let i = 6; i >= 0; i--) {
      // use Asia/Manila local day buckets so counts reflect Philippine days
      const date = new Date();
      date.setDate(date.getDate() - i);
      const iso = date.toLocaleDateString("en-CA", { timeZone: TIME_ZONE });
      const count = scans.filter((scan) => {
        const scanIso = new Date(scan.scanTime).toLocaleDateString("en-CA", {
          timeZone: TIME_ZONE,
        });
        return scanIso === iso;
      }).length;
      dailyData.push({
        label: date.toLocaleDateString(undefined, {
          weekday: "short",
          timeZone: TIME_ZONE,
        }),
        value: count,
      });
    }

    // Status distribution data
    const statusCounts = {
      success: scans.filter((s) => s.status === "success").length,
      failed: scans.filter((s) => s.status === "failed").length,
      unauthorized: scans.filter((s) => s.status === "unauthorized").length,
    };

    const statusData: {
      label: string;
      value: number;
      color: [number, number, number];
    }[] = [
      {
        label: "Success",
        value: statusCounts.success,
        color: [0.2, 0.8, 0.2] as [number, number, number],
      },
      {
        label: "Failed",
        value: statusCounts.failed,
        color: [0.8, 0.2, 0.2] as [number, number, number],
      },
      {
        label: "Unauthorized",
        value: statusCounts.unauthorized,
        color: [0.8, 0.8, 0.2] as [number, number, number],
      },
    ].filter((d) => d.value > 0);

    // Create combined summary and charts page (matching admin)
    const { page: mainPage, y: mainY } = addPage(
      `Dashboard Report - ${user.value.name}`
    );
    let currentY = mainY;

    // System Overview
    mainPage.drawText("System Overview", {
      x: 40,
      y: currentY,
      size: 14,
      font: boldFont,
      color: rgb(0, 0, 0),
    });

    let statsY = currentY - 30;
    const systemStats = [
      `Total Scans (30 days): ${driverStats.value.totalScans}`,
      `This Week: ${driverStats.value.thisWeekScans}`,
      `This Month: ${driverStats.value.thisMonthScans}`,
      `Last Scan: ${
        driverStats.value.lastScanTime
          ? new Date(driverStats.value.lastScanTime).toLocaleString(undefined, {
              timeZone: TIME_ZONE,
            })
          : "N/A"
      }`,
    ];
    for (const stat of systemStats) {
      mainPage.drawText(stat, {
        x: 40,
        y: statsY,
        size: 11,
        font,
        color: rgb(0, 0, 0),
      });
      statsY -= 20;
    }
    currentY = statsY - 30;

    // Activity chart (bar)
    if (dailyData.length > 0 && dailyData.some((d) => d.value > 0)) {
      currentY = drawBarChart(
        mainPage,
        dailyData,
        currentY,
        "Daily Activity (Last 7 Days)"
      );
    } else {
      mainPage.drawText("Daily Activity (Last 7 Days)", {
        x: 40,
        y: currentY,
        size: 10,
        font: boldFont,
        color: rgb(0, 0, 0),
      });
      currentY -= 20;
      mainPage.drawText("No activity recorded for the selected period", {
        x: 40,
        y: currentY,
        size: 8,
        font,
        color: rgb(0.5, 0.5, 0.5),
      });
      currentY -= 50;
    }

    // Status distribution chart (pie)
    if (statusData.length > 0) {
      currentY = drawPieChart(
        mainPage,
        statusData,
        currentY,
        "Scan Status Distribution"
      );
    }

    // Draw the summary table on the same page when possible so we don't
    // waste an extra page. If there's insufficient space we fall back.
    const tableHeaders = ["Metric", "Value", "Status"];
    const tableColWidths = [120, 80, 100];
    const tableData = [
      [
        "Total Scans (30 days)",
        driverStats.value.totalScans.toString(),
        driverStats.value.totalScans > 0 ? "Active" : "No Activity",
      ],
      [
        "This Week",
        driverStats.value.thisWeekScans.toString(),
        driverStats.value.thisWeekScans > 0 ? "Active" : "No Activity",
      ],
      [
        "This Month",
        driverStats.value.thisMonthScans.toString(),
        driverStats.value.thisMonthScans > 0 ? "Active" : "No Activity",
      ],
      [
        "Last Scan",
        driverStats.value.lastScanTime
          ? new Date(driverStats.value.lastScanTime).toLocaleString(undefined, {
              timeZone: TIME_ZONE,
            })
          : "N/A",
        driverStats.value.lastScanTime ? "Recent" : "None",
      ],
    ];
    // prefer to put the table on main summary page if space allows
    let summaryTableResult = drawTable(
      mainPage,
      tableHeaders,
      tableData,
      currentY - 20,
      tableColWidths
    );
    // adopt final page in case drawTable internally paged
    let finalMainPage = summaryTableResult.page;
    let finalY = summaryTableResult.y;
    if (finalY <= 100) {
      // not enough space — create a dedicated summary table page
      const { page: fallbackPage } = addPage(
        `System Summary Table - ${user.value.name}`
      );
      const fallbackResult = drawTable(
        fallbackPage,
        tableHeaders,
        tableData,
        720,
        tableColWidths
      );
      finalMainPage = fallbackResult.page;
      finalY = fallbackResult.y;
    }
    // update currentY to the resulting position for placing the next section
    currentY = finalY;

    // Detailed scan history table (original)
    // Try to place the detailed scan history under the summary table if there's
    // room; otherwise create a new page.
    const headers = ["RFID Tag", "Status", "Location", "Unit", "Timestamp"];
    // Rebalanced widths — give Unit more room and keep totals within usable width
    const colWidths = [100, 70, 120, 80, 80];
    const tableRows = scans.slice(0, 100).map((scan) => [
      scan.rfidTagId || "N/A",
      scan.status || "Unknown",
      scan.location || "Unknown",
      scan.unitNumber?.toString() || "N/A",
      scan.scanTime
        ? new Date(scan.scanTime).toLocaleString(undefined, {
            timeZone: TIME_ZONE,
          })
        : "N/A",
    ]);

    // Decide whether to place history on the current main/summary page
    const minSpaceForHistory = 140;
    let scanHistoryPage = finalMainPage;
    let scanStartY = currentY - 40;
    if (scanStartY <= minSpaceForHistory) {
      const scanPage = addPage(`Detailed Scan History - ${user.value.name}`);
      scanHistoryPage = scanPage.page;
      scanStartY = scanPage.y;
    } else {
      // draw the title on the same page
      scanHistoryPage.drawText(`Detailed Scan History - ${user.value.name}`, {
        x: 40,
        y: scanStartY + 20,
        size: 14,
        font: boldFont,
        color: rgb(0, 0, 0),
      });
      scanStartY -= 20;
    }

    const historyResult = drawTable(
      scanHistoryPage,
      headers,
      tableRows,
      scanStartY,
      colWidths
    );
    scanHistoryPage = historyResult.page;

    // If more than 100 scans, add additional pages
    if (scans.length > 100) {
      const remainingScans = scans.slice(100);
      for (let i = 0; i < remainingScans.length; i += 100) {
        const { page: additionalPage } = addPage(
          `Scan History (Cont.) - ${user.value.name}`
        );
        const additionalRows = remainingScans.slice(i, i + 100).map((scan) => [
          scan.rfidTagId || "N/A",
          scan.status || "Unknown",
          scan.location || "Unknown",
          scan.unitNumber?.toString() || "N/A",
          scan.scanTime
            ? new Date(scan.scanTime).toLocaleString(undefined, {
                timeZone: TIME_ZONE,
              })
            : "N/A",
        ]);
        drawTable(additionalPage, headers, additionalRows, 720, colWidths);
        // adopt final page in case drawTable paged
        // (not used further, but keep consistent)
      }
    }

    const pdfBytes = await pdfDoc.save();

    // Create blob URL for preview
    const blob = new Blob([pdfBytes as any], { type: "application/pdf" });
    pdfBlobUrl.value = URL.createObjectURL(blob);
    pdfPreviewModal.value = true;
    toastSuccess("PDF generated (preview available)");
  } catch (error) {
    console.error("Failed to generate PDF:", error);
    toastError(
      "Failed to generate PDF: " +
        String((error as any)?.message ?? error ?? "Unknown error")
    );
  } finally {
    pdfLoading.value = false;
  }
};

const downloadPdfFromPreview = () => {
  if (!pdfBlobUrl.value || !user.value) return;

  const link = document.createElement("a");
  link.href = pdfBlobUrl.value;
  const roleSuffix = user.value.role === "driver" ? "driver" : "admin";
  link.download = `dashboard-report-${roleSuffix}-${(
    user.value.name || user.value.role
  ).replace(/\s+/g, "-")}-${new Date().toISOString().split("T")[0]}.pdf`;
  document.body.appendChild(link);
  link.click();
  toastSuccess("PDF downloaded");
  document.body.removeChild(link);

  // Close modal
  pdfPreviewModal.value = false;
  pdfBlobUrl.value = null;
};

const downloadCsv = () => {
  if (!user.value || !filteredDriverScans.value.length) return;

  const generationDate = new Date().toLocaleString(undefined, {
    timeZone: TIME_ZONE,
  });
  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - 30);

  const metadata = [
    ["Report Type", "Driver Scan History"],
    ["Generated By", `${user.value.name} (${user.value.role})`],
    ["Generated Date", generationDate],
    [
      "Date Range",
      `${startDate.toLocaleDateString()} - ${endDate.toLocaleDateString()}`,
    ],
    [
      "Filter Applied",
      scanStatusFilter.value === "all"
        ? "None"
        : scanStatusFilter.value.charAt(0).toUpperCase() +
          scanStatusFilter.value.slice(1),
    ],
    ["Total Records", filteredDriverScans.value.length.toString()],
    ["", ""], // Empty row for separation
  ];

  const headers = ["RFID Tag", "Status", "Location", "Unit", "Timestamp"];

  const rows = filteredDriverScans.value.map((scan) => [
    scan.rfidTagId || "N/A",
    scan.status || "Unknown",
    scan.location || "Unknown",
    scan.unitNumber?.toString() || "N/A",
    scan.scanTime
      ? new Date(scan.scanTime).toLocaleString(undefined, {
          timeZone: TIME_ZONE,
        })
      : "N/A",
  ]);

  const blob = buildCsvBlob([...metadata, headers, ...rows]);

  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);
  link.href = url;
  const roleSuffix = user.value.role === "driver" ? "driver" : "admin";
  link.download = `scan-history-${roleSuffix}-${(
    user.value.name || user.value.role
  ).replace(/\s+/g, "-")}-${new Date().toISOString().split("T")[0]}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  try {
    URL.revokeObjectURL(url);
  } catch (_) {
    // no-op
  }
  toastSuccess("Dashboard CSV downloaded");
};

const downloadCsvAdmin = () => {
  if (!user.value) return;

  const generationDate = new Date().toLocaleString(undefined, {
    timeZone: TIME_ZONE,
  });

  const metadata = [
    ["Report Type", "Dashboard Statistics Summary"],
    ["Generated By", `${user.value.name} (${user.value.role})`],
    ["Generated Date", generationDate],
    [
      "Data Period",
      activePeriod.value === "weekly" ? "Last 7 Days" : "Last 30 Days",
    ],
    [
      "Chart Period",
      activePeriod.value === "weekly" ? "Weekly View" : "Monthly View",
    ],
    ["", ""], // Empty row for separation
  ];

  const headers = ["Metric", "Value", "Status"];

  const rows = [
    [
      "Today's Scans",
      todayScans.value.toString(),
      todayScans.value > 0 ? "Active" : "No Activity",
    ],
    [
      "Total Registered Cards",
      cardsTotal.value.toString(),
      cardsTotal.value > 0 ? "Good" : "None",
    ],
    [
      "Active Devices",
      activeDevices.value.toString(),
      activeDevices.value > 0 ? "Online" : "Offline",
    ],
    [
      "Total Users",
      totalUsers.value.toString(),
      totalUsers.value > 0 ? "Active" : "Empty",
    ],
    [
      "Cards This Month",
      cardsCreatedThisMonth.value.toString(),
      cardsCreatedThisMonth.value > 0 ? "Growing" : "Static",
    ],
    [
      "Users This Month",
      usersCreatedThisMonth.value.toString(),
      usersCreatedThisMonth.value > 0 ? "Growing" : "Static",
    ],
    [
      "Registration Mode Devices",
      registrationModeDevices.value.toString(),
      registrationModeDevices.value > 0 ? "Setup" : "Normal",
    ],
  ];

  const blob = buildCsvBlob([...metadata, headers, ...rows]);

  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);
  link.href = url;
  const roleSuffix = user.value.role === "driver" ? "driver" : "admin";
  link.download = `dashboard-stats-${roleSuffix}-${(
    user.value.name || user.value.role
  ).replace(/\s+/g, "-")}-${new Date().toISOString().split("T")[0]}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  try {
    URL.revokeObjectURL(url);
  } catch (_) {
    // no-op
  }
  toastSuccess("RFID scans CSV downloaded");
};

const downloadCsvScans = async () => {
  if (!user.value) return;

  try {
    // Use UI-provided date range & filters
    const startDate = new Date(exportStartDate.value);
    const endDate = new Date(exportEndDate.value);
    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) {
      throw new Error("Invalid export date range");
    }
    if (startDate > endDate) {
      throw new Error("Export start date cannot be later than end date");
    }
    const scansResp = await rfidService.getScanHistory({
      startDate: startDate.toISOString(),
      endDate: new Date(
        endDate.getFullYear(),
        endDate.getMonth(),
        endDate.getDate(),
        23,
        59,
        59
      ).toISOString(),
      limit: exportLimit.value,
      eventType: exportEventFilter.value,
    });
    // Filter by status client-side if needed
    let fetchedScans = scansResp.scans;
    if (exportStatusFilter.value !== "all") {
      fetchedScans = fetchedScans.filter(
        (s) => String(s.status).toLowerCase() === exportStatusFilter.value
      );
    }

    const generationDate = new Date().toLocaleString(undefined, {
      timeZone: TIME_ZONE,
    });

    // Build a user email lookup map by fetching all users (frontend cache)
    let userEmailById: Record<number, string | undefined> = {};
    try {
      const userList = await userService.getUsers({ includeRfids: false });
      if (Array.isArray(userList)) {
        userList.forEach((u: any) => {
          if (typeof u.id === "number") userEmailById[u.id] = u.email;
        });
      }
    } catch (err) {
      // If user lookup fails, we still proceed silently; CSV emails will fallback
      console.warn("Failed to fetch users for email enrichment:", err);
    }

    const metadata = [
      ["Report Type", "Complete RFID Scan History"],
      ["Generated By", `${user.value.name} (${user.value.role})`],
      ["Generated Date", generationDate],
      [
        "Date Range",
        `${startDate.toLocaleDateString()} - ${endDate.toLocaleDateString()}`,
      ],
      [
        "Event Filter",
        exportEventFilter.value === "all"
          ? "All Events"
          : exportEventFilter.value,
      ],
      [
        "Status Filter",
        exportStatusFilter.value === "all"
          ? "All Status"
          : exportStatusFilter.value,
      ],
      ["Limit", exportLimit.value.toString()],
      [
        "Columns Included",
        (selectedColumns.value || []).length
          ? selectedColumns.value.join(", ")
          : columnOptions.value.map((c: any) => c.label).join(", "),
      ],
      ["Total Records", scansResp.total.toString()],
      ["", ""], // Empty row for separation
    ];

    // headers are built dynamically from selectedColumns

    // Build CSV headers and columns (don't mutate reactive selectedColumns)
    const columns =
      selectedColumns.value && selectedColumns.value.length
        ? [...selectedColumns.value]
        : columnOptions.value.map((c: any) => c.key);

    const headers = columns.map((key) => {
      const option = columnOptions.value.find((c) => c.key === key);
      return option ? option.label : key;
    });

    const rows = fetchedScans.map((scan: any) => {
      return columns.map((key) => {
        switch (key) {
          case "rfidTagId":
            return scan.rfidTagId || "N/A";
          case "userName":
            return scan.user?.name || "Unknown";
          case "userEmail": {
            const maybeEmail =
              scan.user?.email ||
              (typeof scan.user?.id === "number" &&
                userEmailById[scan.user.id]) ||
              (typeof scan.userId === "number" && userEmailById[scan.userId]);
            return maybeEmail || "Unknown";
          }
          case "userRole":
            return scan.user?.role || "Unknown";
          case "status":
            return scan.status || "Unknown";
          case "eventType":
            return scan.eventType || "scan";
          case "location":
            return scan.location || "Unknown";
          case "unitNumber":
            return scan.unitNumber?.toString() || "N/A";
          case "deviceId":
            return scan.deviceId || "Unknown";
          case "deviceName":
            // Device name isn't available from scan; leave blank or keep "Unknown"
            return scan.deviceName || "Unknown";
          case "scanTimeLocal":
            return scan.scanTime
              ? new Date(scan.scanTime).toLocaleString(undefined, {
                  timeZone: TIME_ZONE,
                })
              : "N/A";
          case "scanTimeUTC":
            return scan.scanTime || "N/A";
          default:
            return String(scan[key] ?? "");
        }
      });
    });

    const blob = buildCsvBlob([...metadata, headers, ...rows]);

    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.href = url;
    link.download = `rfid-scans-complete-${user.value.role}-${
      new Date().toISOString().split("T")[0]
    }.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    try {
      URL.revokeObjectURL(url);
    } catch (_) {
      // no-op
    }
  } catch (error) {
    console.error("Failed to download RFID scans CSV:", error);
    toastError &&
      toastError(
        "Failed to generate CSV: " + ((error as any)?.message || "Unknown")
      );
  }
};

const downloadAdminPdf = async () => {
  if (!user.value) return;

  pdfLoading.value = true;
  try {
    const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");

    const pdfDoc = await PDFDocument.create();
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    // Helper functions
    const addPage = (title: string) => {
      const page = pdfDoc.addPage();
      const { width, height } = page.getSize();
      const marginLeft = 40;
      const marginRight = 40;
      let y = height - 40;

      // Title
      page.drawText(title, {
        x: marginLeft,
        y,
        size: 16,
        font: boldFont,
        color: rgb(0, 0, 0),
      });
      y -= 20;

      // Subtitle with generation date (Philippine time)
      page.drawText(
        `Generated on ${new Date().toLocaleString(undefined, {
          timeZone: TIME_ZONE,
        })}`,
        {
          x: marginLeft,
          y,
          size: 10,
          font,
          color: rgb(0.4, 0.4, 0.4),
        }
      );
      y -= 30;

      return { page, width, height, marginLeft, marginRight, y };
    };

    const drawBarChart = (
      page: any,
      data: { label: string; value: number }[],
      startY: number,
      title: string
    ) => {
      const { width } = page.getSize();
      const marginLeft = 40;
      let y = startY;

      // Title
      page.drawText(title, {
        x: marginLeft,
        y,
        size: 10,
        font: boldFont,
        color: rgb(0, 0, 0),
      });
      y -= 20;

      // Check if we have valid data
      if (!data || data.length === 0) {
        page.drawText("No data available", {
          x: marginLeft,
          y: y - 20,
          size: 8,
          font,
          color: rgb(0.5, 0.5, 0.5),
        });
        return y - 50;
      }

      const chartWidth = width - marginLeft - 40;
      const chartHeight = 80;
      const maxValue = Math.max(...data.map((d) => d.value)) || 1;
      const barWidth = Math.max((chartWidth / data.length) * 0.8, 8);
      const spacing = Math.max((chartWidth / data.length) * 0.2, 2);
      const chartBottom = y - chartHeight;

      // Draw bars
      let x = marginLeft;
      for (const item of data) {
        const safeValue = Number.isFinite(item.value) ? Math.max(item.value, 0) : 0;
        const barHeight =
          safeValue > 0 ? Math.max((safeValue / maxValue) * chartHeight, 1) : 0;
        const barX = x + spacing / 2;
        const barY = chartBottom;

        // Ensure coordinates are valid numbers
        if (isNaN(barX) || isNaN(barY) || isNaN(barWidth) || isNaN(barHeight)) {
          console.warn("Invalid bar coordinates:", {
            barX,
            barY,
            barWidth,
            barHeight,
          });
          continue;
        }

        // Draw bar
        if (barHeight > 0) {
          page.drawRectangle({
            x: barX,
            y: barY,
            width: barWidth,
            height: barHeight,
            color: rgb(0.2, 0.6, 1),
          });
        }

        // Draw value on top of bar
        page.drawText(safeValue.toString(), {
          x: barX + barWidth / 2 - 3,
          y: barY + barHeight + 4,
          size: 6,
          font,
          color: rgb(0, 0, 0),
        });

        // Draw label below bar
        page.drawText(item.label, {
          x: barX + barWidth / 2 - 8,
          y: chartBottom - 10,
          size: 6,
          font,
          color: rgb(0, 0, 0),
        });

        x += barWidth + spacing;
      }

      return chartBottom - 24;
    };

    const drawTable = (
      page: any,
      headers: string[],
      rows: string[][],
      startY: number,
      colWidths: number[]
    ) => {
      const { width } = page.getSize();
      const marginLeft = 40;
      let y = startY;
      const rowHeight = 20;
      const headerHeight = 25;

      // Draw header background
      page.drawRectangle({
        x: marginLeft,
        y: y - headerHeight + 5,
        width: width - marginLeft - 40,
        height: headerHeight,
        color: rgb(0.9, 0.9, 0.9),
      });

      // Draw headers
      let x = marginLeft + 5;
      for (let i = 0; i < headers.length; i++) {
        page.drawText(headers[i], {
          x: x + 2,
          y: y - 5,
          size: 10,
          font: boldFont,
          color: rgb(0, 0, 0),
        });
        x += colWidths[i];
      }
      y -= headerHeight;

      // Draw rows
      for (const row of rows) {
        if (y < 60) {
          // New page needed
          return y;
        }

        // Alternate row background
        const isEvenRow = rows.indexOf(row) % 2 === 0;
        if (isEvenRow) {
          page.drawRectangle({
            x: marginLeft,
            y: y - rowHeight + 5,
            width: width - marginLeft - 40,
            height: rowHeight,
            color: rgb(0.98, 0.98, 0.98),
          });
        }

        // Draw borders
        page.drawRectangle({
          x: marginLeft,
          y: y - rowHeight + 5,
          width: width - marginLeft - 40,
          height: rowHeight,
          borderColor: rgb(0.8, 0.8, 0.8),
          borderWidth: 0.5,
        });

        x = marginLeft + 5;
        for (let i = 0; i < row.length; i++) {
          const text = String(row[i] || "");
          // Don't truncate for status column (last column)
          const isStatusColumn = i === row.length - 1;
          const truncatedText = isStatusColumn
            ? text
            : text.length > 15
            ? text.substring(0, 12) + "..."
            : text;

          page.drawText(truncatedText, {
            x: x + 2,
            y: y - 3,
            size: 9,
            font,
            color: rgb(0, 0, 0),
          });
          x += colWidths[i];
        }
        y -= rowHeight;
      }

      return y;
    };

    const drawPieChart = (
      page: any,
      data: { label: string; value: number; color: [number, number, number] }[],
      startY: number,
      title: string
    ) => {
      const marginLeft = 40;
      let y = startY;

      // Title
      page.drawText(title, {
        x: marginLeft,
        y,
        size: 10,
        font: boldFont,
        color: rgb(0, 0, 0),
      });
      y -= 20;

      const centerX = marginLeft + 80; // Moved left to make room for legend
      const centerY = y - 40; // Smaller chart
      const radius = 35; // Reduced from 50
      let startAngle = 0;
      const total = data.reduce((sum, d) => sum + d.value, 0);

      // Check if we have valid data
      if (total === 0) {
        page.drawText("No data available", {
          x: marginLeft,
          y: y - 20,
          size: 8,
          font,
          color: rgb(0.5, 0.5, 0.5),
        });
        return y - 80; // Reduced spacing
      }

      // Draw pie slices
      for (const item of data) {
        const percentage = item.value / total;
        const endAngle = startAngle + percentage * 2 * Math.PI;

        // Draw slice
        page.drawCircle({
          x: centerX,
          y: centerY,
          size: radius,
          color: rgb(item.color[0], item.color[1], item.color[2]),
          borderColor: rgb(1, 1, 1),
          borderWidth: 1,
          startAngle,
          endAngle,
        });

        // Draw legend (smaller)
        const legendX = marginLeft + 170; // Adjusted position
        const legendY = y - 70 + data.indexOf(item) * 15; // Tighter spacing

        page.drawRectangle({
          x: legendX,
          y: legendY - 3,
          width: 10,
          height: 8,
          color: rgb(item.color[0], item.color[1], item.color[2]),
        });

        page.drawText(`${item.label}: ${item.value}`, {
          x: legendX + 15,
          y: legendY,
          size: 7,
          font,
          color: rgb(0, 0, 0),
        });

        startAngle = endAngle;
      }

      return y - 80; // Reduced spacing
    };

    // Process admin data for charts
    const useMonthly = activePeriod.value === "monthly";
    const buckets = useMonthly
      ? Array.isArray(monthlyScanBuckets.value)
        ? monthlyScanBuckets.value
        : []
      : Array.isArray(weeklyScanBuckets.value)
      ? weeklyScanBuckets.value
      : [];

    const activityData =
      buckets.length > 0
        ? buckets.map((bucket) => ({
            label: useMonthly
              ? formatMonthLabel((bucket as any).month)
              : formatDailyLabel((bucket as any).date),
            value: bucket.total,
          }))
        : [];

    // User role distribution data
    const userRoleData: {
      label: string;
      value: number;
      color: [number, number, number];
    }[] = [
      {
        label: "Drivers",
        value: userStats.value.drivers,
        color: [0.2, 0.6, 1] as [number, number, number],
      },
      {
        label: "Admins",
        value: userStats.value.admins,
        color: [0.6, 0.2, 1] as [number, number, number],
      },
      {
        label: "Super Admins",
        value: userStats.value.superadmins,
        color: [1, 0.6, 0.2] as [number, number, number],
      },
    ].filter((d) => d.value > 0);

    // Create summary page
    const { page: summaryPage, y: summaryY } = addPage(
      `Dashboard Report - ${user.value.name}`
    );

    let currentY = summaryY;

    // System Overview
    summaryPage.drawText("System Overview", {
      x: 40,
      y: currentY,
      size: 14,
      font: boldFont,
      color: rgb(0, 0, 0),
    });

    let statsY = currentY - 30;
    const systemStats = [
      `Today's Scans: ${todayScans.value}`,
      `Total Registered Cards: ${cardsTotal.value}`,
      `Active Devices: ${activeDevices.value}`,
      `Total Users: ${totalUsers.value}`,
      `Cards Created This Month: ${cardsCreatedThisMonth.value}`,
      `Users Joined This Month: ${usersCreatedThisMonth.value}`,
      `Devices in Registration Mode: ${registrationModeDevices.value}`,
    ];

    for (const stat of systemStats) {
      summaryPage.drawText(stat, {
        x: 40,
        y: statsY,
        size: 11,
        font,
        color: rgb(0, 0, 0),
      });
      statsY -= 20;
    }

    currentY = statsY - 30;

    // Activity chart
    if (activityData.length > 0 && activityData.some((d) => d.value > 0)) {
      currentY = drawBarChart(
        summaryPage,
        activityData,
        currentY,
        `${useMonthly ? "Monthly" : "Daily"} Activity (${
          useMonthly ? "Last 6 Months" : "Last 7 Days"
        })`
      );
    } else {
      summaryPage.drawText(`${useMonthly ? "Monthly" : "Daily"} Activity`, {
        x: 40,
        y: currentY,
        size: 10,
        font: boldFont,
        color: rgb(0, 0, 0),
      });
      currentY -= 20;
      summaryPage.drawText(
        "No activity data available for the selected period",
        {
          x: 40,
          y: currentY,
          size: 8,
          font,
          color: rgb(0.5, 0.5, 0.5),
        }
      );
      currentY -= 50;
    }

    // User roles chart
    if (userRoleData.length > 0) {
      currentY = drawPieChart(
        summaryPage,
        userRoleData,
        currentY,
        "User Role Distribution"
      );
    }

    // Historical activity page
    if (buckets.length > 0) {
      const { page: historyPage } = addPage(
        `Historical Activity - ${user.value.name}`
      );

      const historicalData = buckets.map((bucket) => ({
        label: useMonthly
          ? formatMonthLabel((bucket as any).month)
          : formatDailyLabel((bucket as any).date),
        value: bucket.total,
      }));

      drawBarChart(
        historyPage,
        historicalData,
        720,
        `Complete ${useMonthly ? "Monthly" : "Daily"} Activity History`
      );
    }

    // Add a summary table page
    const { page: tablePage } = addPage(
      `System Summary Table - ${user.value.name}`
    );

    const tableHeaders = ["Metric", "Value", "Status"];
    const tableColWidths = [120, 80, 100];

    const tableData = [
      [
        "Today's Scans",
        todayScans.value.toString(),
        todayScans.value > 0 ? "Active" : "No Activity",
      ],
      [
        "Total Registered Cards",
        cardsTotal.value.toString(),
        cardsTotal.value > 0 ? "Good" : "None",
      ],
      [
        "Active Devices",
        activeDevices.value.toString(),
        activeDevices.value > 0 ? "Online" : "Offline",
      ],
      [
        "Total Users",
        totalUsers.value.toString(),
        totalUsers.value > 0 ? "Active" : "Empty",
      ],
      [
        "Cards This Month",
        cardsCreatedThisMonth.value.toString(),
        cardsCreatedThisMonth.value > 0 ? "Growing" : "Static",
      ],
      [
        "Users This Month",
        usersCreatedThisMonth.value.toString(),
        usersCreatedThisMonth.value > 0 ? "Growing" : "Static",
      ],
      [
        "Registration Mode Devices",
        registrationModeDevices.value.toString(),
        registrationModeDevices.value > 0 ? "Setup" : "Normal",
      ],
    ];

    drawTable(tablePage, tableHeaders, tableData, 720, tableColWidths);

    const pdfBytes = await pdfDoc.save();

    // Create blob URL for preview
    const blob = new Blob([pdfBytes as any], { type: "application/pdf" });
    pdfBlobUrl.value = URL.createObjectURL(blob);
    pdfPreviewModal.value = true;
  } catch (error) {
    console.error("Failed to generate admin PDF:", error);
  } finally {
    pdfLoading.value = false;
  }
};

const cancelPdfPreview = () => {
  pdfPreviewModal.value = false;
  if (pdfBlobUrl.value) {
    URL.revokeObjectURL(pdfBlobUrl.value);
    pdfBlobUrl.value = null;
  }
};

// Mark symbols as used so TypeScript doesn't report them as unused
/* istanbul ignore next */
void RfidChart;
/* istanbul ignore next */
void RfidDeviceStatus;
/* istanbul ignore next */
void RfidQueueMatrix;
/* istanbul ignore next */
void Line;
/* istanbul ignore next */
void Pie;
/* istanbul ignore next */
void Bar;
/* istanbul ignore next */
void statusFilterOptions;
/* istanbul ignore next */
void statusClassMap;
/* istanbul ignore next */
void scanDeltaClass;
/* istanbul ignore next */
void scanDeltaLabel;
/* istanbul ignore next */
void cardsTotal;
/* istanbul ignore next */
void cardsCreatedThisMonth;
/* istanbul ignore next */
void activeDevices;
/* istanbul ignore next */
void registrationModeDevices;
/* istanbul ignore next */
void totalUsers;
/* istanbul ignore next */
void usersCreatedThisMonth;
/* istanbul ignore next */
void dailyTripsData;
/* istanbul ignore next */
void dailyTripsOptions;
/* istanbul ignore next */
void userAccessData;
/* istanbul ignore next */
void userAccessOptions;
/* istanbul ignore next */
void historicalTripsData;
/* istanbul ignore next */
void historicalTripsOptions;
/* istanbul ignore next */
void downloadPdf;
void downloadAdminPdf;
void downloadCsv;
void downloadCsvAdmin;
void downloadCsvScans;
/* istanbul ignore next */
void selectAllColumns;
/* istanbul ignore next */
void clearAllColumns;
/* istanbul ignore next */
void showColumnSelector;

onMounted(async () => {
  syncThemeName();
  window.addEventListener("tagsakay-theme-change", handleThemeChange);
  user.value = authService.getUser();
  await loadStatistics();
});

onBeforeUnmount(() => {
  window.removeEventListener("tagsakay-theme-change", handleThemeChange);
});
</script>

<template>
  <div v-if="loading" class="flex justify-center items-center min-h-[50vh]">
    <span class="loading loading-spinner loading-lg"></span>
  </div>

  <div v-else>
    <!-- Dashboard Header -->
    <div class="mb-8">
      <div class="flex justify-between items-start mb-4">
        <div>
          <h1 class="text-3xl font-bold text-base-content mb-2">Dashboard</h1>
          <p class="text-base-content/70">Welcome back, {{ user?.name }}!</p>
          <p v-if="isDriver" class="text-sm text-base-content/50">
            Driver View - Your Personal Records
          </p>
        </div>
      </div>
      <div
        v-if="!isDriver"
        class="alert alert-info bg-info/10 border-info/30 flex flex-col gap-3 md:flex-row md:items-center"
      >
        <div>
          <p class="font-semibold text-base-content">
            Need a checklist? Launch the onboarding wizard.
          </p>
          <p class="text-sm text-base-content/70">
            Guided steps for device + driver setup with saved defaults and quick
            links.
          </p>
        </div>
        <RouterLink
          to="/onboarding"
          class="btn btn-primary btn-sm mt-2 md:mt-0"
          aria-label="Open the onboarding wizard"
        >
          Open wizard
        </RouterLink>
      </div>
    </div>

    <div v-if="isDriver" class="space-y-8 mb-8">
      <div class="bg-base-200 rounded-lg shadow-sm p-0 overflow-hidden">
        <Suspense>
          <template #default>
            <RfidQueueMatrix :rows="8" :columns="5" scope="driver" />
          </template>
          <template #fallback>
            <div class="flex items-center justify-center min-h-[12rem]">
              <span class="loading loading-spinner loading-md"></span>
            </div>
          </template>
        </Suspense>
      </div>

      <!-- Driver Statistics Cards -->
      <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        <!-- Total Scans -->
        <article
          class="bg-base-200 rounded-lg p-6 shadow-sm focus-within:ring focus-within:ring-primary/60 focus-within:ring-offset-2 focus-within:ring-offset-base-200"
          role="group"
          tabindex="0"
          aria-labelledby="driver-total-label"
          aria-describedby="driver-total-range"
        >
          <div class="flex flex-wrap items-center justify-between gap-2 mb-4">
            <div>
              <p
                id="driver-total-label"
                class="text-base-content/80 text-sm font-medium"
              >
                Total Scans (30 days)
              </p>
              <p class="text-3xl font-bold text-base-content">
                {{ driverStats.totalScans }}
              </p>
            </div>
            <div class="p-3 bg-primary/10 rounded-lg">
              <svg
                class="w-6 h-6 text-primary"
                fill="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  d="M12 2C13.1 2 14 2.9 14 4C14 5.1 13.1 6 12 6C10.9 6 10 5.1 10 4C10 2.9 10.9 2 12 2ZM21 9V7L15 1L13.5 2.5L18.5 7.5H9.5L14.5 2.5L13 1L7 7V9H21ZM12 8C13.66 8 15 9.34 15 11V16L13.5 15L12 16L10.5 15L9 16V11C9 9.34 10.34 8 12 8Z"
                />
              </svg>
            </div>
          </div>
          <p id="driver-total-range" class="text-sm text-base-content/70">
            Last 30 days activity
          </p>
        </article>

        <!-- This Week Scans -->
        <article
          class="bg-base-200 rounded-lg p-6 shadow-sm focus-within:ring focus-within:ring-primary/60 focus-within:ring-offset-2 focus-within:ring-offset-base-200"
          role="group"
          tabindex="0"
          aria-labelledby="driver-week-label"
          aria-describedby="driver-week-range"
        >
          <div class="flex flex-wrap items-center justify-between gap-2 mb-4">
            <div>
              <p
                id="driver-week-label"
                class="text-base-content/80 text-sm font-medium"
              >
                This Week
              </p>
              <p class="text-3xl font-bold text-base-content">
                {{ driverStats.thisWeekScans }}
              </p>
            </div>
            <div class="p-3 bg-secondary/10 rounded-lg">
              <svg
                class="w-6 h-6 text-secondary"
                fill="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  d="M19 4h-1V2h-2v2H8V2H6v2H5c-1.11 0-1.99.9-1.99 2L3 20c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 16H5V10h14v10zM5 8V6h14v2H5z"
                />
              </svg>
            </div>
          </div>
          <p id="driver-week-range" class="text-sm text-base-content/70">
            Last 7 days
          </p>
        </article>

        <!-- Last Scan -->
        <article
          class="bg-base-200 rounded-lg p-6 shadow-sm focus-within:ring focus-within:ring-primary/60 focus-within:ring-offset-2 focus-within:ring-offset-base-200"
          role="group"
          tabindex="0"
          aria-labelledby="driver-last-label"
        >
          <div class="flex items-center justify-between mb-4">
            <div>
              <p
                id="driver-last-label"
                class="text-base-content/80 text-sm font-medium"
              >
                Last Scan
              </p>
              <p class="text-xl font-bold text-base-content">
                <template v-if="driverStats.lastScanTime">
                  <time :dateTime="driverStats.lastScanTime">
                    {{ new Date(driverStats.lastScanTime).toLocaleString() }}
                  </time>
                </template>
                <template v-else>No scans yet</template>
              </p>
            </div>
            <div class="p-3 bg-accent/10 rounded-lg">
              <svg
                class="w-6 h-6 text-accent"
                fill="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z"
                />
              </svg>
            </div>
          </div>
        </article>
      </div>
    </div>

    <!-- Admin Statistics Cards -->
    <div
      v-else
      class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8"
    >
      <!-- Today's Scans -->
      <div class="bg-base-200 rounded-lg p-6 shadow-sm">
        <div class="flex flex-wrap items-center justify-between gap-2 mb-4">
          <div>
            <p class="text-base-content/60 text-sm font-medium">
              Today's Scans
            </p>
            <p class="text-3xl font-bold text-base-content">{{ todayScans }}</p>
          </div>
          <div class="p-3 bg-primary/10 rounded-lg">
            <svg
              class="w-6 h-6 text-primary"
              fill="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                d="M12 2C13.1 2 14 2.9 14 4C14 5.1 13.1 6 12 6C10.9 6 10 5.1 10 4C10 2.9 10.9 2 12 2ZM21 9V7L15 1L13.5 2.5L18.5 7.5H9.5L14.5 2.5L13 1L7 7V9H21ZM12 8C13.66 8 15 9.34 15 11V16L13.5 15L12 16L10.5 15L9 16V11C9 9.34 10.34 8 12 8Z"
              />
            </svg>
          </div>
        </div>
        <p class="text-sm" :class="scanDeltaClass">
          {{ scanDeltaLabel }}
        </p>
      </div>

      <!-- Registered Cards -->
      <div class="bg-base-200 rounded-lg p-6 shadow-sm">
        <div class="flex flex-wrap items-center justify-between gap-2 mb-4">
          <div>
            <p class="text-base-content/60 text-sm font-medium">
              Registered Cards
            </p>
            <p class="text-3xl font-bold text-base-content">
              {{ cardsTotal }}
            </p>
          </div>
          <div class="p-3 bg-secondary/10 rounded-lg">
            <svg
              class="w-6 h-6 text-secondary"
              fill="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                d="M20 4H4c-1.11 0-1.99.89-1.99 2L2 18c0 1.11.89 2 2 2h16c1.11 0 2-.89 2-2V6c0-1.11-.89-2-2-2zm0 14H4v-6h16v6zm0-10H4V6h16v2z"
              />
            </svg>
          </div>
        </div>
        <p
          class="text-sm"
          :class="
            cardsCreatedThisMonth > 0 ? 'text-success' : 'text-base-content/60'
          "
        >
          {{
            cardsCreatedThisMonth > 0
              ? `${cardsCreatedThisMonth} new this month`
              : "No new cards this month"
          }}
        </p>
      </div>

      <!-- Active Devices -->
      <div class="bg-base-200 rounded-lg p-6 shadow-sm">
        <div class="flex flex-wrap items-center justify-between gap-2 mb-4">
          <div>
            <p class="text-base-content/60 text-sm font-medium">
              Active Devices
            </p>
            <p class="text-3xl font-bold text-base-content">
              {{ activeDevices }}
            </p>
          </div>
          <div class="p-3 bg-accent/10 rounded-lg">
            <svg
              class="w-6 h-6 text-accent"
              fill="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                d="M9 4C9 3.45 9.45 3 10 3H14C14.55 3 15 3.45 15 4V6H17C18.1 6 19 6.9 19 8V19C19 20.1 18.1 21 17 21H7C5.9 21 5 20.1 5 19V8C5 6.9 5.9 6 7 6H9V4ZM7 8V19H17V8H7ZM10 10H14V12H10V10ZM10 14H14V16H10V14Z"
              />
            </svg>
          </div>
        </div>
        <p class="text-sm text-base-content/60">
          {{ registrationModeDevices }} in registration mode
        </p>
      </div>

      <!-- Total Users -->
      <div class="bg-base-200 rounded-lg p-6 shadow-sm">
        <div class="flex items-center justify-between mb-4">
          <div>
            <p class="text-base-content/60 text-sm font-medium">Total Users</p>
            <p class="text-3xl font-bold text-base-content">{{ totalUsers }}</p>
          </div>
          <div class="p-3 bg-info/10 rounded-lg">
            <svg
              class="w-6 h-6 text-info"
              fill="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"
              />
            </svg>
          </div>
        </div>
        <p
          class="text-sm"
          :class="
            usersCreatedThisMonth > 0 ? 'text-success' : 'text-base-content/60'
          "
        >
          {{
            usersCreatedThisMonth > 0
              ? `${usersCreatedThisMonth} joined this month`
              : "No new users this month"
          }}
        </p>
      </div>
    </div>

    <!-- Admin-Only: Device + Live Queue -->
    <div v-if="!isDriver" class="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
      <div class="bg-base-200 rounded-lg shadow-sm p-0 overflow-hidden">
        <Suspense>
          <template #default>
            <RfidDeviceStatus />
          </template>
          <template #fallback>
            <div class="flex items-center justify-center min-h-[12rem]">
              <span class="loading loading-spinner loading-md"></span>
            </div>
          </template>
        </Suspense>
      </div>
      <div class="bg-base-200 rounded-lg shadow-sm p-0 overflow-hidden">
        <Suspense>
          <template #default>
            <RfidQueueMatrix :rows="8" :columns="5" />
          </template>
          <template #fallback>
            <div class="flex items-center justify-center min-h-[12rem]">
              <span class="loading loading-spinner loading-md"></span>
            </div>
          </template>
        </Suspense>
      </div>
    </div>

    <!-- Driver Scan History -->
    <div v-if="isDriver" class="bg-base-200 rounded-lg p-6 shadow-sm mb-8">
      <div class="flex justify-between items-center mb-6">
        <h3 class="text-lg font-semibold text-base-content">
          My Scan History (Last 30 Days)
        </h3>
        <div class="flex gap-2">
          <button
            v-if="filteredDriverScans.length > 0"
            @click="downloadPdf"
            :disabled="pdfLoading"
            class="btn btn-primary btn-sm"
            aria-label="Download scan history with charts and tables as PDF"
          >
            <span
              v-if="pdfLoading"
              class="loading loading-spinner loading-sm"
            ></span>
            <svg
              v-else
              class="w-4 h-4 mr-2"
              fill="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                d="M14,2H6A2,2 0 0,0 4,4V20A2,2 0 0,0 6,22H18A2,2 0 0,0 20,20V8L14,2M18,20H6V4H13V9H18V20Z"
              />
            </svg>
            Download PDF Report
          </button>
          <button
            v-if="filteredDriverScans.length > 0"
            @click="downloadCsv"
            class="btn btn-secondary btn-sm"
            aria-label="Download scan history as CSV"
          >
            <svg class="w-4 h-4 mr-2" fill="currentColor" viewBox="0 0 24 24">
              <path
                d="M14,2H6A2,2 0 0,0 4,4V20A2,2 0 0,0 6,22H18A2,2 0 0,0 20,20V8L14,2M18,20H6V4H13V9H18V20Z"
              />
            </svg>
            Download CSV
          </button>
        </div>
      </div>

      <div v-if="driverScans.length === 0" class="text-center py-8">
        <div class="text-base-content/40 mb-2">
          <svg
            class="w-12 h-12 mx-auto"
            fill="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              d="M20 4H4c-1.11 0-1.99.89-1.99 2L2 18c0 1.11.89 2 2 2h16c1.11 0 2-.89 2-2V6c0-1.11-.89-2-2-2zm0 14H4v-6h16v6zm0-10H4V6h16v2z"
            />
          </svg>
        </div>
        <p class="text-base-content/80 font-medium">No scan records found</p>
        <p class="text-sm text-base-content/60">
          Ask your dispatcher to link your RFID tag so scans can appear here.
        </p>
        <a
          class="btn btn-primary btn-sm mt-4"
          href="mailto:support@tagsakay.com?subject=RFID%20Registration%20Request"
          aria-label="Request RFID registration help via email"
        >
          Request RFID registration
        </a>
      </div>

      <div
        v-else
        class="space-y-4"
        role="region"
        aria-live="polite"
        aria-label="Driver scan history"
      >
        <div
          class="flex flex-wrap gap-2"
          role="group"
          aria-label="Filter scan history by status"
        >
          <button
            v-for="option in statusFilterOptions"
            :key="option.value"
            type="button"
            class="btn btn-xs sm:btn-sm"
            :class="
              scanStatusFilter === option.value
                ? 'btn-primary text-primary-content'
                : 'btn-ghost border border-base-300 text-base-content/80'
            "
            :aria-pressed="scanStatusFilter === option.value"
            @click="scanStatusFilter = option.value"
          >
            {{ option.label }}
          </button>
        </div>

        <div
          v-if="filteredDriverScans.length === 0"
          class="text-center py-6 text-base-content/60"
        >
          <p>No scans match this filter.</p>
        </div>

        <ul v-else role="list" class="space-y-3 max-h-96 overflow-y-auto pr-1">
          <li
            v-for="scan in filteredDriverScans.slice(0, 50)"
            :key="scan.id"
            role="listitem"
            tabindex="0"
            class="flex items-center justify-between p-4 bg-base-100 rounded-lg border border-base-300"
            :aria-label="`Scan ${scan.rfidTagId} ${scan.status} at ${
              scan.location || 'Unknown location'
            } on ${new Date(scan.scanTime).toLocaleString()}`"
          >
            <div class="flex items-center gap-3">
              <div class="p-2 rounded-lg bg-base-200" aria-hidden="true">
                <svg
                  class="w-5 h-5 text-base-content"
                  fill="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    d="M20 4H4c-1.11 0-1.99.89-1.99 2L2 18c0 1.11.89 2 2 2h16c1.11 0 2-.89 2-2V6c0-1.11-.89-2-2-2zm0 14H4v-6h16v6zm0-10H4V6h16v2z"
                  />
                </svg>
              </div>
              <div>
                <p class="font-medium text-base-content">
                  {{ scan.rfidTagId }}
                </p>
                <p class="text-sm text-base-content/70">
                  {{ scan.location || "Unknown Location" }}
                  <span v-if="scan.unitNumber">
                    • Unit {{ scan.unitNumber }}</span
                  >
                </p>
              </div>
            </div>
            <div class="text-right space-y-1">
              <span
                class="inline-flex items-center px-3 py-1 text-xs font-semibold border rounded-full"
                :class="
                  statusClassMap[scan.status] ||
                  'border-base-300 text-base-content'
                "
              >
                {{ scan.status.charAt(0).toUpperCase() + scan.status.slice(1) }}
              </span>
              <p class="text-xs text-base-content/60">
                {{ new Date(scan.scanTime).toLocaleString() }}
              </p>
            </div>
          </li>
        </ul>
      </div>
    </div>

    <!-- Admin-Only: Charts Section -->
    <div v-if="!isDriver" class="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
      <!-- Daily Trips Chart -->
      <div class="bg-base-200 rounded-lg p-6 shadow-sm lg:col-span-2">
        <div class="flex items-center justify-between mb-6">
          <h3 class="text-lg font-semibold text-base-content">
            Daily Activity
          </h3>
          <div class="flex flex-wrap gap-2 items-center justify-end">
            <select
              class="select select-sm select-bordered w-24 sm:w-auto"
              v-model="activePeriod"
            >
              <option value="weekly">This Week</option>
              <option value="monthly">This Month</option>
            </select>
            <!-- Export filters for Scan CSV -->
            <label
              class="flex flex-col sm:flex-row items-center gap-2 w-full sm:w-auto"
            >
              <span class="label-text text-xs">From</span>
              <input
                v-model="exportStartDate"
                type="date"
                class="input input-xs input-bordered w-full sm:w-auto"
              />
            </label>
            <label
              class="flex flex-col sm:flex-row items-center gap-2 w-full sm:w-auto"
            >
              <span class="label-text text-xs">To</span>
              <input
                v-model="exportEndDate"
                type="date"
                class="input input-xs input-bordered w-full sm:w-auto"
              />
            </label>
            <select
              v-model="exportEventFilter"
              class="select select-xs select-bordered w-full sm:w-auto"
            >
              <option value="all">All Events</option>
              <option value="entry">Entry</option>
              <option value="ongoing">Ongoing</option>
              <option value="completed">Completed</option>
              <option value="unknown">Unknown</option>
              <option value="override_reserve">Override Reserve</option>
              <option value="override_fix">Override Fix</option>
            </select>
            <select
              v-model="exportStatusFilter"
              class="select select-xs select-bordered w-full sm:w-auto"
            >
              <option value="all">All Status</option>
              <option value="success">Successful</option>
              <option value="failed">Failed</option>
              <option value="unauthorized">Unauthorized</option>
            </select>
            <select
              v-model.number="exportLimit"
              class="select select-xs select-bordered w-24 sm:w-auto"
            >
              <option :value="100">100</option>
              <option :value="1000">1,000</option>
              <option :value="5000">5,000</option>
              <option :value="10000">10,000</option>
            </select>
            <div class="relative w-full sm:w-auto">
              <button
                class="btn btn-ghost btn-xs w-full sm:w-auto"
                @click="showColumnSelector = !showColumnSelector"
              >
                Columns
              </button>
              <div
                v-if="showColumnSelector"
                class="absolute sm:right-0 sm:top-8 left-2 right-2 sm:w-56 w-auto bg-base-100 p-2 rounded-lg shadow-lg border z-50 max-h-64 overflow-auto"
              >
                <div class="font-semibold mb-2">Columns</div>
                <div class="space-y-1 max-h-40 overflow-auto">
                  <label
                    v-for="opt in columnOptions"
                    :key="opt.key"
                    class="flex items-center gap-2"
                  >
                    <input
                      type="checkbox"
                      class="checkbox"
                      :value="opt.key"
                      v-model="selectedColumns"
                    />
                    <span class="text-sm">{{ opt.label }}</span>
                  </label>
                </div>
                <div class="mt-2 flex justify-end gap-2">
                  <button
                    class="btn btn-xs btn-outline"
                    @click="selectAllColumns"
                  >
                    Select All
                  </button>
                  <button
                    class="btn btn-xs btn-outline"
                    @click="clearAllColumns"
                  >
                    Clear
                  </button>
                  <button
                    class="btn btn-xs"
                    @click="showColumnSelector = false"
                  >
                    Done
                  </button>
                </div>
              </div>
            </div>
            <button
              @click="downloadAdminPdf"
              :disabled="pdfLoading"
              class="btn btn-primary btn-sm w-full sm:w-auto"
              aria-label="Download dashboard report with charts as PDF"
            >
              <span
                v-if="pdfLoading"
                class="loading loading-spinner loading-sm"
              ></span>
              <svg
                v-else
                class="w-4 h-4 mr-2"
                fill="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  d="M14,2H6A2,2 0 0,0 4,4V20A2,2 0 0,0 6,22H18A2,2 0 0,0 20,20V8L14,2M18,20H6V4H13V9H18V20Z"
                />
              </svg>
              Download PDF Report
            </button>
            <button
              @click="downloadCsvAdmin"
              class="btn btn-secondary btn-sm w-full sm:w-auto"
              aria-label="Download dashboard stats as CSV"
            >
              <svg class="w-4 h-4 mr-2" fill="currentColor" viewBox="0 0 24 24">
                <path
                  d="M14,2H6A2,2 0 0,0 4,4V20A2,2 0 0,0 6,22H18A2,2 0 0,0 20,20V8L14,2M18,20H6V4H13V9H18V20Z"
                />
              </svg>
              Download CSV
            </button>
            <button
              @click="downloadCsvScans"
              class="btn btn-accent btn-sm w-full sm:w-auto"
              aria-label="Download complete RFID scan history as CSV"
            >
              <svg class="w-4 h-4 mr-2" fill="currentColor" viewBox="0 0 24 24">
                <path
                  d="M14,2H6A2,2 0 0,0 4,4V20A2,2 0 0,0 6,22H18A2,2 0 0,0 20,20V8L14,2M18,20H6V4H13V9H18V20Z"
                />
              </svg>
              Download Scans CSV
            </button>
          </div>
        </div>
        <div class="h-80">
          <Suspense>
            <template #default>
              <Line :data="dailyTripsData" :options="dailyTripsOptions" />
            </template>
            <template #fallback>
              <div class="flex items-center justify-center h-full">
                <span
                  class="loading loading-spinner loading-lg"
                  aria-hidden="true"
                ></span>
              </div>
            </template>
          </Suspense>
        </div>
      </div>

      <!-- User Access Overview -->
      <div class="bg-base-200 rounded-lg p-6 shadow-sm">
        <h3 class="text-lg font-semibold text-base-content mb-6">User Roles</h3>
        <div class="flex items-center justify-center mb-6">
          <div class="w-40 h-40">
            <Suspense>
              <template #default>
                <Pie :data="userAccessData" :options="userAccessOptions" />
              </template>
              <template #fallback>
                <div class="flex items-center justify-center h-40 w-40">
                  <span
                    class="loading loading-spinner loading-lg"
                    aria-hidden="true"
                  ></span>
                </div>
              </template>
            </Suspense>
          </div>
        </div>
        <div class="space-y-3">
          <div class="flex items-center justify-between">
            <div class="flex items-center">
              <div
                class="w-3 h-3 rounded-full mr-3"
                :style="{ backgroundColor: userRoleColors[0] }"
              ></div>
              <span class="text-sm text-base-content/80">Drivers</span>
            </div>
            <span class="text-sm font-medium">{{ userStats.drivers }}</span>
          </div>
          <div class="flex items-center justify-between">
            <div class="flex items-center">
              <div
                class="w-3 h-3 rounded-full mr-3"
                :style="{ backgroundColor: userRoleColors[1] }"
              ></div>
              <span class="text-sm text-base-content/80">Admins</span>
            </div>
            <span class="text-sm font-medium">{{ userStats.admins }}</span>
          </div>
          <div class="flex items-center justify-between">
            <div class="flex items-center">
              <div
                class="w-3 h-3 rounded-full mr-3"
                :style="{ backgroundColor: userRoleColors[2] }"
              ></div>
              <span class="text-sm text-base-content/80">Super Admins</span>
            </div>
            <span class="text-sm font-medium">{{ userStats.superadmins }}</span>
          </div>
        </div>
      </div>
    </div>

    <!-- Admin-Only: Additional Components -->
    <div v-if="!isDriver" class="grid grid-cols-1 gap-6 mb-8">
      <!-- Monthly Activity -->
      <div class="bg-base-200 rounded-lg p-6 shadow-sm">
        <h3 class="text-lg font-semibold text-base-content mb-6">
          Monthly Activity (6 Months)
        </h3>
        <div class="h-60">
          <Suspense>
            <template #default>
              <Bar
                :data="historicalTripsData"
                :options="historicalTripsOptions"
              />
            </template>
            <template #fallback>
              <div class="flex items-center justify-center h-full">
                <span
                  class="loading loading-spinner loading-lg"
                  aria-hidden="true"
                ></span>
              </div>
            </template>
          </Suspense>
        </div>
      </div>
    </div>

    <!-- Admin-Only: Live Components -->
    <div
      v-if="!isDriver"
      class="bg-base-200 rounded-lg shadow-sm p-0 overflow-hidden"
    >
      <Suspense>
        <template #default>
          <RfidChart />
        </template>
        <template #fallback>
          <div class="flex items-center justify-center min-h-[16rem]">
            <span class="loading loading-spinner loading-md"></span>
          </div>
        </template>
      </Suspense>
    </div>
  </div>

  <!-- PDF Preview Modal -->
  <div v-if="pdfPreviewModal" class="modal modal-open">
    <div class="modal-box max-w-[96vw] sm:max-w-4xl w-full h-[88vh] sm:h-5/6 p-3 sm:p-6">
      <div class="flex flex-col h-full">
        <div class="flex justify-between items-center mb-4">
          <h3 class="font-bold text-lg">PDF Report Preview</h3>
          <button
            @click="cancelPdfPreview"
            class="btn btn-sm btn-circle btn-ghost"
            aria-label="Close preview"
          >
            ✕
          </button>
        </div>

        <div class="flex-1 min-h-0">
          <iframe
            v-if="pdfBlobUrl"
            :src="pdfBlobUrl"
            class="w-full h-full border rounded-lg"
            type="application/pdf"
          ></iframe>
        </div>

        <div class="modal-action mt-4">
          <button @click="cancelPdfPreview" class="btn btn-ghost">
            Cancel
          </button>
          <button
            @click="downloadPdfFromPreview"
            class="btn btn-primary"
            :disabled="!pdfBlobUrl"
          >
            <svg class="w-4 h-4 mr-2" fill="currentColor" viewBox="0 0 24 24">
              <path
                d="M14,2H6A2,2 0 0,0 4,4V20A2,2 0 0,0 6,22H18A2,2 0 0,0 20,20V8L14,2M18,20H6V4H13V9H18V20Z"
              />
            </svg>
            Download PDF
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* Custom styling for charts and components */
.grid > div {
  transition: transform 0.2s ease-in-out;
}

.grid > div:hover {
  transform: translateY(-2px);
}
</style>
