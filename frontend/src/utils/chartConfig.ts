let chartSetupPromise: Promise<void> | null = null;

const ensureChartSetup = async (): Promise<void> => {
  if (chartSetupPromise) {
    return chartSetupPromise;
  }

  chartSetupPromise = import("chart.js").then((chartJs) => {
    const {
      Chart,
      Title,
      Tooltip,
      Legend,
      BarElement,
      CategoryScale,
      LinearScale,
      PointElement,
      LineElement,
      ArcElement,
      Filler,
    } = chartJs;

    // Register Chart.js components once, lazily, when charts are actually requested.
    Chart.register(
      CategoryScale,
      LinearScale,
      BarElement,
      PointElement,
      LineElement,
      ArcElement,
      Filler,
      Title,
      Tooltip,
      Legend
    );
  });

  return chartSetupPromise;
};

// Export commonly used chart components for lazy loading
export const ChartComponents = {
  Bar: async () => {
    await ensureChartSetup();
    return import("vue-chartjs").then((m) => m.Bar);
  },
  Line: async () => {
    await ensureChartSetup();
    return import("vue-chartjs").then((m) => m.Line);
  },
  Pie: async () => {
    await ensureChartSetup();
    return import("vue-chartjs").then((m) => m.Pie);
  },
};
