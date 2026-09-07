import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { supabase } from '../services/supabaseClient.js';
import { toPositiveInt } from '../utils/pricing.js';

function getEbookDiscount(ebook = {}) {
  const price = toPositiveInt(ebook.price_inr, 0);
  const mrp = toPositiveInt(ebook.mrp_inr, price);
  return mrp > price && price > 0 ? Math.round(((mrp - price) / mrp) * 100) : 0;
}

export function AdminEbookDiscounts() {
  const { user } = useAuth();
  const [ebooks, setEbooks] = useState([]);
  const [drafts, setDrafts] = useState({});
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState("");
  const [msg, setMsg] = useState("");

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    setLoading(true);
    const ebookResult = await supabase.adminWrite("list_ebook_discounts", {}, user?.access_token);

    if (ebookResult?.error) {
      setMsg("ERR: " + ebookResult.error);
      setEbooks([]);
      setDrafts({});
      setLoading(false);
      return;
    }

    const rows = ebookResult?.data || [];
    setEbooks(rows);
    setDrafts(Object.fromEntries(rows.map((ebook) => [
      ebook.id,
      {
        price_inr: String(ebook.price_inr || ""),
        mrp_inr: String(ebook.mrp_inr || ""),
        is_active: ebook.is_active !== false
      }
    ])));
    setLoading(false);
  };

  const updateDraft = (ebookId, field, value) => {
    setDrafts((current) => ({
      ...current,
      [ebookId]: {
        ...(current[ebookId] || {}),
        [field]: value
      }
    }));
  };

  const saveDiscount = async (ebook) => {
    const draft = drafts[ebook.id] || {};
    const priceInr = toPositiveInt(draft.price_inr, 0);
    const mrpInr = toPositiveInt(draft.mrp_inr, priceInr);

    if (priceInr <= 0) {
      setMsg("ERR: Final price must be greater than 0.");
      return;
    }
    if (mrpInr < priceInr) {
      setMsg("ERR: MRP final price se kam nahi ho sakta.");
      return;
    }

    setSavingId(ebook.id);
    setMsg(`WAIT: Saving discount for "${ebook.title}"...`);
    const result = await supabase.adminWrite("update_ebook_discount", {
      id: ebook.id,
      price_inr: priceInr,
      mrp_inr: mrpInr,
      is_active: draft.is_active !== false
    }, user?.access_token);
    setSavingId("");

    if (result?.error) {
      setMsg("ERR: " + result.error);
      return;
    }

    setMsg(`OK: "${ebook.title}" discount saved.`);
    await loadData();
  };

  return (
    <div className="max-w-5xl space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-black" style={{ color: "var(--navy)" }}>Ebook Prices</h2>
          <p className="text-sm font-semibold text-gray-500">
            Ebook MRP, final price, aur live status yahan manage karo. Coupon codes ab Admin &gt; Coupons me ek hi jagah se manage honge.
          </p>
        </div>
        <button className="btn-outline py-2 text-sm" onClick={loadData}>Refresh</button>
      </div>

      {msg && (
        <div className={`rounded-lg border px-4 py-3 text-sm font-bold ${
          msg.startsWith("ERR:")
            ? "border-red-200 bg-red-50 text-red-700"
            : msg.startsWith("WAIT:")
              ? "border-yellow-200 bg-yellow-50 text-yellow-800"
              : "border-green-200 bg-green-50 text-green-700"
        }`}>
          {msg}
        </div>
      )}

      <div className="card">
        <h3 className="mb-4 font-bold">Ebook Prices</h3>
        {loading ? (
          <div className="space-y-3">{[1, 2].map((item) => <div key={item} className="h-28 animate-pulse rounded-xl bg-gray-100"></div>)}</div>
        ) : ebooks.length === 0 ? (
          <div className="rounded-xl bg-gray-50 p-6 text-center text-sm font-bold text-gray-500">No ebooks found.</div>
        ) : (
          <div className="space-y-3">
            {ebooks.map((ebook) => {
              const draft = drafts[ebook.id] || {};
              const preview = {
                price_inr: toPositiveInt(draft.price_inr, 0),
                mrp_inr: toPositiveInt(draft.mrp_inr, toPositiveInt(draft.price_inr, 0))
              };
              const discountPercent = getEbookDiscount(preview);
              const saving = savingId === ebook.id;

              return (
                <div key={ebook.id} className="rounded-xl border border-gray-200 bg-white p-4">
                  <div className="grid gap-4 lg:grid-cols-[72px_1fr]">
                    <div className="h-24 w-[72px] overflow-hidden rounded-lg bg-orange-50">
                      {ebook.cover_url ? (
                        <img src={ebook.cover_url} alt={ebook.title} className="h-full w-full object-cover" />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-xs font-black text-orange-700">PDF</div>
                      )}
                    </div>
                    <div className="min-w-0">
                      <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                        <div className="min-w-0">
                          <h3 className="truncate text-base font-black text-navy">{ebook.title}</h3>
                          {ebook.subtitle && <p className="text-sm font-bold text-gray-500">{ebook.subtitle}</p>}
                          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs font-black">
                            <span className="rounded-full bg-orange-100 px-2 py-1 text-orange-700">Rs {preview.price_inr || 0}</span>
                            {preview.mrp_inr > preview.price_inr && <span className="rounded-full bg-gray-100 px-2 py-1 text-gray-500 line-through">Rs {preview.mrp_inr}</span>}
                            {discountPercent > 0 && <span className="rounded-full bg-green-100 px-2 py-1 text-green-700">{discountPercent}% OFF</span>}
                            <span className={`rounded-full px-2 py-1 ${draft.is_active !== false ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>
                              {draft.is_active !== false ? "LIVE" : "HIDDEN"}
                            </span>
                          </div>
                        </div>
                        <label className="flex cursor-pointer items-center gap-2 text-sm font-black text-gray-700">
                          <input
                            type="checkbox"
                            checked={draft.is_active !== false}
                            onChange={(event) => updateDraft(ebook.id, "is_active", event.target.checked)}
                            className="h-4 w-4 accent-orange-500"
                          />
                          Live
                        </label>
                      </div>

                      <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-[1fr_1fr_auto] md:items-end">
                        <div>
                          <label>MRP</label>
                          <input
                            type="number"
                            min="1"
                            value={draft.mrp_inr || ""}
                            onChange={(event) => updateDraft(ebook.id, "mrp_inr", event.target.value)}
                          />
                        </div>
                        <div>
                          <label>Final Price</label>
                          <input
                            type="number"
                            min="1"
                            value={draft.price_inr || ""}
                            onChange={(event) => updateDraft(ebook.id, "price_inr", event.target.value)}
                          />
                        </div>
                        <button
                          type="button"
                          className="btn-primary justify-center py-3 text-sm"
                          disabled={saving}
                          onClick={() => saveDiscount(ebook)}
                        >
                          {saving ? "Saving..." : "Save"}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
