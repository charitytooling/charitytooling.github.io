import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import type { Database } from '@/lib/database.types';

export type TemplateRow = Database['public']['Tables']['email_templates']['Row'];
export type TemplateKind = TemplateRow['kind'];

export function useTemplates(charityId: string | null, kind?: TemplateKind) {
  return useQuery({
    queryKey: ['templates', charityId, kind ?? 'all'],
    enabled: !!charityId,
    queryFn: async (): Promise<TemplateRow[]> => {
      let q = supabase.from('email_templates').select('*').eq('charity_id', charityId!);
      if (kind) q = q.eq('kind', kind);
      const { data, error } = await q.order('name');
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useUpsertTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (
      input: Database['public']['Tables']['email_templates']['Insert'] & { id?: string },
    ) => {
      const { id, ...rest } = input;
      if (id) {
        const { error } = await supabase.from('email_templates').update(rest).eq('id', id);
        if (error) throw error;
        return { id, ...rest };
      } else {
        const { data, error } = await supabase
          .from('email_templates')
          .insert(rest)
          .select()
          .single();
        if (error) throw error;
        return data;
      }
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['templates', vars.charity_id] });
    },
  });
}

export function useDeleteTemplate() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('email_templates').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['templates'] });
    },
  });
}

/**
 * Apply `{{var}}` substitutions in a template body using the customer + charity.
 */
export function renderTemplate(
  body: string,
  vars: Record<string, string | number | null | undefined>,
): string {
  return body.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key: string) => {
    const v = vars[key];
    if (v === null || v === undefined) return '';
    return String(v);
  });
}
