<script setup lang="ts">
import {
  ref,
  computed,
  onMounted,
  onUnmounted,
  defineAsyncComponent,
} from "vue";
import { ChartComponents } from "../utils/chartConfig";
import type { ChartData, ChartOptions } from "chart.js";

import rfidService, {
  type RfidScan,
  type RfidScanStatus,
  type RfidEventType,
  type RfidScanHistoryResponse,
} from "../services/rfid";
import userService from "../services/user";
import useToast from "../composables/useToast";
const { success: toastSuccess, error: toastError } = useToast();
import { buildCsvBlob } from "../utils/csv.ts";
import type { PDFFont } from "pdf-lib";

// Lazy-load chart components without making module setup async
const Pie = defineAsyncComponent(() =>
  ChartComponents.Pie().then((m: any) => m?.default ?? m)
);

const Bar = defineAsyncComponent(() =>
  ChartComponents.Bar().then((m: any) => m?.default ?? m)
);

type EventFilter = RfidEventType | "all";

const EVENT_OPTIONS = [
  { value: "all", label: "All Events" },
  { value: "entry", label: "Entry" },
  { value: "ongoing", label: "Ongoing" },
  { value: "completed", label: "Completed" },
  { value: "unknown", label: "Unknown" },
  { value: "override_reserve", label: "Override Reserve" },
  { value: "override_fix", label: "Override Fix" },
] as const;

const LIMIT_OPTIONS = [50, 100, 250, 500, 1000] as const;

const today = new Date();
const defaultStart = new Date(today);
defaultStart.setUTCDate(defaultStart.getUTCDate() - 6);

const formatDateInput = (date: Date): string => {
  return date.toISOString().split("T")[0];
};

const startDate = ref(formatDateInput(defaultStart));
const endDate = ref(formatDateInput(today));
const eventFilter = ref<EventFilter>("all");
const limit = ref(250);

const loading = ref(false);
const pdfLoading = ref(false);
const pdfPreviewModal = ref(false);
const pdfBlobUrl = ref<string | null>(null);
const errorMessage = ref("");
const history = ref<RfidScanHistoryResponse | null>(null);
const lastFetchedAt = ref<string | null>(null);

const scans = computed<RfidScan[]>(() =>
  Array.isArray(history.value?.scans) ? history.value!.scans : []
);
const scanCount = computed(() => scans.value.length);
const hasScans = computed(() => scanCount.value > 0);
const summary = computed(() => history.value?.summary);
const rangeLabel = computed(() => {
  const start = history.value?.range?.start;
  const end = history.value?.range?.end;
  if (!start || !end) {
    return `${startDate.value} -> ${endDate.value}`;
  }
  return `${formatDisplayDate(start)} -> ${formatDisplayDate(end)}`;
});

const totals = computed(() => {
  const statusSummary: Partial<Record<RfidScanStatus, number>> =
    summary.value?.byStatus ?? {};
  return {
    total: history.value?.total ?? scanCount.value,
    success: statusSummary.success ?? 0,
    failed: statusSummary.failed ?? 0,
    unauthorized: statusSummary.unauthorized ?? 0,
  };
});

const eventBreakdown = computed(() => {
  const base: Record<RfidEventType, number> = {
    entry: 0,
    ongoing: 0,
    completed: 0,
    unknown: 0,
    override_reserve: 0,
    override_fix: 0,
  };

  const source = summary.value?.byEventType;
  if (!source || typeof source !== "object") {
    return base;
  }

  (Object.keys(base) as RfidEventType[]).forEach((key) => {
    base[key] = source[key] ?? 0;
  });
  return base;
});

const eventEntries = computed(() => {
  const breakdown = eventBreakdown.value ?? {};
  return (Object.keys(breakdown) as RfidEventType[]).map((key) => ({
    label: key,
    value: breakdown[key] ?? 0,
  }));
});

const statusPieData = computed<ChartData<"pie">>(() => ({
  labels: ["Success", "Failed", "Unauthorized"],
  datasets: [
    {
      data: [
        totals.value.success,
        totals.value.failed,
        totals.value.unauthorized,
      ],
      backgroundColor: [
        "rgba(34, 197, 94, 0.9)",
        "rgba(245, 158, 11, 0.9)",
        "rgba(239, 68, 68, 0.9)",
      ],
      borderWidth: 0,
    },
  ],
}));

const statusPieOptions = computed<ChartOptions<"pie">>(() => ({
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { position: "bottom" },
  },
}));

const eventBarData = computed<ChartData<"bar">>(() => {
  if (!eventBreakdown.value) {
    return {
      labels: [],
      datasets: [
        {
          label: "Scans",
          data: [],
          backgroundColor: "rgba(59, 130, 246, 0.9)",
          borderRadius: 4,
        },
      ],
    } satisfies ChartData<"bar">;
  }

  const labels = Object.keys(eventBreakdown.value) as RfidEventType[];
  const values = labels.map((key) => eventBreakdown.value[key]);

  return {
    labels,
    datasets: [
      {
        label: "Scans",
        data: values,
        backgroundColor: "rgba(59, 130, 246, 0.9)",
        borderRadius: 4,
      },
    ],
  } satisfies ChartData<"bar">;
});

const eventBarOptions = computed<ChartOptions<"bar">>(() => ({
  responsive: true,
  maintainAspectRatio: false,
  scales: {
    y: { beginAtZero: true },
    x: { ticks: { autoSkip: false } },
  },
  plugins: {
    legend: { display: false },
  },
}));

const resolveDateRange = () => {
  const startIso = toIsoDay(startDate.value);
  const endIso = toIsoDay(endDate.value);
  const start = new Date(startIso);
  const end = new Date(endIso);

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new Error("Invalid date range. Please choose valid dates.");
  }

  if (start > end) {
    throw new Error("Start date cannot be later than end date.");
  }

  return { startIso, endIso };
};

const fetchHistory = async () => {
  errorMessage.value = "";
  loading.value = true;
  try {
    const { startIso, endIso } = resolveDateRange();
    const response = await rfidService.getScanHistory({
      startDate: startIso,
      endDate: endIso,
      eventType: eventFilter.value,
      limit: limit.value,
      includeCount: true,
    });
    history.value = response;
    lastFetchedAt.value = new Date().toISOString();
  } catch (error: any) {
    console.error("Failed to fetch RFID scan history", error);
    errorMessage.value =
      error?.message || "Unable to load RFID scan history. Please try again.";
  } finally {
    loading.value = false;
  }
};

const quickRange = (days: number) => {
  const end = new Date();
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - (days - 1));
  startDate.value = formatDateInput(start);
  endDate.value = formatDateInput(end);
};

// Use Asia/Manila timezone (Philippine Standard Time) for all display formatting
const TIME_ZONE = "Asia/Manila";

const formatDisplayDate = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString(undefined, {
    month: "short",
    day: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: TIME_ZONE,
  });
};

const formatDateCell = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString(undefined, { timeZone: TIME_ZONE });
};

const toIsoDay = (dayString: string): string => {
  const [year, month, day] = dayString.split("-").map(Number);
  if (!year || !month || !day) {
    const fallback = new Date(dayString);
    return fallback.toISOString();
  }
  return new Date(Date.UTC(year, month - 1, day)).toISOString();
};

const pageSize = ref(25);
const currentPage = ref(1);

const totalPages = computed(() => {
  if (!hasScans.value) return 1;
  return Math.max(1, Math.ceil(scanCount.value / pageSize.value));
});

const paginatedScans = computed(() => {
  const startIndex = (currentPage.value - 1) * pageSize.value;
  if (!hasScans.value) {
    return [] as RfidScan[];
  }
  return scans.value.slice(startIndex, startIndex + pageSize.value);
});

const resolveScanUnitNumber = (scan: RfidScan): string | null => {
  const metadata =
    scan.metadata && typeof scan.metadata === "object" ? scan.metadata : {};
  const metaRecord = metadata as Record<string, unknown>;

  const candidates: unknown[] = [
    scan.unitNumber,
    metaRecord["unitNumber"],
    metaRecord["unit_number"],
    metaRecord["unit"],
    metaRecord["vehicleNumber"],
    metaRecord["vehicleId"],
  ];

  for (const candidate of candidates) {
    if (candidate === undefined || candidate === null) continue;
    const stringValue =
      typeof candidate === "string" ? candidate : String(candidate);
    const trimmed = stringValue.trim();
    if (trimmed.length > 0) {
      return trimmed.toUpperCase();
    }
  }

  return null;
};

const downloadPdf = async () => {
  if (!hasScans.value || pdfLoading.value) {
    return;
  }

  pdfLoading.value = true;
  errorMessage.value = "";

  try {
    const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");

    const pdfDoc = await PDFDocument.create();
    const regularFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    type PdfColor = ReturnType<typeof rgb>;

    const headingColor = rgb(0.07, 0.11, 0.23);
    const subheadingColor = rgb(0.39, 0.45, 0.56);
    const bodyColor = rgb(0.13, 0.16, 0.23);
    // dividerColor removed — table rendering uses borders/colors directly

    let page = pdfDoc.addPage();
    let { width, height } = page.getSize();
    const margin = 40;
    let cursorY = height - margin;

    const safeText = (value?: unknown) => {
      if (value === undefined || value === null) {
        return "—";
      }
      const text = String(value).trim();
      return text.length ? text : "—";
    };

    const wrapText = (
      text: string,
      maxWidth: number,
      fontRef: PDFFont,
      fontSize: number
    ) => {
      const sanitized = safeText(text);
      const words = sanitized.split(/\s+/);
      const lines: string[] = [];
      let current = "";

      words.forEach((word) => {
        // If the word can fit appended to current, do it
        const candidate = current ? `${current} ${word}` : word;
        if (fontRef.widthOfTextAtSize(candidate, fontSize) <= maxWidth) {
          current = candidate;
          return;
        }

        // If the single word itself is longer than maxWidth and cannot be
        // appended, break it into chunks that fit the available width. This
        // prevents long unbroken strings (IDs, URLs) from overflowing columns.
        if (fontRef.widthOfTextAtSize(word, fontSize) > maxWidth) {
          // flush current if present
          if (current) {
            lines.push(current);
            current = "";
          }

          let remaining = word;
          let piece = "";
          for (let i = 0; i < remaining.length; i++) {
            piece += remaining[i];
            if (fontRef.widthOfTextAtSize(piece, fontSize) > maxWidth) {
              // remove last char so piece fits
              const fitPiece = piece.slice(0, -1) || remaining[i];
              lines.push(fitPiece);
              // start new piece with the last char
              piece = piece.slice(-1);
            }
          }
          if (piece) lines.push(piece);
          return;
        }

        // word fits on its own line but cannot be appended to current
        if (current) {
          lines.push(current);
        }
        current = word;
      });

      if (current) {
        lines.push(current);
      }

      return lines.length ? lines : ["—"];
    };

    const ensureSpace = (required = 16) => {
      if (cursorY - required <= margin) {
        page = pdfDoc.addPage();
        ({ width, height } = page.getSize());
        cursorY = height - margin;
      }
    };

    const drawParagraph = (
      text: string,
      options?: { size?: number; color?: PdfColor; bold?: boolean }
    ) => {
      const size = options?.size ?? 11;
      const color = options?.color ?? bodyColor;
      const fontRef = options?.bold ? boldFont : regularFont;
      const lines = wrapText(text, width - margin * 2, fontRef, size);
      lines.forEach((line) => {
        ensureSpace(size + 4);
        page.drawText(line, {
          x: margin,
          y: cursorY - size,
          size,
          font: fontRef,
          color,
        });
        cursorY -= size + 4;
      });
    };

    const drawLabelValue = (label: string, value: string) => {
      const labelText = `${label}: `;
      const labelWidth = boldFont.widthOfTextAtSize(labelText, 10);
      const valueLines = wrapText(
        value,
        width - margin * 2 - labelWidth,
        regularFont,
        10
      );

      ensureSpace(valueLines.length * 12 + 6);
      page.drawText(labelText, {
        x: margin,
        y: cursorY - 10,
        size: 10,
        font: boldFont,
        color: subheadingColor,
      });

      valueLines.forEach((line, index) => {
        page.drawText(line, {
          x: margin + labelWidth,
          y: cursorY - 10 - index * 12,
          size: 10,
          font: regularFont,
          color: bodyColor,
        });
      });

      cursorY -= valueLines.length * 12 + 6;
    };

    // (divider helper removed — table layout used for entries)

    const eventFilterLabel =
      eventFilter.value === "all"
        ? "All Events"
        : eventFilter.value.charAt(0).toUpperCase() +
          eventFilter.value.slice(1);

    drawParagraph("RFID Scan History", {
      size: 18,
      bold: true,
      color: headingColor,
    });
    drawParagraph(rangeLabel.value, { size: 12, color: subheadingColor });

    drawLabelValue("Event Filter", eventFilterLabel);
    drawLabelValue("Downloaded", formatDateCell(new Date().toISOString()));
    drawLabelValue("Total Scans", totals.value.total.toLocaleString());

    // Status overview + event breakdown will be shown on the combined
    // summary page below; keep this header area focused on metadata.
    const significantEvents = eventEntries.value
      .filter((entry) => entry.value > 0)
      .sort((a, b) => b.value - a.value)
      .slice(0, 8);

    // --- Charts & summary (new) ---
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

      // Subtitle
      page.drawText(
        `Generated on ${new Date().toLocaleString(undefined, {
          timeZone: TIME_ZONE,
        })}`,
        {
          x: marginLeft,
          y,
          size: 10,
          font: regularFont,
          color: rgb(0.4, 0.4, 0.4),
        }
      );
      y -= 30;
      return { page, width, height, marginLeft, marginRight, y };
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

        // wrap each cell by column width
        const wrappedCells: string[][] = [];
        let maxLines = 1;
        for (let i = 0; i < row.length; i++) {
          const cellText = String(row[i] ?? "");
          const cellMaxWidth = Math.max(colWidths[i] - 8, 8);
          const lines = wrapText(
            cellText,
            cellMaxWidth,
            regularFont,
            cellFontSize
          );
          wrappedCells.push(lines);
          maxLines = Math.max(maxLines, lines.length);
        }

        const thisRowHeight = maxLines * lineHeight + 8; // padding

        // new page if needed
        if (y - thisRowHeight <= 60) {
          page = pdfDoc.addPage();
          ({ width, height } = page.getSize());
          y = height - 40;
          drawHeader();
        }

        // alternate row background
        const isEvenRow = rowIndex % 2 === 0;
        if (isEvenRow) {
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
              font: regularFont,
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
      page.drawText(title, {
        x: marginLeft,
        y,
        size: 10,
        font: boldFont,
        color: rgb(0, 0, 0),
      });
      y -= 20;
      if (!data || data.length === 0) {
        page.drawText("No data available", {
          x: marginLeft,
          y: y - 20,
          size: 8,
          font: regularFont,
          color: rgb(0.5, 0.5, 0.5),
        });
        return y - 50;
      }
      const chartWidth = width - marginLeft - marginRight;
      const chartHeight = 80;
      const maxValue = Math.max(...data.map((d) => d.value)) || 1;
      const barWidth = Math.max((chartWidth / data.length) * 0.8, 8);
      const spacing = Math.max((chartWidth / data.length) * 0.2, 2);
      const chartBottom = y - chartHeight;
      let x = marginLeft;
      for (const item of data) {
        const safeValue = Number.isFinite(item.value) ? Math.max(item.value, 0) : 0;
        const barHeight =
          safeValue > 0 ? Math.max((safeValue / maxValue) * chartHeight, 1) : 0;
        const barX = x + spacing / 2;
        const barY = chartBottom;
        if (barHeight > 0) {
          page.drawRectangle({
            x: barX,
            y: barY,
            width: barWidth,
            height: barHeight,
            color: rgb(0.2, 0.6, 1),
          });
        }
        page.drawText(safeValue.toString(), {
          x: barX + barWidth / 2 - 3,
          y: barY + barHeight + 4,
          size: 6,
          font: regularFont,
          color: rgb(0, 0, 0),
        });
        page.drawText(item.label, {
          x: barX + barWidth / 2 - 8,
          y: chartBottom - 10,
          size: 6,
          font: regularFont,
          color: rgb(0, 0, 0),
        });
        x += barWidth + spacing;
      }
      return chartBottom - 24;
    };

    const drawPieChart = (
      page: any,
      data: { label: string; value: number; color: [number, number, number] }[],
      startY: number,
      title: string
    ) => {
      const marginLeft = 40;
      let y = startY;
      page.drawText(title, {
        x: marginLeft,
        y,
        size: 10,
        font: boldFont,
        color: rgb(0, 0, 0),
      });
      y -= 20;
      const centerX = marginLeft + 80;
      const centerY = y - 40;
      const radius = 35;
      let startAngle = 0;
      const total = data.reduce((sum, d) => sum + d.value, 0);
      if (total === 0) {
        page.drawText("No data available", {
          x: marginLeft,
          y: y - 20,
          size: 8,
          font: regularFont,
          color: rgb(0.5, 0.5, 0.5),
        });
        return y - 80;
      }
      for (const item of data) {
        const percentage = item.value / total;
        const endAngle = startAngle + percentage * 2 * Math.PI;
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
        const legendX = marginLeft + 170;
        const legendY = y - 70 + data.indexOf(item) * 15;
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
          font: regularFont,
          color: rgb(0, 0, 0),
        });
        startAngle = endAngle;
      }
      return y - 80;
    };

    // Prepare chart data
    const scansForRange = scans.value;
    const dailyData: { label: string; value: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      // Build a date 'd' relative to now and compare scan dates using
      // the Asia/Manila timezone so counts reflect Philippine days.
      const d = new Date();
      d.setDate(d.getDate() - i);
      const iso = d.toLocaleDateString("en-CA", { timeZone: TIME_ZONE }); // YYYY-MM-DD
      const count = scansForRange.filter((s) => {
        const dateIso = new Date(s.scanTime).toLocaleDateString("en-CA", {
          timeZone: TIME_ZONE,
        });
        return dateIso === iso;
      }).length;
      dailyData.push({
        label: d.toLocaleDateString(undefined, {
          weekday: "short",
          timeZone: TIME_ZONE,
        }),
        value: count,
      });
    }

    const statusCounts = {
      success: totals.value.success,
      failed: totals.value.failed,
      unauthorized: totals.value.unauthorized,
    };
    const statusData = [
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
    ].filter((d) => d.value > 0) as {
      label: string;
      value: number;
      color: [number, number, number];
    }[];

    // Combined summary — prefer the first page (keep header + summary together)
    // If the current page doesn't have room, fall back to a new page.
    let mainPage = page;
    // use cursorY from the first page as the starting Y for summary content
    let currentY = cursorY - 20; // small gap after header metadata
    // if we don't have enough space remaining on the first page for the
    // summary content, create a fresh summary page instead
    const minSpaceForSummary = 300; // heuristic: require ~300pt of vertical space
    if (currentY <= minSpaceForSummary) {
      const { page: newPage, y: newY } = addPage("RFID Scan Summary");
      mainPage = newPage;
      currentY = newY;
    } else {
      // draw a small summary title area on the existing page
      mainPage.drawText("RFID Scan Summary", {
        x: 40,
        y: currentY,
        size: 16,
        font: boldFont,
        color: rgb(0, 0, 0),
      });
      currentY -= 24;
      mainPage.drawText(
        `Generated on ${new Date().toLocaleString(undefined, {
          timeZone: TIME_ZONE,
        })}`,
        {
          x: 40,
          y: currentY,
          size: 10,
          font: regularFont,
          color: rgb(0.4, 0.4, 0.4),
        }
      );
      currentY -= 16;
    }

    // Add filter info and download timestamp at the top of page one
    const selectedEventOption = EVENT_OPTIONS.find(
      (opt) => opt.value === eventFilter.value
    );
    const selectedEventFilterLabel = selectedEventOption
      ? selectedEventOption.label
      : "All Events";
    const downloadTimestamp = new Date().toLocaleString(undefined, {
      timeZone: TIME_ZONE,
    });

    mainPage.drawText(`Event Filter: ${selectedEventFilterLabel}`, {
      x: 40,
      y: currentY,
      size: 10,
      font: regularFont,
      color: rgb(0.4, 0.4, 0.4),
    });
    currentY -= 15;

    mainPage.drawText(`Downloaded: ${downloadTimestamp}`, {
      x: 40,
      y: currentY,
      size: 10,
      font: regularFont,
      color: rgb(0.4, 0.4, 0.4),
    });
    currentY -= 15;

    mainPage.drawText(`Total Scans: ${totals.value.total}`, {
      x: 40,
      y: currentY,
      size: 10,
      font: regularFont,
      color: rgb(0.4, 0.4, 0.4),
    });
    currentY -= 25;

    mainPage.drawText("Summary", {
      x: 40,
      y: currentY,
      size: 14,
      font: boldFont,
      color: rgb(0, 0, 0),
    });
    let statsY = currentY - 30;
    const systemStats = [
      `Total Scans: ${totals.value.total}`,
      `Successful: ${totals.value.success}`,
      `Failed: ${totals.value.failed}`,
      `Unauthorized: ${totals.value.unauthorized}`,
    ];
    for (const stat of systemStats) {
      mainPage.drawText(stat, {
        x: 40,
        y: statsY,
        size: 11,
        font: regularFont,
        color: rgb(0, 0, 0),
      });
      statsY -= 20;
    }
    currentY = statsY - 30;

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
        font: regularFont,
        color: rgb(0.5, 0.5, 0.5),
      });
      currentY -= 50;
    }

    if (statusData.length > 0) {
      currentY = drawPieChart(
        mainPage,
        statusData,
        currentY,
        "Scan Status Distribution"
      );
    }

    // Draw event breakdown on the summary page so Status Overview, Event
    // Breakdown and the Summary table appear together when possible.
    if (significantEvents.length) {
      mainPage.drawText("Event Breakdown", {
        x: 40,
        y: currentY - 8,
        size: 12,
        font: boldFont,
        color: rgb(0, 0, 0),
      });
      let ebY = currentY - 24;
      for (const entry of significantEvents) {
        mainPage.drawText(`${entry.label}: ${entry.value}`, {
          x: 40,
          y: ebY,
          size: 10,
          font: regularFont,
          color: rgb(0, 0, 0),
        });
        ebY -= 14;
      }
      currentY = ebY - 12;
    }

    // Draw summary table on the same page (keep Summary + Table together)
    const tableHeaders = ["Metric", "Value"];
    const tableColWidths = [160, 120];
    const tableData = [
      ["Total Scans", String(totals.value.total)],
      ["Successful", String(totals.value.success)],
      ["Failed", String(totals.value.failed)],
      ["Unauthorized", String(totals.value.unauthorized)],
      ["Range", rangeLabel.value],
    ];
    // use currentY from the summary page so the table stays on the same page
    // if there's not enough space we create a new page fallback
    const tableResult = drawTable(
      mainPage,
      tableHeaders,
      tableData,
      currentY - 20,
      tableColWidths
    );
    let nextY = tableResult.y;
    // if drawTable paginated internally and ended on a new page, adopt it
    if (tableResult.page !== mainPage) mainPage = tableResult.page;

    if (nextY <= 100) {
      // not enough space — add a new page for the table
      const { page: fallbackPage } = addPage("Summary Table");
      const fallbackResult = drawTable(
        fallbackPage,
        tableHeaders,
        tableData,
        720,
        tableColWidths
      );
      mainPage = fallbackResult.page;
      currentY = fallbackResult.y;
    } else {
      currentY = nextY;
    }

    // Prefer putting the scan history directly after the summary table
    // when there is room, otherwise create a fresh page for it.
    let scanHistoryPage: any = mainPage;
    let scanHistoryStartY = currentY - 40;

    const minSpaceForHistory = 140; // require some vertical space to place at least a header and couple rows
    if (scanHistoryStartY <= minSpaceForHistory) {
      const scanPageResult = addPage(
        `Detailed Scan History - ${rangeLabel.value}`
      );
      scanHistoryPage = scanPageResult.page;
      scanHistoryStartY = scanPageResult.y;
    } else {
      // draw the title on the same page
      scanHistoryPage.drawText(`Detailed Scan History - ${rangeLabel.value}`, {
        x: 40,
        y: scanHistoryStartY + 20,
        size: 14,
        font: boldFont,
        color: rgb(0, 0, 0),
      });
      scanHistoryStartY -= 20;
    }

    const headers = [
      "Timestamp",
      "Tag",
      "Event",
      "Status",
      "User",
      "Device",
      "Location",
      "Unit No.",
    ];
    // widths chosen to fit typical page width (usable width ~ 532)
    // Rebalanced so `Unit No.` column has more room and won't overflow.
    // New sum: 110 + 60 + 50 + 50 + 100 + 40 + 60 + 60 = 530
    const colWidths = [110, 60, 50, 50, 100, 40, 60, 60];

    const tableRows = scans.value.map((scan) => [
      scan.scanTime
        ? new Date(scan.scanTime).toLocaleString(undefined, {
            timeZone: TIME_ZONE,
          })
        : "—",
      scan.rfidTagId ?? "—",
      String(scan.eventType ?? "—"),
      String(scan.status ?? "—"),
      String(scan.user?.name ?? "—"),
      String(scan.deviceId ?? "—"),
      String(scan.location ?? "—"),
      String(resolveScanUnitNumber(scan) ?? "—"),
    ]);

    // Draw up to 100 rows per page (keeps PDF readable and matches dashboard approach)
    if (tableRows.length <= 100) {
      const historyResult = drawTable(
        scanHistoryPage,
        headers,
        tableRows,
        scanHistoryStartY,
        colWidths
      );
      // adopt final page in case drawTable paged internally
      scanHistoryPage = historyResult.page;
    } else {
      // draw first 100 rows on the current scanHistoryPage
      const firstResult = drawTable(
        scanHistoryPage,
        headers,
        tableRows.slice(0, 100),
        scanHistoryStartY,
        colWidths
      );
      scanHistoryPage = firstResult.page;
      const remaining = tableRows.slice(100);
      for (let i = 0; i < remaining.length; i += 100) {
        const { page: additionalPage } = addPage(
          `Scan History (Cont.) - ${rangeLabel.value}`
        );
        const partResult = drawTable(
          additionalPage,
          headers,
          remaining.slice(i, i + 100),
          720,
          colWidths
        );
        // adopt final page in case drawTable mutated it
        scanHistoryPage = partResult.page;
      }
    }

    const pdfBytes = await pdfDoc.save();
    const pdfBuffer = new ArrayBuffer(pdfBytes.byteLength);
    new Uint8Array(pdfBuffer).set(pdfBytes);
    const blob = new Blob([pdfBuffer], { type: "application/pdf" });
    // Create blob URL and show preview modal instead of immediate download
    pdfBlobUrl.value = URL.createObjectURL(blob as Blob);
    pdfPreviewModal.value = true;
  } catch (error: any) {
    console.error("Failed to generate PDF", error);
    errorMessage.value =
      error?.message ||
      "We couldn't generate the PDF. Please retry or reduce the date range.";
  } finally {
    pdfLoading.value = false;
  }
};

onMounted(() => {
  fetchHistory();
});

onUnmounted(() => {
  // No-op: live queue polling removed from this view
});

const downloadCsv = async () => {
  if (!hasScans.value) return;

  const generationDate = new Date().toLocaleString(undefined, {
    timeZone: TIME_ZONE,
  });

  const selectedEventOption = EVENT_OPTIONS.find(
    (opt) => opt.value === eventFilter.value
  );
  const eventFilterLabel = selectedEventOption
    ? selectedEventOption.label
    : "All Events";

  const metadata = [
    ["Report Type", "RFID Scan History"],
    ["Generated By", "System"],
    ["Generated Date", generationDate],
    ["Date Range", rangeLabel.value],
    ["Event Filter", eventFilterLabel],
    ["Result Limit", limit.value.toString()],
    ["Total Records", totals.value.total.toString()],
    ["", ""], // Empty row for separation
  ];

  const headers = [
    "Timestamp (Local)",
    "Timestamp (UTC)",
    "Tag ID",
    "Event Type",
    "Status",
    "User Name",
    "User Email",
    "User Role",
    "Device ID",
    "Location",
    "Unit Number",
  ];
  // Try to build a user email lookup so we can enrich rows where scan.user.email is missing
  let userEmailById: Record<string, string | undefined> = {};
  try {
    const allUsers = await userService.getUsers({ includeRfids: false });
    if (Array.isArray(allUsers)) {
      allUsers.forEach((u: any) => {
        if (u?.id != null) userEmailById[String(u.id)] = u.email;
      });
    }
  } catch (err) {
    // If user lookup fails, just continue; some emails may stay empty
    console.warn("Failed to fetch users for CSV email enrichment", err);
  }

  const rows = scans.value.map((scan) => [
    scan.scanTime
      ? new Date(scan.scanTime).toLocaleString(undefined, {
          timeZone: TIME_ZONE,
        })
      : "N/A",
    scan.scanTime || "N/A",
    scan.rfidTagId || "N/A",
    scan.eventType || "N/A",
    scan.status || "N/A",
    scan.user?.name || "N/A",
    // Enriched email: prefer scan.user.email, then a lookup by userId or scan.user.id
    (() => {
      const u = scan.user as any;
      const maybeEmail =
        u?.email ||
        (typeof u?.id !== "undefined" && userEmailById[String(u.id)]) ||
        (typeof (scan as any).userId !== "undefined" &&
          userEmailById[String((scan as any).userId)]);
      return maybeEmail || "N/A";
    })(),
    scan.user?.role || "N/A",
    scan.deviceId || "N/A",
    scan.location || "N/A",
    resolveScanUnitNumber(scan) || "N/A",
  ]);

  try {
    const blob = buildCsvBlob([...metadata, headers, ...rows]);

    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.href = url;
    link.download = `rfid-scans-${startDate.value}-to-${endDate.value}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    try {
      URL.revokeObjectURL(url);
    } catch (_) {
      // ignore
    }
    toastSuccess("RFID scans CSV downloaded");
  } catch (err: any) {
    console.error("Failed to generate CSV", err);
    toastError &&
      toastError(
        "Failed to generate CSV: " + ((err as any)?.message || "Unknown")
      );
  }
};

const cancelPdfPreview = () => {
  if (pdfBlobUrl.value) {
    try {
      URL.revokeObjectURL(pdfBlobUrl.value);
    } catch (e) {
      // ignore
    }
  }
  pdfBlobUrl.value = null;
  pdfPreviewModal.value = false;
};

const downloadPdfFromPreview = () => {
  if (!pdfBlobUrl.value) return;

  const link = document.createElement("a");
  link.href = pdfBlobUrl.value;
  link.download = `rfid-scans-${startDate.value}-to-${endDate.value}.pdf`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  // Close modal after download
  cancelPdfPreview();
};
</script>

<template>
  <div class="space-y-6">
    <div>
      <h1 class="text-3xl font-bold">RFID Scan History</h1>
      <p class="text-base-content/70">
        Review historical RFID scans, filter by event type and date range, and
        export a PDF report for compliance or audits.
      </p>
    </div>

    <!-- Live Queue section removed — Dashboard has the matrix view -->

    <div class="card bg-base-200 shadow">
      <div class="card-body space-y-4">
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
          <label class="form-control w-full">
            <span class="label-text">Start Date</span>
            <input
              v-model="startDate"
              type="date"
              class="input input-bordered"
              :max="endDate"
            />
          </label>

          <label class="form-control w-full">
            <span class="label-text">End Date</span>
            <input
              v-model="endDate"
              type="date"
              class="input input-bordered"
              :min="startDate"
            />
          </label>

          <label class="form-control w-full">
            <span class="label-text">Event Type</span>
            <select v-model="eventFilter" class="select select-bordered">
              <option
                v-for="option in EVENT_OPTIONS"
                :key="option.value"
                :value="option.value"
              >
                {{ option.label }}
              </option>
            </select>
          </label>

          <label class="form-control w-full">
            <span class="label-text">Result Limit</span>
            <select v-model.number="limit" class="select select-bordered">
              <option
                v-for="value in LIMIT_OPTIONS"
                :key="value"
                :value="value"
              >
                {{ value.toLocaleString() }} rows
              </option>
            </select>
          </label>
        </div>

        <div class="flex flex-wrap gap-2">
          <span class="label-text">Quick ranges:</span>
          <button class="btn btn-xs" @click="quickRange(7)">Last 7 days</button>
          <button class="btn btn-xs" @click="quickRange(14)">
            Last 14 days
          </button>
          <button class="btn btn-xs" @click="quickRange(30)">
            Last 30 days
          </button>
        </div>

        <div class="flex flex-wrap gap-2 justify-end">
          <button
            class="btn"
            :class="{ 'btn-disabled': loading }"
            :disabled="loading"
            @click="fetchHistory"
          >
            <span
              v-if="loading"
              class="loading loading-spinner loading-sm"
            ></span>
            <span>Apply Filters</span>
          </button>
          <button
            class="btn btn-primary"
            :disabled="!hasScans || pdfLoading"
            @click="downloadPdf"
          >
            <span
              v-if="pdfLoading"
              class="loading loading-spinner loading-sm"
            ></span>
            <span v-else>Download PDF</span>
          </button>
          <button
            class="btn btn-secondary"
            :disabled="!hasScans"
            @click="downloadCsv"
          >
            Download CSV
          </button>
        </div>
      </div>
    </div>

    <div v-if="errorMessage" class="alert alert-error">
      {{ errorMessage }}
    </div>

    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      <div class="stat bg-base-200 rounded-box">
        <div class="stat-title">Total scans</div>
        <div class="stat-value text-primary">{{ totals.total }}</div>
        <div class="stat-desc">{{ rangeLabel }}</div>
      </div>
      <div class="stat bg-base-200 rounded-box">
        <div class="stat-title">Successful</div>
        <div class="stat-value text-success">{{ totals.success }}</div>
        <div class="stat-desc">In selected range</div>
      </div>
      <div class="stat bg-base-200 rounded-box">
        <div class="stat-title">Failed</div>
        <div class="stat-value text-warning">{{ totals.failed }}</div>
        <div class="stat-desc">Unregistered tags</div>
      </div>
      <div class="stat bg-base-200 rounded-box">
        <div class="stat-title">Unauthorized</div>
        <div class="stat-value text-error">{{ totals.unauthorized }}</div>
        <div class="stat-desc">Inactive cards/users</div>
      </div>
    </div>

    <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
      <div class="card bg-base-200 shadow">
        <div class="card-body">
          <h2 class="card-title mb-4">Status Composition</h2>
          <div class="h-64">
            <Suspense>
              <template #default>
                <Pie :data="statusPieData" :options="statusPieOptions" />
              </template>
              <template #fallback>
                <div class="flex items-center justify-center h-64">
                  <span class="loading loading-spinner loading-lg"></span>
                </div>
              </template>
            </Suspense>
          </div>
        </div>
      </div>

      <div class="card bg-base-200 shadow">
        <div class="card-body">
          <h2 class="card-title mb-4">Event Breakdown</h2>
          <div class="h-64">
            <Suspense>
              <template #default>
                <Bar :data="eventBarData" :options="eventBarOptions" />
              </template>
              <template #fallback>
                <div class="flex items-center justify-center h-64">
                  <span class="loading loading-spinner loading-lg"></span>
                </div>
              </template>
            </Suspense>
          </div>
        </div>
      </div>
    </div>

    <div class="card shadow bg-base-100">
      <div class="card-body">
        <div class="flex flex-wrap items-center justify-between gap-2 mb-4">
          <h2 class="card-title">Scan Results</h2>
          <span v-if="lastFetchedAt" class="text-sm text-base-content/70">
            Last refreshed: {{ formatDisplayDate(lastFetchedAt) }}
          </span>
        </div>

        <div v-if="loading" class="py-20 flex justify-center">
          <span class="loading loading-spinner loading-lg"></span>
        </div>

        <div
          v-else-if="!hasScans"
          class="py-20 text-center text-base-content/70"
        >
          No scans found for the selected filters.
        </div>

        <div v-else class="space-y-4">
          <div class="flex flex-wrap items-center justify-between gap-2">
            <span class="text-sm text-base-content/70">
              Showing
              {{
                Math.min(
                  pageSize,
                  Math.max(scanCount - (currentPage - 1) * pageSize, 0)
                )
              }}
              of
              {{ scanCount }}
              scans
            </span>
            <div class="flex items-center gap-2">
              <select
                v-model.number="pageSize"
                class="select select-sm select-bordered w-28"
              >
                <option :value="10">10 / page</option>
                <option :value="25">25 / page</option>
                <option :value="50">50 / page</option>
              </select>
              <div class="join">
                <button
                  class="join-item btn btn-sm"
                  :disabled="currentPage === 1"
                  @click="currentPage--"
                >
                  « Prev
                </button>
                <button class="join-item btn btn-sm" disabled>
                  Page {{ currentPage }} / {{ totalPages }}
                </button>
                <button
                  class="join-item btn btn-sm"
                  :disabled="currentPage === totalPages"
                  @click="currentPage++"
                >
                  Next »
                </button>
              </div>
            </div>
          </div>

          <div class="overflow-x-auto">
            <table class="table table-zebra w-full responsive-table">
              <thead>
                <tr>
                  <th>Timestamp</th>
                  <th>Tag ID</th>
                  <th>Event</th>
                  <th>Status</th>
                  <th>User</th>
                  <th class="hidden sm:table-cell">Device</th>
                  <th class="hidden md:table-cell">Location</th>
                  <th class="hidden md:table-cell">Unit No.</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="scan in paginatedScans" :key="scan.id">
                  <td data-label="Timestamp">
                    {{ formatDateCell(scan.scanTime) }}
                  </td>
                  <td data-label="Tag" class="whitespace-normal break-words">
                    {{ scan.rfidTagId }}
                  </td>
                  <td data-label="Event">
                    <span class="badge badge-outline capitalize">
                      {{ scan.eventType }}
                    </span>
                  </td>
                  <td data-label="Status">
                    <span
                      class="badge"
                      :class="{
                        'badge-success': scan.status === 'success',
                        'badge-error': scan.status === 'unauthorized',
                        'badge-warning': scan.status === 'failed',
                      }"
                    >
                      {{ scan.status }}
                    </span>
                  </td>
                  <td data-label="User" class="whitespace-normal break-words">
                    {{ scan.user?.name ?? "—" }}
                  </td>
                  <td class="hidden sm:table-cell" data-label="Device">
                    {{ scan.deviceId ?? "—" }}
                  </td>
                  <td class="hidden md:table-cell" data-label="Location">
                    {{ scan.location ?? "—" }}
                  </td>
                  <td class="hidden md:table-cell" data-label="Unit No.">
                    {{ resolveScanUnitNumber(scan) ?? "—" }}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
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
              Download PDF
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
