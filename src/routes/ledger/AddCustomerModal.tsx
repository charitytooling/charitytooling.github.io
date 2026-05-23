import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { useNavigate } from 'react-router-dom';
import { useCreateCustomer } from '@/state/customers';

const schema = z.object({
  display_name: z.string().optional(),
  first_name: z.string().optional(),
  last_name: z.string().optional(),
  email: z.string().email().optional().or(z.literal('')),
  phone: z.string().optional(),
  website: z.string().url().optional().or(z.literal('')),
});
type FormValues = z.infer<typeof schema>;

export function AddCustomerModal({ charityId, onClose }: { charityId: string; onClose: () => void }) {
  const navigate = useNavigate();
  const create = useCreateCustomer();
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<FormValues>();

  async function onSubmit(values: FormValues) {
    const parsed = schema.parse(values);
    const created = await create.mutateAsync({
      charity_id: charityId,
      display_name: parsed.display_name || null,
      first_name: parsed.first_name || null,
      last_name: parsed.last_name || null,
      email: parsed.email || null,
      phone: parsed.phone || null,
      website: parsed.website || null,
    });
    onClose();
    navigate(`/contact/${created.id}`);
  }

  return (
    <Modal title="Add customer" onClose={onClose}>
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-3">
        <Field label="Display name">
          <input className="field" autoFocus {...register('display_name')} />
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="First">
            <input className="field" {...register('first_name')} />
          </Field>
          <Field label="Last">
            <input className="field" {...register('last_name')} />
          </Field>
        </div>
        <Field label="Email" error={errors.email?.message}>
          <input className="field" type="email" inputMode="email" {...register('email')} />
        </Field>
        <Field label="Phone">
          <input className="field" type="tel" inputMode="tel" {...register('phone')} />
        </Field>
        <Field label="Website" error={errors.website?.message}>
          <input className="field" type="url" inputMode="url" {...register('website')} />
        </Field>
        {create.error && (
          <p className="text-red-600 text-sm">{(create.error as Error).message}</p>
        )}
        <div className="flex gap-2 pt-2">
          <button type="button" className="btn-ghost flex-1" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </button>
          <button type="submit" className="btn-primary flex-1" disabled={isSubmitting}>
            {isSubmitting ? 'Saving...' : 'Save'}
          </button>
        </div>
      </form>
    </Modal>
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

export function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-40 flex items-end sm:items-center justify-center bg-ink-900/40 px-3" onClick={onClose}>
      <div
        className="w-full max-w-md max-h-[90vh] overflow-y-auto rounded-2xl bg-white p-4 shadow-xl safe-bottom"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold">{title}</h2>
          <button type="button" onClick={onClose} className="text-ink-500 text-xl leading-none">
            ×
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
