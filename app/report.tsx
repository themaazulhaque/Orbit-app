import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Pressable, Alert, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { colors, spacing, typography } from '../src/theme';
import { GroupedSection } from '../src/components/GroupedSection';
import { fetchReportData, ReportType } from '../src/services/api/report';
import { generateReportPdf, shareReportPdf } from '../src/services/pdfGenerator';

function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

function formatMonthYear(year: number, month: number): string {
  const date = new Date(year, month, 1);
  return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

function formatDateDisplay(year: number, month: number, day: number): string {
  const date = new Date(year, month, day);
  return date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}

export default function ReportScreen() {
  const now = new Date();
  const [reportType, setReportType] = useState<ReportType>('daily');
  const [selectedYear, setSelectedYear] = useState(now.getFullYear());
  const [selectedMonth, setSelectedMonth] = useState(now.getMonth());
  const [selectedDay, setSelectedDay] = useState(now.getDate());
  const [generating, setGenerating] = useState(false);

  const maxDay = getDaysInMonth(selectedYear, selectedMonth);
  const clampedDay = Math.min(selectedDay, maxDay);

  const handlePrev = () => {
    if (reportType === 'daily') {
      const prev = new Date(selectedYear, selectedMonth, clampedDay - 1);
      setSelectedYear(prev.getFullYear());
      setSelectedMonth(prev.getMonth());
      setSelectedDay(prev.getDate());
    } else {
      const prev = new Date(selectedYear, selectedMonth - 1, 1);
      setSelectedYear(prev.getFullYear());
      setSelectedMonth(prev.getMonth());
    }
  };

  const handleNext = () => {
    if (reportType === 'daily') {
      const next = new Date(selectedYear, selectedMonth, clampedDay + 1);
      setSelectedYear(next.getFullYear());
      setSelectedMonth(next.getMonth());
      setSelectedDay(next.getDate());
    } else {
      const next = new Date(selectedYear, selectedMonth + 1, 1);
      setSelectedYear(next.getFullYear());
      setSelectedMonth(next.getMonth());
    }
  };

  const handleGoToToday = () => {
    const today = new Date();
    setSelectedYear(today.getFullYear());
    setSelectedMonth(today.getMonth());
    setSelectedDay(today.getDate());
  };

  const dateParam = reportType === 'daily'
    ? `${selectedYear}-${String(selectedMonth + 1).padStart(2, '0')}-${String(clampedDay).padStart(2, '0')}`
    : `${selectedYear}-${String(selectedMonth + 1).padStart(2, '0')}`;

  const displayLabel = reportType === 'daily'
    ? formatDateDisplay(selectedYear, selectedMonth, clampedDay)
    : formatMonthYear(selectedYear, selectedMonth);

  const handleGenerate = async () => {
    if (generating) return;
    setGenerating(true);

    const reportLabel = reportType === 'daily' ? 'Daily' : 'Monthly';
    console.log(`[REPORT] download started — type=${reportType}, date=${dateParam}`);

    try {
      console.log('[REPORT] requesting report data...');
      const result = await fetchReportData(reportType, dateParam);

      if (!result.ok || !result.data) {
        console.log(`[REPORT] report API failed — ${result.error}`);
        Alert.alert('Report Failed', result.error || 'Unable to generate report.');
        return;
      }

      console.log(`[REPORT] report API success — ${result.data.sessions.length} sessions, ${result.data.total_duration_minutes}min total`);
      console.log('[REPORT] generating PDF...');

      const pdfResult = await generateReportPdf(result.data);

      if (!pdfResult.ok || !pdfResult.uri) {
        console.log(`[REPORT] PDF generation failed — ${pdfResult.error}`);
        Alert.alert('PDF Error', pdfResult.error || 'Unable to create PDF file.');
        return;
      }

      console.log(`[REPORT] PDF generation completed — ${pdfResult.filename}`);
      console.log('[REPORT] preparing Android share/download...');

      const shareResult = await shareReportPdf(pdfResult.uri, reportLabel);

      if (shareResult.ok) {
        if (shareResult.savedPath) {
          console.log(`[REPORT] PDF saved to ${shareResult.savedPath}`);
          Alert.alert('Report Saved', `PDF saved to your documents:\n${shareResult.savedPath}`);
        } else {
          console.log('[REPORT] share/download completed');
        }
      } else {
        console.log(`[REPORT] share/download failed — ${shareResult.error}`);
        Alert.alert('Report Failed', shareResult.error || 'PDF was created but could not be saved.');
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      console.log(`[REPORT] unexpected error — ${msg}`);
      Alert.alert('Error', 'An unexpected error occurred. Please try again.');
    } finally {
      console.log('[REPORT] download flow completed');
      setGenerating(false);
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <Text style={styles.largeTitle}>Download Report</Text>
      </View>
      <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
        <GroupedSection header="Report Type">
          <Pressable
            style={({ pressed }) => [styles.typeRow, pressed && styles.pressed]}
            onPress={() => setReportType('daily')}
          >
            <View style={[styles.radioOuter, reportType === 'daily' && styles.radioActive]}>
              {reportType === 'daily' && <View style={styles.radioInner} />}
            </View>
            <View style={styles.typeTextContainer}>
              <Text style={styles.typeLabel}>Daily Report</Text>
              <Text style={styles.typeDescription}>Activity for a specific day</Text>
            </View>
          </Pressable>
          <View style={styles.separator} />
          <Pressable
            style={({ pressed }) => [styles.typeRow, pressed && styles.pressed]}
            onPress={() => setReportType('monthly')}
          >
            <View style={[styles.radioOuter, reportType === 'monthly' && styles.radioActive]}>
              {reportType === 'monthly' && <View style={styles.radioInner} />}
            </View>
            <View style={styles.typeTextContainer}>
              <Text style={styles.typeLabel}>Monthly Report</Text>
              <Text style={styles.typeDescription}>Activity for an entire month</Text>
            </View>
          </Pressable>
        </GroupedSection>

        <GroupedSection header="Select Date">
          <View style={styles.dateNavigator}>
            <Pressable style={styles.arrowButton} onPress={handlePrev}>
              <Ionicons name="chevron-back" size={22} color={colors.accent} />
            </Pressable>
            <View style={styles.dateDisplay}>
              <Text style={styles.dateText}>{displayLabel}</Text>
            </View>
            <Pressable style={styles.arrowButton} onPress={handleNext}>
              <Ionicons name="chevron-forward" size={22} color={colors.accent} />
            </Pressable>
          </View>
          <View style={styles.todayRow}>
            <Pressable style={styles.todayButton} onPress={handleGoToToday}>
              <Text style={styles.todayText}>Today</Text>
            </Pressable>
          </View>
        </GroupedSection>

        <GroupedSection
          header="Preview"
          footer={`The report will contain all usage sessions ${reportType === 'daily' ? 'for this day' : 'within this month'}.`}
        >
          <View style={styles.previewRow}>
            <Ionicons name="document-text-outline" size={20} color={colors.textSecondary} />
            <View style={styles.previewTextContainer}>
              <Text style={styles.previewLabel}>orbit-report-{dateParam}.pdf</Text>
              <Text style={styles.previewDescription}>
                {reportType === 'daily' ? 'Daily' : 'Monthly'} activity report
              </Text>
            </View>
          </View>
        </GroupedSection>

        <View style={styles.buttonContainer}>
          <Pressable
            style={({ pressed }) => [
              styles.downloadButton,
              pressed && styles.downloadButtonPressed,
              generating && styles.downloadButtonDisabled,
            ]}
            onPress={handleGenerate}
            disabled={generating}
          >
            {generating ? (
              <ActivityIndicator color={colors.white} size="small" />
            ) : (
              <>
                <Ionicons name="download-outline" size={20} color={colors.white} />
                <Text style={styles.downloadText}>Download Report</Text>
              </>
            )}
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  header: { paddingHorizontal: spacing.base, paddingTop: spacing.sm, paddingBottom: spacing.xs },
  largeTitle: { ...typography.largeTitle, color: colors.textPrimary },
  scrollContent: { paddingBottom: spacing.section + 100 },
  separator: { height: StyleSheet.hairlineWidth, backgroundColor: colors.borderSubtle, marginLeft: 46 },
  typeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.base,
    minHeight: 44,
    backgroundColor: colors.surface,
  },
  pressed: { backgroundColor: colors.surfaceSecondary },
  radioOuter: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  radioActive: { borderColor: colors.accent },
  radioInner: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.accent,
  },
  typeTextContainer: { flex: 1 },
  typeLabel: { ...typography.body, color: colors.textPrimary },
  typeDescription: { ...typography.caption, color: colors.textSecondary, marginTop: 1 },
  dateNavigator: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.base,
    minHeight: 44,
    backgroundColor: colors.surface,
  },
  arrowButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dateDisplay: { flex: 1, alignItems: 'center' },
  dateText: { ...typography.body, color: colors.textPrimary, fontWeight: '500' },
  todayRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surface,
  },
  todayButton: {
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.xs,
  },
  todayText: { ...typography.body, color: colors.accent },
  previewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.base,
    minHeight: 44,
    backgroundColor: colors.surface,
  },
  previewTextContainer: { flex: 1, marginLeft: spacing.md },
  previewLabel: { ...typography.body, color: colors.textPrimary },
  previewDescription: { ...typography.caption, color: colors.textSecondary, marginTop: 1 },
  buttonContainer: {
    paddingHorizontal: spacing.base,
    marginTop: spacing.xl,
  },
  downloadButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accent,
    borderRadius: 12,
    paddingVertical: 14,
    gap: spacing.sm,
  },
  downloadButtonPressed: { opacity: 0.8 },
  downloadButtonDisabled: { opacity: 0.6 },
  downloadText: { ...typography.headline, color: colors.white },
});
