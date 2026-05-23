import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { supabase } from '@/lib/supabase';

const TIMEZONES = [
  'America/Chicago',
  'America/New_York',
  'America/Denver',
  'America/Los_Angeles',
  'America/Phoenix',
  'America/Anchorage',
  'Pacific/Honolulu',
];

const schema = z.object({
  name: z.string().min(2, 'Name is required'),
  ein: z.string().optional(),
  address_line1: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  postal_code: z.string().optional(),
  country: z.string().default('US'),
  default_tz: z.string(),
  resend_from_email: z.string().email().optional().or(z.literal('')),
  resend_from_name: z.string().optional(),
  receipt_signatory_name: z.string().optional(),
  receipt_disclaimer: z.string().optional(),
});
type FormValues = z.infer<typeof schema>;

export function CharityNew() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<FormValues>({
    defaultValues: {
      country: 'US',
      default_tz: 'America/Chicago',
      receipt_disclaimer: 'No goods or services were provided in exchange for this contribution.',
    },
  });

  const create = useMutation({
    mutationFn: async (values: FormValues) => {
      const parsed = schema.parse(values);
      const payload = {
        ...parsed,
        resend_from_email: parsed.resend_from_email || null,
      };
      const { data, error } = await supabase
        .from('charities')
        .insert(payload)
        .select('id')
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: async (data) => {
      await qc.invalidateQueries({ queryKey: ['charities'] });
      navigate(`/admin/charities/${data.id}`);
    },
  });

  async function onSubmit(values: FormValues) {
    await create.mutateAsync(values);
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-6 space-y-4">
      <h1 className="text-xl font-semibold">New charity</h1>
      <form onSubmit={handleSubmit(onSubmit)} className="card space-y-4">
        <Field label="Name" error={errors.name?.message}>
          <input className="field" {...register('name')} autoFocus />
        </Field>
        <Field label="EIN (tax ID)">
          <input className="field" {...register('ein')} placeholder="12-3456789" />
        </Field>
        <Field label="Address">
          <input className="field" {...register('address_line1')} placeholder="123 Main St" />
        </Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label="City"><input className="field" {...register('city')} /></Field>
          <Field label="State"><input className="field" {...register('state')} /></Field>
          <Field label="ZIP"><input className="field" {...register('postal_code')} /></Field>
        </div>
        <Field label="Default time zone">
          <select className="field" {...register('default_tz')}>
            {TIMEZONES.map((tz) => <option key={tz} value={tz}>{tz}</option>)}
          </select>
        </Field>
        <Field label="Resend 'from' email" error={errors.resend_from_email?.message}>
          <input className="field" type="email" {...register('resend_from_email')} placeholder="receipts@yourcharity.org" />
        </Field>
        <Field label="Resend 'from' name">
          <input className="field" {...register('resend_from_name')} placeholder="Your Charity Name" />
        </Field>
        <Field label="Signatory (on receipts)">
          <input className="field" {...register('receipt_signatory_name')} />
        </Field>
        <Field label="Receipt disclaimer">
          <textarea className="field" rows={3} {...register('receipt_disclaimer')} />
        </Field>
        {create.error && (
          <p className="text-red-600 text-sm">{(create.error as Error).message}</p>
        )}
        <button type="submit" className="btn-primary w-full" disabled={isSubmitting}>
          {isSubmitting ? 'Creating...' : 'Create charity'}
        </button>
      </form>
    </div>
  );
}

function Field({ label, error, children }: { label: string; error?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="label">{label}</label>
      {children}
      {error && <p className="text-xs text-red-600 mt-1">{error}</p>}
    </div>
  );
}
