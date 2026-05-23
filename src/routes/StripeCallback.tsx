import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { edgeFunctions } from '@/lib/edgeFunctions';

export function StripeCallback() {
  const { id } = useParams<{ id: string }>();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [status, setStatus] = useState<'pending' | 'ok' | 'error'>('pending');
  const [message, setMessage] = useState<string>('');

  useEffect(() => {
    const code = params.get('code');
    const error = params.get('error');
    if (error) {
      setStatus('error');
      setMessage(params.get('error_description') ?? error);
      return;
    }
    if (!code || !id) {
      setStatus('error');
      setMessage('Missing code or charity id.');
      return;
    }
    edgeFunctions
      .stripeConnect({ action: 'callback', charity_id: id, code })
      .then(() => {
        setStatus('ok');
        setTimeout(() => navigate(`/admin/charities/${id}`), 1500);
      })
      .catch((err) => {
        setStatus('error');
        setMessage(err instanceof Error ? err.message : String(err));
      });
  }, [id, params, navigate]);

  return (
    <div className="mx-auto max-w-md px-4 py-12 text-center space-y-3">
      {status === 'pending' && <p className="text-ink-500 dark:text-ink-400">Finishing Stripe setup...</p>}
      {status === 'ok' && (
        <>
          <p className="text-lg font-semibold">Stripe connected.</p>
          <p className="text-sm text-ink-500 dark:text-ink-400">Redirecting...</p>
        </>
      )}
      {status === 'error' && (
        <>
          <p className="text-lg font-semibold text-red-600">Stripe setup failed</p>
          <p className="text-sm text-ink-500 dark:text-ink-400">{message}</p>
          <button type="button" className="btn-ghost" onClick={() => navigate(`/admin/charities/${id}`)}>
            Back to charity
          </button>
        </>
      )}
    </div>
  );
}
