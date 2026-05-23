import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/auth/AuthProvider';
import { supabase } from '@/lib/supabase';
import {
  disablePush,
  ensureSubscription,
  isIOS,
  isStandalone,
  notificationPermission,
  pushSupported,
  saveSubscription,
} from '@/lib/push';

type Prefs = {
  followups_due: boolean;
  update_queue_weekly: boolean;
  new_donation: boolean;
  invited_to_charity: boolean;
};

export function SettingsPage() {
  const { user, signOut } = useAuth();
  const qc = useQueryClient();

  const prefsQuery = useQuery({
    queryKey: ['prefs', user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('notification_preferences')
        .select('*')
        .eq('user_id', user!.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const updatePrefs = useMutation({
    mutationFn: async (patch: Partial<Prefs>) => {
      const { error } = await supabase
        .from('notification_preferences')
        .upsert({ user_id: user!.id, ...patch }, { onConflict: 'user_id' });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['prefs', user?.id] }),
  });

  const [perm, setPerm] = useState(notificationPermission());
  const [isSubscribed, setIsSubscribed] = useState<boolean | null>(null);
  const [pushError, setPushError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    if (!pushSupported()) {
      setIsSubscribed(false);
      return;
    }
    navigator.serviceWorker.ready.then(async (reg) => {
      const sub = await reg.pushManager.getSubscription();
      if (mounted) setIsSubscribed(!!sub);
    });
    return () => {
      mounted = false;
    };
  }, []);

  async function enable() {
    try {
      setPushError(null);
      const sub = await ensureSubscription();
      if (!sub) {
        setPerm(notificationPermission());
        return;
      }
      await saveSubscription(sub);
      setIsSubscribed(true);
      setPerm('granted');
    } catch (err) {
      setPushError(err instanceof Error ? err.message : String(err));
    }
  }

  async function disable() {
    try {
      setPushError(null);
      await disablePush();
      setIsSubscribed(false);
    } catch (err) {
      setPushError(err instanceof Error ? err.message : String(err));
    }
  }

  const standalone = isStandalone();
  const ios = isIOS();

  return (
    <div className="mx-auto max-w-2xl px-4 py-6 space-y-4">
      <h1 className="text-xl font-semibold">Settings</h1>

      <section className="card space-y-3">
        <div>
          <h2 className="font-semibold">Account</h2>
          <p className="text-sm text-ink-500">{user?.email}</p>
        </div>
        <button type="button" className="btn-ghost w-full" onClick={() => signOut()}>
          Sign out
        </button>
      </section>

      <section className="card space-y-3">
        <h2 className="font-semibold">Notifications</h2>
        {!pushSupported() ? (
          <p className="text-sm text-ink-500">
            This browser does not support push notifications.
          </p>
        ) : ios && !standalone ? (
          <p className="text-sm text-ink-500">
            To receive notifications on iPhone or iPad, first install the app via Share -&gt; Add to Home Screen.
            Then open the installed app and tap "Enable" here.
          </p>
        ) : (
          <>
            <div className="flex items-center justify-between gap-2">
              <div>
                <p className="text-sm">
                  Status: <span className="font-medium">{isSubscribed === null ? '...' : isSubscribed ? 'Enabled' : 'Not enabled'}</span>
                </p>
                <p className="text-xs text-ink-500">Permission: {perm}</p>
              </div>
              {isSubscribed ? (
                <button type="button" className="btn-ghost" onClick={disable}>
                  Disable
                </button>
              ) : (
                <button type="button" className="btn-primary" onClick={enable} disabled={perm === 'denied'}>
                  Enable
                </button>
              )}
            </div>
            {pushError && <p className="text-red-600 text-sm">{pushError}</p>}
            {perm === 'denied' && (
              <p className="text-xs text-ink-500">
                You denied notifications. Re-enable them in your browser/OS settings, then return here.
              </p>
            )}
          </>
        )}

        {prefsQuery.data && (
          <div className="border-t border-ink-100 pt-3 space-y-3">
            <ToggleRow
              label="Daily follow-ups due"
              description="An 8am digest when you have follow-ups due today."
              checked={prefsQuery.data.followups_due}
              onChange={(v) => updatePrefs.mutate({ followups_due: v })}
            />
            <ToggleRow
              label="Weekly update reminder"
              description="Monday morning, when you have 10+ incomplete customers."
              checked={prefsQuery.data.update_queue_weekly}
              onChange={(v) => updatePrefs.mutate({ update_queue_weekly: v })}
            />
            <ToggleRow
              label="New donation by teammate"
              description="Instant notification when a charity teammate records a gift."
              checked={prefsQuery.data.new_donation}
              onChange={(v) => updatePrefs.mutate({ new_donation: v })}
            />
            <ToggleRow
              label="Invited to a new charity"
              description="When you're added to a new charity."
              checked={prefsQuery.data.invited_to_charity}
              onChange={(v) => updatePrefs.mutate({ invited_to_charity: v })}
            />
          </div>
        )}
      </section>
    </div>
  );
}

function ToggleRow({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-start justify-between gap-3">
      <div>
        <div className="text-sm font-medium">{label}</div>
        <div className="text-xs text-ink-500">{description}</div>
      </div>
      <input
        type="checkbox"
        className="mt-1 h-5 w-5"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
    </label>
  );
}
