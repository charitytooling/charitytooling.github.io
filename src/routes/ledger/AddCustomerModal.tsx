import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { useNavigate } from 'react-router-dom';
import { Modal } from '@/components/Modal';
import { useCreateCustomer } from '@/state/customers';
import { useCreateContact } from '@/state/contacts';

const schema = z.object({
  display_name: z.string().optional(),
  first_name: z.string().optional(),
  last_name: z.string().optional(),
  email: z.string().email().optional().or(z.literal('')),
  phone: z.string().optional(),
  website: z.string().optional(),
});
type FormValues = z.infer<typeof schema>;

export function AddCustomerModal({ charityId, onClose }: { charityId: string; onClose: () => void }) {
  const navigate = useNavigate();
  const create = useCreateCustomer();
  const createContact = useCreateContact();
  const [contactWarning, setContactWarning] = useState<string | null>(null);
  const { register, handleSubmit, formState: { errors, isSubmitting } } = useForm<FormValues>();

  async function onSubmit(values: FormValues) {
    const parsed = schema.parse(values);
    setContactWarning(null);
    const created = await create.mutateAsync({
      charity_id: charityId,
      display_name: parsed.display_name || null,
      website: parsed.website || null,
    });

    // Seed a primary contact alongside the customer when any of the person
    // fields are filled in. The contact insert is best-effort: a failure
    // here leaves the customer in place and the user can add contacts
    // manually from the Contact page.
    const hasContact = !!(
      parsed.first_name ||
      parsed.last_name ||
      parsed.email ||
      parsed.phone
    );
    if (hasContact) {
      try {
        await createContact.mutateAsync({
          customer_id: created.id,
          charity_id: charityId,
          first_name: parsed.first_name || null,
          last_name: parsed.last_name || null,
          email: parsed.email || null,
          phone: parsed.phone || null,
          is_primary: true,
        });
      } catch (err) {
        setContactWarning(
          `Customer saved, but the primary contact could not be created: ${
            err instanceof Error ? err.message : String(err)
          }. Add it from the customer's page.`,
        );
        return;
      }
    }

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
        {contactWarning && (
          <p className="text-amber-700 text-sm">{contactWarning}</p>
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
