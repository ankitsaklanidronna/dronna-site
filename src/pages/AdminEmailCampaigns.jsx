import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { supabase } from '../services/supabaseClient.js';

const FEATURED_EBOOK_ID = '9efb8672-fad8-4bc1-8191-93c1c202d34c';

export function AdminEmailCampaigns() {
  const { user } = useAuth();
  const [ebooks, setEbooks] = useState([]);
  const [ebookId, setEbookId] = useState('');
  const [recipientCount, setRecipientCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [msg, setMsg] = useState('');

  const selected = useMemo(() => ebooks.find((ebook) => ebook.id === ebookId), [ebooks, ebookId]);
  const discount = selected?.mrp_inr > selected?.price_inr
    ? Math.round(((selected.mrp_inr - selected.price_inr) / selected.mrp_inr) * 100)
    : 0;

  const loadData = async () => {
    setLoading(true);
    const result = await supabase.adminWrite('list_ebook_discounts', {}, user?.access_token);
    if (result?.error) {
      setMsg('ERR: ' + result.error);
      setLoading(false);
      return;
    }
    const rows = (result?.data || []).filter((ebook) => ebook.is_active !== false);
    setEbooks(rows);
    const featured = rows.find((ebook) => ebook.id === FEATURED_EBOOK_ID)
      || rows.find((ebook) => /उत्तराखंड|uttarakhand/i.test(ebook.title || ''))
      || rows[0];
    setEbookId(featured?.id || '');
    setLoading(false);
  };

  useEffect(() => { loadData(); }, []);

  useEffect(() => {
    if (!ebookId) return;
    supabase.adminWrite('preview_ebook_promotion', { ebook_id: ebookId }, user?.access_token).then((result) => {
      if (result?.error) setMsg('ERR: ' + result.error);
      else setRecipientCount(result?.data?.recipient_count || 0);
    });
  }, [ebookId]);

  const sendCampaign = async () => {
    if (!selected || recipientCount < 1) return;
    const confirmed = window.confirm(`Send "${selected.title}" launch email to all ${recipientCount} registered Dronna user(s)?`);
    if (!confirmed) return;
    setSending(true);
    setMsg('WAIT: Promotional email campaign send ho rahi hai...');
    const result = await supabase.adminWrite('send_ebook_promotion', {
      ebook_id: selected.id,
      campaign_id: `ebook-launch-${selected.id}-${selected.price_inr}-${selected.mrp_inr}`
    }, user?.access_token);
    setSending(false);
    if (result?.error) setMsg('ERR: ' + result.error);
    else setMsg(`OK: ${result.data.sent} sent, ${result.data.skipped} already sent, ${result.data.failed_count} failed.`);
  };

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h2 className="text-xl font-black text-navy">Promotional Email</h2>
        <p className="text-sm font-semibold text-gray-500">Selected ebook ka launch offer sabhi registered Dronna users ko bhejein. Duplicate campaign emails automatically skip hongi.</p>
      </div>
      {msg && <div className={`rounded-lg border px-4 py-3 text-sm font-bold ${msg.startsWith('ERR:') ? 'border-red-200 bg-red-50 text-red-700' : msg.startsWith('WAIT:') ? 'border-yellow-200 bg-yellow-50 text-yellow-800' : 'border-green-200 bg-green-50 text-green-700'}`}>{msg}</div>}
      <div className="card space-y-5">
        <div>
          <label>Promoted ebook</label>
          <select value={ebookId} onChange={(event) => setEbookId(event.target.value)} disabled={loading}>
            {ebooks.map((ebook) => <option key={ebook.id} value={ebook.id}>{ebook.title}</option>)}
          </select>
        </div>
        {selected && <>
          <div className="rounded-xl border border-orange-200 bg-orange-50 p-4">
            <div className="text-xs font-black uppercase tracking-wide text-orange-700">Email preview</div>
            <h3 className="mt-2 text-lg font-black text-navy">नई ईबुक लॉन्च: {selected.title} - {discount}% OFF</h3>
            <p className="mt-3 text-sm font-semibold leading-6 text-gray-700">{selected.subtitle || `${selected.title} अब Dronna पर उपलब्ध है।`}</p>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <span className="text-2xl font-black text-orange-700">₹{selected.price_inr}</span>
              <span className="font-bold text-gray-400 line-through">₹{selected.mrp_inr}</span>
              <span className="rounded-full bg-green-100 px-3 py-1 text-sm font-black text-green-700">{discount}% OFF</span>
            </div>
            <p className="mt-4 text-sm font-bold text-gray-700">Email में cover image, launching offer और इस ebook का direct purchase link शामिल होगा.</p>
          </div>
          <div className="flex flex-col gap-3 rounded-xl bg-slate-50 p-4 sm:flex-row sm:items-center sm:justify-between">
            <div><div className="text-xs font-black uppercase text-gray-500">Audience</div><div className="text-lg font-black text-navy">{recipientCount} registered Dronna user(s)</div></div>
            <button className="btn-primary justify-center" disabled={sending || recipientCount < 1} onClick={sendCampaign}>{sending ? 'Sending...' : 'Review & Send'}</button>
          </div>
        </>}
      </div>
    </div>
  );
}
