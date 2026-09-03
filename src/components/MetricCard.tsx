import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

interface MetricCardProps {
  label: string;
  value: string;
  detail?: string;
  accent?: 'default' | 'positive' | 'warning';
  icon?: ReactNode;
}

export function MetricCard({
  label,
  value,
  detail,
  accent = 'default',
  icon,
}: MetricCardProps) {
  return (
    <View style={[styles.card, styles[accent]]}>
      <View style={styles.heading}>
        <Text style={styles.label}>{label}</Text>
        {icon}
      </View>
      <Text style={styles.value}>{value}</Text>
      {detail ? <Text style={styles.detail}>{detail}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    width: '48%',
    minHeight: 118,
    padding: 16,
    borderWidth: 1,
    borderColor: '#dce3eb',
    borderRadius: 16,
    backgroundColor: '#ffffff',
  },
  default: {},
  positive: { borderLeftWidth: 4, borderLeftColor: '#0f9d73' },
  warning: { borderLeftWidth: 4, borderLeftColor: '#e49b22' },
  heading: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  label: {
    flex: 1,
    color: '#637083',
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  value: { color: '#14213d', fontSize: 23, fontWeight: '800', marginTop: 10 },
  detail: { color: '#637083', fontSize: 12, marginTop: 5 },
});
