'use client';

// ---------- Widget key → React component ----------
// The single place that knows which component draws which widget key.

import type { ComponentType } from 'react';
import type { WidgetKey } from '@/lib/widgets';
import {
  WelcomeWidget, VerseWidget, TodayPulseWidget, CountersWidget, QuickActionsWidget, NextEventWidget,
  type WidgetProps,
} from './CoreWidgets';
import {
  AttendanceTrendWidget, WeeklyStreakWidget, LeaderboardWidget, FollowUpWidget, PendingApprovalsWidget,
} from './ActivityWidgets';
import {
  OccasionsWidget, OnlineLiveWidget, ExamsOpenWidget, MessagesWidget, NotificationsWidget, StoreRecentWidget,
  AchievementsFeedWidget,
} from './ModuleWidgets';
import UpcomingBirthdaysWidget from '@/components/birthdays/UpcomingBirthdaysWidget';

const BirthdaysAdapter: ComponentType<WidgetProps> = () => <UpcomingBirthdaysWidget />;
const WelcomeAdapter: ComponentType<WidgetProps> = () => <WelcomeWidget />;
const CountersAdapter: ComponentType<WidgetProps> = () => <CountersWidget />;

export const WIDGET_COMPONENTS: Record<WidgetKey, ComponentType<WidgetProps>> = {
  welcome: WelcomeAdapter,
  verse: VerseWidget,
  today_pulse: TodayPulseWidget,
  counters: CountersAdapter,
  quick_actions: QuickActionsWidget,
  next_event: NextEventWidget,
  attendance_trend: AttendanceTrendWidget,
  weekly_streak: WeeklyStreakWidget,
  leaderboard: LeaderboardWidget,
  follow_up: FollowUpWidget,
  pending_approvals: PendingApprovalsWidget,
  birthdays: BirthdaysAdapter,
  occasions: OccasionsWidget,
  online_live: OnlineLiveWidget,
  exams_open: ExamsOpenWidget,
  messages_inbox: MessagesWidget,
  notifications: NotificationsWidget,
  store_recent: StoreRecentWidget,
  achievements_feed: AchievementsFeedWidget,
};

export function RenderWidget({ widgetKey, title, size }: { widgetKey: WidgetKey; title?: string; size: 'full' | 'half' }) {
  const C = WIDGET_COMPONENTS[widgetKey];
  if (!C) return null;
  return <C title={title} size={size} />;
}
