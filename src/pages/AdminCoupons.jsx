import { useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { supabase } from '../services/supabaseClient.js';
import { formatCouponDiscount, normalizeCouponCode, toNonNegativeInt } from '../utils/pricing.js';

export const EMPTY_COUPON_FORM = {
  id: "",
  code: "",
  title: "",
  discount_type: "percent",
  discount_value: "",
  max_discount_inr: "",
  min_order_inr: "",
  usage_limit: "",
  starts_at: "",
  expires_at: "",
  active: true,
  product_scope: "all",
  folder_ids: [],
  ebook_ids: []
};

export function toDatetimeLocalValue(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}

export function datetimeLocalToIso(value) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString();
}

export function AdminCoupons() {
  const { user } = useAuth();
  const [coupons, setCoupons] = useState([]);
  const [folders, setFolders] = useState([]);
  const [ebooks, setEbooks] = useState([]);
  const [form, setForm] = useState(EMPTY_COUPON_FORM);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    setLoading(true);
    const [couponResult, folderResult, ebookResult] = await Promise.all([
      supabase.adminWrite("list_coupons", {}, user?.access_token),
      supabase.getFolders(),
      supabase.adminWrite("list_ebook_discounts", {}, user?.access_token)
    ]);
    setCoupons(couponResult?.data || []);
    setFolders(folderResult.ok ? folderResult.data : []);
    setEbooks(ebookResult?.data || []);
    if (couponResult?.error || ebookResult?.error) setMsg("ERR: " + (couponResult?.error || ebookResult?.error));
    setLoading(false);
  };

  const paidFolders = folders.filter((folder) => folder.is_paid);
  const courseOptions = paidFolders.length > 0 ? paidFolders : folders.filter((folder) => folder.parent_id);
  const folderNameById = Object.fromEntries(folders.map((folder) => [folder.id, folder.name]));
  const ebookNameById = Object.fromEntries(ebooks.map((ebook) => [ebook.id, ebook.title]));
  const showCourseTargets = form.product_scope !== "ebook";
  const showEbookTargets = form.product_scope !== "course";

  const resetForm = () => {
    setForm(EMPTY_COUPON_FORM);
    setMsg("");
  };

  const toggleFolderId = (folderId) => {
    setForm((current) => ({
      ...current,
      folder_ids: current.folder_ids.includes(folderId)
        ? current.folder_ids.filter((id) => id !== folderId)
        : [...current.folder_ids, folderId]
    }));
  };

  const toggleEbookId = (ebookId) => {
    setForm((current) => ({
      ...current,
      ebook_ids: current.ebook_ids.includes(ebookId)
        ? current.ebook_ids.filter((id) => id !== ebookId)
        : [...current.ebook_ids, ebookId]
    }));
  };

  const updateProductScope = (productScope) => {
    setForm((current) => ({
      ...current,
      product_scope: productScope,
      folder_ids: productScope === "ebook" ? [] : current.folder_ids,
      ebook_ids: productScope === "course" ? [] : current.ebook_ids
    }));
  };

  const startEditCoupon = (coupon) => {
    setForm({
      id: coupon.id,
      code: coupon.code || "",
      title: coupon.title || "",
      discount_type: coupon.discount_type || "percent",
      discount_value: String(coupon.discount_value || ""),
      max_discount_inr: String(coupon.max_discount_inr || ""),
      min_order_inr: String(coupon.min_order_inr || ""),
      usage_limit: String(coupon.usage_limit || ""),
      starts_at: toDatetimeLocalValue(coupon.starts_at),
      expires_at: toDatetimeLocalValue(coupon.expires_at),
      active: coupon.active !== false,
      product_scope: coupon.product_scope || "all",
      folder_ids: coupon.folder_ids || [],
      ebook_ids: coupon.ebook_ids || []
    });
    setMsg("");
  };

  const saveCoupon = async () => {
    const code = normalizeCouponCode(form.code);
    if (!code) { setMsg("ERR: Coupon code is required."); return; }
    if (toNonNegativeInt(form.discount_value, 0) <= 0) { setMsg("ERR: Discount value must be greater than 0."); return; }

    setSaving(true);
    setMsg(`WAIT: ${form.id ? "Updating" : "Creating"} coupon ${code}...`);
    const payload = {
      ...form,
      code,
      discount_value: toNonNegativeInt(form.discount_value, 0),
      max_discount_inr: toNonNegativeInt(form.max_discount_inr, 0),
      min_order_inr: toNonNegativeInt(form.min_order_inr, 0),
      usage_limit: toNonNegativeInt(form.usage_limit, 0),
      starts_at: datetimeLocalToIso(form.starts_at),
      expires_at: datetimeLocalToIso(form.expires_at),
      product_scope: form.product_scope || "all",
      folder_ids: form.product_scope === "ebook" ? [] : form.folder_ids,
      ebook_ids: form.product_scope === "course" ? [] : form.ebook_ids
    };
    const result = await supabase.adminWrite(form.id ? "update_coupon" : "create_coupon", payload, user?.access_token);
    setSaving(false);
    if (result?.error) {
      setMsg("ERR: " + result.error);
      return;
    }
    setMsg(`OK: Coupon ${code} saved.`);
    setForm(EMPTY_COUPON_FORM);
    await loadData();
  };

  const deleteCoupon = async (coupon) => {
    if (!confirm(`Delete coupon "${coupon.code}"?`)) return;
    setMsg(`WAIT: Deleting coupon ${coupon.code}...`);
    const result = await supabase.adminWrite("delete_coupon", { id: coupon.id }, user?.access_token);
    if (result?.error) { setMsg("ERR: " + result.error); return; }
    setMsg(`OK: Coupon ${coupon.code} deleted.`);
    await loadData();
  };

  return (
    <div className="max-w-5xl space-y-6">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-xl font-black" style={{color:"var(--navy)"}}>Coupon Manager</h2>
        {form.id && <button className="btn-outline text-sm" onClick={resetForm}>New Coupon</button>}
      </div>

      {msg && (
        <div className={`rounded-lg border px-4 py-3 text-sm font-bold ${
          msg.startsWith("ERR:")
            ? "border-red-200 bg-red-50 text-red-700"
            : "border-green-200 bg-green-50 text-green-700"
        }`}>
          {msg}
        </div>
      )}

      <div className="card border-t-4 border-orange-500">
        <h3 className="mb-4 font-bold">{form.id ? "Edit Coupon" : "Create Coupon"}</h3>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-6">
          <div className="md:col-span-2">
            <label>Coupon Code *</label>
            <input
              className="uppercase"
              placeholder="Example: DRONNA50"
              value={form.code}
              onChange={(event) => setForm({ ...form, code: event.target.value })}
            />
          </div>
          <div className="md:col-span-2">
            <label>Title</label>
            <input
              placeholder="Launch offer"
              value={form.title}
              onChange={(event) => setForm({ ...form, title: event.target.value })}
            />
          </div>
          <div className="md:col-span-2 rounded-xl border border-yellow-200 bg-yellow-50 p-3">
            <label htmlFor="couponActive" className="mb-0 flex cursor-pointer items-center gap-2 text-sm font-bold text-yellow-800">
              <input
                id="couponActive"
                type="checkbox"
                checked={form.active}
                onChange={(event) => setForm({ ...form, active: event.target.checked })}
                className="h-4 w-4 accent-orange-500"
              />
              Active coupon
            </label>
            <p className="mt-1 text-[11px] font-semibold text-yellow-700">Turn off to pause this coupon immediately.</p>
          </div>

          <div className="md:col-span-2">
            <label>Applies To</label>
            <select value={form.product_scope} onChange={(event) => updateProductScope(event.target.value)}>
              <option value="all">Courses + Ebooks</option>
              <option value="course">Courses only</option>
              <option value="ebook">Ebooks only</option>
            </select>
          </div>
          <div className="md:col-span-2">
            <label>Discount Type</label>
            <select value={form.discount_type} onChange={(event) => setForm({ ...form, discount_type: event.target.value })}>
              <option value="percent">Percent</option>
              <option value="fixed">Fixed INR</option>
            </select>
          </div>
          <div className="md:col-span-2">
            <label>{form.discount_type === "fixed" ? "Discount Amount" : "Discount %"}</label>
            <input
              type="number"
              min="1"
              max={form.discount_type === "percent" ? "100" : undefined}
              placeholder={form.discount_type === "fixed" ? "500" : "50"}
              value={form.discount_value}
              onChange={(event) => setForm({ ...form, discount_value: event.target.value })}
            />
          </div>
          <div className="md:col-span-2">
            <label>Max Discount INR</label>
            <input
              type="number"
              min="0"
              placeholder="0 means no cap"
              value={form.max_discount_inr}
              onChange={(event) => setForm({ ...form, max_discount_inr: event.target.value })}
            />
          </div>
          <div className="md:col-span-2">
            <label>Minimum Order INR</label>
            <input
              type="number"
              min="0"
              placeholder="0 means no minimum"
              value={form.min_order_inr}
              onChange={(event) => setForm({ ...form, min_order_inr: event.target.value })}
            />
          </div>
          <div className="md:col-span-2">
            <label>Usage Limit</label>
            <input
              type="number"
              min="0"
              placeholder="0 means unlimited"
              value={form.usage_limit}
              onChange={(event) => setForm({ ...form, usage_limit: event.target.value })}
            />
          </div>
          <div className="md:col-span-2">
            <label>Starts At</label>
            <input
              type="datetime-local"
              value={form.starts_at}
              onChange={(event) => setForm({ ...form, starts_at: event.target.value })}
            />
          </div>
          <div className="md:col-span-2">
            <label>Expires At</label>
            <input
              type="datetime-local"
              value={form.expires_at}
              onChange={(event) => setForm({ ...form, expires_at: event.target.value })}
            />
          </div>
          {showCourseTargets && (
          <div className="md:col-span-6">
            <label>Applicable Courses</label>
            <div className="rounded-xl border border-gray-200 bg-gray-50 p-3">
              <div className="mb-2 text-xs font-bold text-gray-500">Leave every course unchecked to apply this coupon to all paid courses.</div>
              {courseOptions.length === 0 ? (
                <div className="text-sm font-bold text-gray-500">Create paid course folders first.</div>
              ) : (
                <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                  {courseOptions.map((folder) => (
                    <label key={folder.id} className="flex cursor-pointer items-center gap-2 rounded-lg bg-white px-3 py-2 text-sm font-bold text-gray-700">
                      <input
                        type="checkbox"
                        checked={form.folder_ids.includes(folder.id)}
                        onChange={() => toggleFolderId(folder.id)}
                        className="h-4 w-4 accent-orange-500"
                      />
                      <span>{folder.name}</span>
                      {folder.is_paid && <span className="ml-auto rounded bg-orange-100 px-2 py-0.5 text-[10px] text-orange-700">PAID</span>}
                    </label>
                  ))}
                </div>
              )}
            </div>
          </div>
          )}
          {showEbookTargets && (
          <div className="md:col-span-6">
            <label>Applicable Ebooks</label>
            <div className="rounded-xl border border-gray-200 bg-gray-50 p-3">
              <div className="mb-2 text-xs font-bold text-gray-500">Leave every ebook unchecked to apply this coupon to all ebooks.</div>
              {ebooks.length === 0 ? (
                <div className="text-sm font-bold text-gray-500">Create ebooks first.</div>
              ) : (
                <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                  {ebooks.map((ebook) => (
                    <label key={ebook.id} className="flex cursor-pointer items-center gap-2 rounded-lg bg-white px-3 py-2 text-sm font-bold text-gray-700">
                      <input
                        type="checkbox"
                        checked={form.ebook_ids.includes(ebook.id)}
                        onChange={() => toggleEbookId(ebook.id)}
                        className="h-4 w-4 accent-orange-500"
                      />
                      <span>{ebook.title}</span>
                      <span className="ml-auto rounded bg-orange-100 px-2 py-0.5 text-[10px] text-orange-700">EBOOK</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          </div>
          )}
          <div className="md:col-span-6">
            <button className="btn-primary w-full justify-center" onClick={saveCoupon} disabled={saving}>
              {saving ? "Saving..." : form.id ? "Update Coupon" : "Create Coupon"}
            </button>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="font-bold">Coupons</h3>
          <button className="btn-outline py-2 text-sm" onClick={loadData}>Refresh</button>
        </div>
        {loading ? (
          <div className="space-y-2">{[1,2,3].map((i) => <div key={i} className="h-14 animate-pulse rounded bg-gray-100"></div>)}</div>
        ) : coupons.length === 0 ? (
          <div className="rounded-xl bg-gray-50 p-6 text-center text-sm font-bold text-gray-500">No coupons yet.</div>
        ) : (
          <div className="space-y-3">
            {coupons.map((coupon) => (
              <div key={coupon.id} className="rounded-xl border border-gray-200 bg-white p-4">
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-lg bg-orange-100 px-3 py-1 font-black text-orange-700">{coupon.code}</span>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-black ${coupon.active ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-500"}`}>
                        {coupon.active ? "ACTIVE" : "PAUSED"}
                      </span>
                      <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-black text-blue-700">
                        {coupon.product_scope === "course" ? "COURSES" : coupon.product_scope === "ebook" ? "EBOOKS" : "COURSES + EBOOKS"}
                      </span>
                      <span className="text-sm font-black text-navy">{formatCouponDiscount(coupon)}</span>
                    </div>
                    {coupon.title && <div className="mt-2 text-sm font-bold text-gray-700">{coupon.title}</div>}
                    <div className="mt-2 flex flex-wrap gap-2 text-xs font-bold text-gray-500">
                      <span>Used {coupon.used_count || 0}{coupon.usage_limit ? ` / ${coupon.usage_limit}` : ""}</span>
                      {coupon.min_order_inr > 0 && <span>Min Rs {coupon.min_order_inr}</span>}
                      {coupon.max_discount_inr > 0 && <span>Cap Rs {coupon.max_discount_inr}</span>}
                    </div>
                    <div className="mt-2 text-xs font-semibold text-gray-500">
                      {coupon.product_scope === "ebook"
                        ? "Courses: not applicable"
                        : (coupon.folder_ids || []).length === 0
                          ? "Courses: all paid courses"
                          : `Courses: ${(coupon.folder_ids || []).map((id) => folderNameById[id] || "Course").join(", ")}`}
                    </div>
                    <div className="mt-1 text-xs font-semibold text-gray-500">
                      {coupon.product_scope === "course"
                        ? "Ebooks: not applicable"
                        : (coupon.ebook_ids || []).length === 0
                          ? "Ebooks: all ebooks"
                          : `Ebooks: ${(coupon.ebook_ids || []).map((id) => ebookNameById[id] || "Ebook").join(", ")}`}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button className="rounded-lg bg-blue-100 px-3 py-2 text-xs font-black text-blue-700" onClick={() => startEditCoupon(coupon)}>Edit</button>
                    <button className="rounded-lg bg-red-100 px-3 py-2 text-xs font-black text-red-600" onClick={() => deleteCoupon(coupon)}>Delete</button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
