import type { Metric } from '@relay/types';

export interface MetricInfo {
  label: string;
  unit: string;
}

/** Display metadata for each metric Relay understands. */
export const METRIC_INFO: Record<Metric, MetricInfo> = {
  temperature: { label: 'Temperature', unit: '°C' },
  humidity: { label: 'Humidity', unit: '%' },
  moisture: { label: 'Soil moisture', unit: '%' },
  flow: { label: 'Flow', unit: 'L/min' },
};

export function formatValue(value: number, metric: Metric): string {
  return `${value.toFixed(1)} ${METRIC_INFO[metric].unit}`;
}
