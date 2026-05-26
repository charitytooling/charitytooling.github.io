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
import { useProfile, useUpdateContactSort, type ContactQueueSort } from '@/state/profile';
import { ThemeToggle } from '@/components/ThemeToggle';

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
          <p className="text-sm text-ink-500 dark:text-ink-400">{user?.email}</p>
        </div>
        <button type="button" className="btn-ghost w-full" onClick={() => signOut()}>
          Sign out
        </button>
      </section>

      <section className="card space-y-3">
        <div>
          <h2 className="font-semibold">Appearance</h2>
        </div>
        <ThemeToggle />
      </section>

      <section className="card space-y-3">
        <h2 className="font-semibold">Password</h2>
        <p className="text-xs text-ink-500 dark:text-ink-400">
          Optional. Set a password to sign in without waiting for a magic-link email.
          You can keep using magic links either way.
        </p>
        <PasswordForm />
      </section>

      <section className="card space-y-3">
        <h2 className="font-semibold">Contact queue order</h2>
        <p className="text-xs text-ink-500 dark:text-ink-400">
          Controls Previous/Next on the Contact page, and which customer opens when you tap "Contact" in the nav.
        </p>
        <ContactSortPicker />
      </section>

      <section className="card space-y-3">
        <h2 className="font-semibold">Notifications</h2>
        {!pushSupported() ? (
          <p className="text-sm text-ink-500 dark:text-ink-400">
            This browser does not support push notifications.
          </p>
        ) : ios && !standalone ? (
          <p className="text-sm text-ink-500 dark:text-ink-400">
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
                <p className="text-xs text-ink-500 dark:text-ink-400">Permission: {perm}</p>
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
              <p className="text-xs text-ink-500 dark:text-ink-400">
                You denied notifications. Re-enable them in your browser/OS settings, then return here.
              </p>
            )}
          </>
        )}

        {prefsQuery.data && (
          <div className="border-t border-ink-100 dark:border-ink-800 pt-3 space-y-3">
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
        <div className="text-xs text-ink-500 dark:text-ink-400">{description}</div>
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

const CONTACT_SORT_OPTIONS: { value: ContactQueueSort; label: string; description: string }[] = [
  {
    value: 'stalest_first',
    label: 'Last contacted - oldest first',
    description: 'Rotate through customers you haven\'t spoken to in a while.',
  },
  {
    value: 'followup_due_soonest',
    label: 'Open follow-up due - soonest',
    description: 'Work through customers with the most urgent follow-ups first.',
  },
  {
    value: 'name_az',
    label: 'Name A-Z',
    description: 'Alphabetical by display name.',
  },
  {
    value: 'newest_added',
    label: 'Date added - newest',
    description: 'Start with the most recently added customers.',
  },
  {
    value: 'random',
    label: 'Random',
    description: 'Shuffled at each page load to mix things up.',
  },
];

function ContactSortPicker() {
  const profile = useProfile();
  const update = useUpdateContactSort();
  const current: ContactQueueSort = profile.data?.contact_queue_sort ?? 'stalest_first';

  return (
    <div className="space-y-2">
      {CONTACT_SORT_OPTIONS.map((opt) => (
        <label
          key={opt.value}
          className="flex items-start gap-3 rounded-lg border border-ink-100 dark:border-ink-800 p-3 cursor-pointer hover:bg-ink-50 dark:hover:bg-ink-900"
        >
          <input
            type="radio"
            name="contact_queue_sort"
            className="mt-1 h-4 w-4"
            checked={current === opt.value}
            onChange={() => update.mutate(opt.value)}
            disabled={!profile.isSuccess || update.isPending}
          />
          <div>
            <div className="text-sm font-medium">{opt.label}</div>
            <div className="text-xs text-ink-500 dark:text-ink-400">{opt.description}</div>
          </div>
        </label>
      ))}
    </div>
  );
}

function PasswordForm() {
  const [pwd, setPwd] = useState('');
  const [confirm, setConfirm] = useState('');
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (pwd.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (pwd !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    setStatus('saving');
    try {
      const { error: err } = await supabase.auth.updateUser({ password: pwd });
      if (err) throw err;
      setStatus('saved');
      setPwd('');
      setConfirm('');
      setTimeout(() => setStatus('idle'), 2000);
    } catch (err) {
      setStatus('idle');
      setError(err instanceof Error ? err.message : 'Could not update password.');
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <div>
        <label className="label" htmlFor="new-password">New password</label>
        <input
          id="new-password"
          type="password"
          autoComplete="new-password"
          minLength={8}
          className="field"
          value={pwd}
          onChange={(e) => setPwd(e.target.value)}
        />
      </div>
      <div>
        <label className="label" htmlFor="confirm-password">Confirm password</label>
        <input
          id="confirm-password"
          type="password"
          autoComplete="new-password"
          minLength={8}
          className="field"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {status === 'saved' && <p className="text-sm text-green-700">Password updated.</p>}
      <button
        type="submit"
        className="btn-primary w-full"
        disabled={status === 'saving' || !pwd || !confirm}
      >
        {status === 'saving' ? 'Saving...' : 'Set password'}
      </button>
    </form>
  );
}
