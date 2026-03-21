// services/notifications.ts
import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';

// ── Notification IDs ──────────────────────────────────────────────────────
export const NOTIF_IDS = {
  PENDING_REC:    'aroma_pending_rec',
  UNRATED_LOG:    'aroma_unrated_log',
  DAILY_REMINDER: 'aroma_daily_reminder',
  CAFFEINE_LIMIT: 'aroma_caffeine_limit',
  WEEKLY_RECAP:   'aroma_weekly_recap',
  WELCOME:        'aroma_welcome',
};

const STORAGE_KEYS = {
  REC_NOTIF_SCHEDULED_AT:  'notif_rec_scheduled_at',
  LOG_NOTIF_SCHEDULED_AT:  'notif_log_scheduled_at',
  CAFFEINE_NOTIF_FIRED_AT: 'notif_caffeine_fired_at',
  WELCOME_NOTIF_SENT:      'notif_welcome_sent',
};

// ── Foreground handler ────────────────────────────────────────────────────
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList:   true,
    shouldPlaySound:  false,
    shouldSetBadge:   false,
  }),
});

// ── Request permissions ───────────────────────────────────────────────────
export async function requestNotificationPermissions(): Promise<boolean> {
  const { status: existing } = await Notifications.getPermissionsAsync();
  if (existing === 'granted') return true;

  const { status } = await Notifications.requestPermissionsAsync();
  if (status !== 'granted') {
    console.log('[Notifications] Permission denied');
    return false;
  }

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('aroma-default', {
      name:             'Aroma reminders',
      importance:       Notifications.AndroidImportance.DEFAULT,
      vibrationPattern: [0, 200],
      lightColor:       '#C8A882',
    });
  }

  return true;
}

// ── Cancel helpers ────────────────────────────────────────────────────────
export async function cancelNotification(id: string): Promise<void> {
  await Notifications.cancelScheduledNotificationAsync(id);
}

export async function cancelAllNotifications(): Promise<void> {
  await Notifications.cancelAllScheduledNotificationsAsync();
}

// ─────────────────────────────────────────────────────────────────────────
// 1. WELCOME NOTIFICATION  (15 seconds after first landing on home screen)
//
//    Two guards must both pass before the notification is scheduled:
//
//    Guard 1 — AsyncStorage flag: ensures we only ever schedule it once per
//    device, even if the focus callback fires multiple times.
//
//    Guard 2 — Account age: the Firestore createdAt timestamp must be within
//    the last 5 minutes. This prevents existing users who have never triggered
//    the flag from receiving it when they update the app or re-login.
//    If createdAt is missing or cannot be read, the notification is skipped.
// ─────────────────────────────────────────────────────────────────────────
export async function scheduleWelcomeNotification(
  userId: string,
  createdAt: Date | null
): Promise<void> {
  // Guard 1: AsyncStorage — skip if already sent on this device
  const storageKey  = `${STORAGE_KEYS.WELCOME_NOTIF_SENT}_${userId}`;
  const alreadySent = await AsyncStorage.getItem(storageKey);
  if (alreadySent) {
    console.log('[Notifications] Welcome notification already sent — skipping');
    return;
  }

  // Guard 2: Account age — only send if the account was created within the
  // last 5 minutes. This is the primary protection against existing users
  // receiving the welcome notification after an app update or re-login.
  if (!createdAt) {
    console.log('[Notifications] Welcome notification skipped — no createdAt timestamp available');
    return;
  }

  const FIVE_MINUTES_MS  = 5 * 60 * 1000;
  const accountAgeMs     = Date.now() - createdAt.getTime();

  if (accountAgeMs > FIVE_MINUTES_MS) {
    console.log(
      `[Notifications] Welcome notification skipped — account is ${Math.round(accountAgeMs / 1000)}s old (limit: 300s)`
    );
    // Mark as sent so we never check again on this device for this user
    await AsyncStorage.setItem(storageKey, 'skipped_account_too_old');
    return;
  }

  const hasPermission = await requestNotificationPermissions();
  if (!hasPermission) return;

  // Mark as sent before scheduling so a second call while the 15s are
  // counting down cannot schedule a duplicate
  await AsyncStorage.setItem(storageKey, new Date().toISOString());
  await cancelNotification(NOTIF_IDS.WELCOME);

  await Notifications.scheduleNotificationAsync({
    identifier: NOTIF_IDS.WELCOME,
    content: {
      title: 'Welcome to Aroma',
      body:  'Head to your profile to set a daily caffeine limit and update your personal details. The more you log and rate, the better your recommendations will get.',
      data:  { type: 'welcome', screen: '/(tabs)/profile' },
    },
    trigger: {
      type:    Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
      seconds: 15,
      repeats: false,
    },
  });

  console.log(
    `[Notifications] Welcome notification scheduled in 15s (account age: ${Math.round(accountAgeMs / 1000)}s)`
  );
}

// ─────────────────────────────────────────────────────────────────────────
// 2. PENDING RECOMMENDATION REMINDER  (15 min)
// ─────────────────────────────────────────────────────────────────────────
export async function schedulePendingRecNotification(drinkName: string): Promise<void> {
  const hasPermission = await requestNotificationPermissions();
  if (!hasPermission) return;

  await cancelNotification(NOTIF_IDS.PENDING_REC);
  await AsyncStorage.setItem(STORAGE_KEYS.REC_NOTIF_SCHEDULED_AT, new Date().toISOString());

  await Notifications.scheduleNotificationAsync({
    identifier: NOTIF_IDS.PENDING_REC,
    content: {
      title: 'Your recommendation is waiting',
      body:  `Did you get a chance to try your ${drinkName}? Log it and let us know what you thought.`,
      data:  { type: 'pending_rec', screen: '/(tabs)' },
    },
    trigger: {
      type:    Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
      seconds: 15 * 60,
      repeats: false,
    },
  });

  console.log(`[Notifications] Pending rec reminder scheduled for "${drinkName}"`);
}

export async function cancelPendingRecNotification(): Promise<void> {
  await cancelNotification(NOTIF_IDS.PENDING_REC);
  await AsyncStorage.removeItem(STORAGE_KEYS.REC_NOTIF_SCHEDULED_AT);
  console.log('[Notifications] Pending rec reminder cancelled');
}

// ─────────────────────────────────────────────────────────────────────────
// 3. UNRATED LOG REMINDER  (15 min)
//    Fires whenever there are unrated drinks in the log.
//    Cancelled when all drinks are rated.
// ─────────────────────────────────────────────────────────────────────────
export async function scheduleUnratedLogNotification(unratedCount: number): Promise<void> {
  const hasPermission = await requestNotificationPermissions();
  if (!hasPermission) return;

  await cancelNotification(NOTIF_IDS.UNRATED_LOG);
  await AsyncStorage.setItem(STORAGE_KEYS.LOG_NOTIF_SCHEDULED_AT, new Date().toISOString());

  const drinkWord = unratedCount === 1 ? 'drink' : 'drinks';

  await Notifications.scheduleNotificationAsync({
    identifier: NOTIF_IDS.UNRATED_LOG,
    content: {
      title: 'You have unrated drinks',
      body:  `You have ${unratedCount} unrated ${drinkWord} in your log. Head back and rate ${unratedCount === 1 ? 'it' : 'them'} to improve your recommendations.`,
      data:  { type: 'unrated_log', screen: '/(tabs)/log' },
    },
    trigger: {
      type:    Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
      seconds: 15 * 60,
      repeats: false,
    },
  });

  console.log(`[Notifications] Unrated log reminder scheduled (${unratedCount} unrated)`);
}

export async function cancelUnratedLogNotification(): Promise<void> {
  await cancelNotification(NOTIF_IDS.UNRATED_LOG);
  await AsyncStorage.removeItem(STORAGE_KEYS.LOG_NOTIF_SCHEDULED_AT);
  console.log('[Notifications] Unrated log reminder cancelled');
}

// ─────────────────────────────────────────────────────────────────────────
// 4. DAILY MORNING REMINDER  (every day at 08:00)
// ─────────────────────────────────────────────────────────────────────────
export async function scheduleDailyReminder(): Promise<void> {
  const hasPermission = await requestNotificationPermissions();
  if (!hasPermission) return;

  await cancelNotification(NOTIF_IDS.DAILY_REMINDER);

  await Notifications.scheduleNotificationAsync({
    identifier: NOTIF_IDS.DAILY_REMINDER,
    content: {
      title: 'Good morning',
      body:  'Start your day right. Remember to log your drinks and rate them as you go.',
      data:  { type: 'daily_reminder', screen: '/(tabs)' },
    },
    trigger: {
      type:   Notifications.SchedulableTriggerInputTypes.DAILY,
      hour:   8,
      minute: 0,
    },
  });

  console.log('[Notifications] Daily reminder scheduled at 08:00');
}

export async function cancelDailyReminder(): Promise<void> {
  await cancelNotification(NOTIF_IDS.DAILY_REMINDER);
  console.log('[Notifications] Daily reminder cancelled');
}

// ─────────────────────────────────────────────────────────────────────────
// 5. CAFFEINE LIMIT EXCEEDED  (10 min)
//    Fires at most once per calendar day.
// ─────────────────────────────────────────────────────────────────────────
export async function scheduleCaffeineLimitNotification(
  limitMg: number,
  currentMg: number
): Promise<void> {
  const hasPermission = await requestNotificationPermissions();
  if (!hasPermission) return;

  const scheduledAt = await AsyncStorage.getItem(STORAGE_KEYS.CAFFEINE_NOTIF_FIRED_AT);
  if (scheduledAt) {
    const today        = new Date().toISOString().slice(0, 10);
    const scheduledDay = scheduledAt.slice(0, 10);
    if (scheduledDay === today) {
      console.log('[Notifications] Caffeine limit notification already scheduled today — skipping');
      return;
    }
  }

  await AsyncStorage.setItem(STORAGE_KEYS.CAFFEINE_NOTIF_FIRED_AT, new Date().toISOString());
  await cancelNotification(NOTIF_IDS.CAFFEINE_LIMIT);

  await Notifications.scheduleNotificationAsync({
    identifier: NOTIF_IDS.CAFFEINE_LIMIT,
    content: {
      title: 'Caffeine limit reached',
      body:  `You have had ${currentMg}mg of caffeine today, which is over your ${limitMg}mg limit. Consider switching to decaf or a low-caffeine option for the rest of the day.`,
      data:  { type: 'caffeine_limit', screen: '/(tabs)/log' },
    },
    trigger: {
      type:    Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
      seconds: 10 * 60,
      repeats: false,
    },
  });

  console.log(`[Notifications] Caffeine limit notification scheduled (${currentMg}mg / ${limitMg}mg)`);
}

// ─────────────────────────────────────────────────────────────────────────
// 6. WEEKLY RECAP  (every Sunday at 19:00)
// ─────────────────────────────────────────────────────────────────────────
export async function scheduleWeeklyRecap(): Promise<void> {
  const hasPermission = await requestNotificationPermissions();
  if (!hasPermission) return;

  await cancelNotification(NOTIF_IDS.WEEKLY_RECAP);

  await Notifications.scheduleNotificationAsync({
    identifier: NOTIF_IDS.WEEKLY_RECAP,
    content: {
      title: 'End of the week',
      body:  'Take a look at what you drank this week. Rate any unrated drinks and get a fresh recommendation to start next week with.',
      data:  { type: 'weekly_recap', screen: '/(tabs)/log' },
    },
    trigger: {
      type:    Notifications.SchedulableTriggerInputTypes.WEEKLY,
      weekday: 1,
      hour:    19,
      minute:  0,
    },
  });

  console.log('[Notifications] Weekly recap scheduled for Sunday 19:00');
}

export async function cancelWeeklyRecap(): Promise<void> {
  await cancelNotification(NOTIF_IDS.WEEKLY_RECAP);
}

// ─────────────────────────────────────────────────────────────────────────
// SETUP — call once at app startup from _layout.tsx
// ─────────────────────────────────────────────────────────────────────────
export async function setupNotifications(): Promise<void> {
  const granted = await requestNotificationPermissions();
  if (!granted) return;

  await scheduleDailyReminder();
  await scheduleWeeklyRecap();

  console.log('[Notifications] Setup complete');
}