import { useEffect, useState } from 'react';
import { CONFIG } from '../config/appConfig.js';
import { useAuth } from '../context/AuthContext.jsx';
import { supabase } from '../services/supabaseClient.js';
import { getCoursePriceLabel, getCoursePricing, toPositiveInt } from '../utils/pricing.js';

export function AdminFolders() {
  const { user } = useAuth();
  const [folders, setFolders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dbError, setDbError] = useState("");
  const [msg, setMsg] = useState("");
  const [newName, setNewName] = useState("");
  const [newParent, setNewParent] = useState("");
  const [newIsPaid, setNewIsPaid] = useState(false);
  const [newPrice, setNewPrice] = useState("");
  const [newDiscount, setNewDiscount] = useState("");
  const [newSalePrice, setNewSalePrice] = useState("");
  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState("");
  const [pricingDrafts, setPricingDrafts] = useState({});

  useEffect(() => { loadFolders(); }, []);

  const loadFolders = async () => {
    setLoading(true);
    setDbError("");
    const result = await supabase.getFolders();
    if (result.ok) {
      setFolders(result.data);
      setPricingDrafts(Object.fromEntries((result.data || []).map((folder) => [
        folder.id,
        {
          price_inr: String(folder.price_inr || ""),
          discount_percent: String(folder.discount_percent || ""),
          sale_price_inr: String(folder.sale_price_inr || "")
        }
      ])));
    } else {
      setDbError(result.error);
      setFolders([]);
    }
    setLoading(false);
  };

  const createFolder = async () => {
    if (!newName.trim()) { setMsg(" Folder name is required"); return; }
    setMsg(" Creating folder...");
    const result = await supabase.adminWrite("create_folder", {
      name: newName.trim(),
      ...(newIsPaid ? { is_paid: true } : {}),
      ...(newIsPaid || newPrice ? { price_inr: toPositiveInt(newPrice, CONFIG.RAZORPAY_PLAN_AMOUNT_INR) } : {}),
      ...(newDiscount ? { discount_percent: toPositiveInt(newDiscount, 0) } : {}),
      ...(newSalePrice ? { sale_price_inr: toPositiveInt(newSalePrice, 0) } : {}),
      ...(newParent ? { parent_id: newParent } : {})
    }, user?.access_token);
    if (!result?.error) {
      setNewName(""); setNewParent(""); setNewIsPaid(false); setNewPrice(""); setNewDiscount(""); setNewSalePrice("");
      setMsg(` Folder "${newName.trim()}" created successfully!`);
      await loadFolders();
    } else {
      setMsg(" Error: " + (result?.error || "Unknown error"));
    }
    setTimeout(() => setMsg(""), 4000);
  };

  const startEdit = (f) => { setEditingId(f.id); setEditName(f.name); };
  const saveEdit = async (id) => {
    if (!editName.trim()) return;
    const result = await supabase.adminWrite("update_folder", { id, name: editName.trim() }, user?.access_token);
    if (result?.error) { setMsg("ERR: " + result.error); return; }
    setEditingId(null);
    await loadFolders();
  };
  const deleteFolder = async (id) => {
    if (!confirm("Deleting this folder will unlink the sets inside it. Are you sure?")) return;
    const result = await supabase.adminWrite("delete_folder", { id }, user?.access_token);
    if (result?.error) { setMsg("ERR: " + result.error); return; }
    await loadFolders();
  };

  const updateFolderAccess = async (folder, isPaid) => {
    setMsg(`WAIT: Marking "${folder.name}" as ${isPaid ? "paid" : "free"}...`);
    const result = await supabase.adminWrite("update_folder_access", { id: folder.id, is_paid: isPaid }, user?.access_token);
    if (result?.error) {
      setMsg("ERR: " + result.error + " If the column is missing, run the setup SQL shown on this page.");
      return;
    }
    setMsg(`OK: "${folder.name}" is now ${isPaid ? "paid" : "free"}.`);
    await loadFolders();
  };

  const updatePricingDraft = (folderId, field, value) => {
    setPricingDrafts((current) => ({
      ...current,
      [folderId]: {
        ...(current[folderId] || {}),
        [field]: value
      }
    }));
  };

  const saveFolderPricing = async (folder) => {
    const draft = pricingDrafts[folder.id] || {};
    const priceInr = toPositiveInt(draft.price_inr, CONFIG.RAZORPAY_PLAN_AMOUNT_INR);
    const discountPercent = Math.min(100, Math.max(0, toPositiveInt(draft.discount_percent, 0)));
    const salePriceInr = toPositiveInt(draft.sale_price_inr, 0);
    setMsg(`WAIT: Saving pricing for "${folder.name}"...`);
    const result = await supabase.adminWrite("update_folder_pricing", {
      id: folder.id,
      price_inr: priceInr,
      discount_percent: discountPercent,
      sale_price_inr: salePriceInr
    }, user?.access_token);
    if (result?.error) {
      setMsg("ERR: " + result.error + " If pricing columns are missing, run the setup SQL shown on this page.");
      return;
    }
    setMsg(`OK: Pricing saved for "${folder.name}".`);
    await loadFolders();
  };

  const rootFolders = folders.filter(f => !f.parent_id);
  const getChildren = (pid) => folders.filter(f => f.parent_id === pid);
  const renderPricingEditor = (folder, compact = false) => {
    const draft = pricingDrafts[folder.id] || {};
    const preview = getCoursePricing({
      price_inr: draft.price_inr,
      discount_percent: draft.discount_percent,
      sale_price_inr: draft.sale_price_inr
    });
    return (
      <div className={`grid grid-cols-1 gap-2 ${compact ? "mt-2 sm:grid-cols-4" : "mt-3 sm:grid-cols-5"} rounded-xl border border-orange-100 bg-orange-50/60 p-3`}>
        <div>
          <label className="text-[11px]">MRP</label>
          <input
            type="number"
            min="1"
            className="text-xs"
            value={draft.price_inr || ""}
            onChange={e => updatePricingDraft(folder.id, "price_inr", e.target.value)}
          />
        </div>
        <div>
          <label className="text-[11px]">Discount %</label>
          <input
            type="number"
            min="0"
            max="100"
            className="text-xs"
            value={draft.discount_percent || ""}
            onChange={e => updatePricingDraft(folder.id, "discount_percent", e.target.value)}
          />
        </div>
        <div>
          <label className="text-[11px]">Final Price</label>
          <input
            type="number"
            min="1"
            className="text-xs"
            value={draft.sale_price_inr || ""}
            onChange={e => updatePricingDraft(folder.id, "sale_price_inr", e.target.value)}
          />
        </div>
        <div className="flex flex-col justify-end">
          <span className="text-[11px] font-bold text-gray-500">Preview</span>
          <span className="text-sm font-black text-orange-700">Rs {preview.salePrice}</span>
        </div>
        <button
          type="button"
          className="self-end rounded-lg bg-orange-500 px-3 py-2 text-xs font-black text-white hover:bg-orange-600"
          onClick={() => saveFolderPricing(folder)}
        >
          Save Price
        </button>
      </div>
    );
  };

  return (
    <div className="max-w-3xl space-y-6">
      <h2 className="text-xl font-black" style={{color:"var(--navy)"}}> Folder Manager</h2>

      {/*  DB Error Block  */}
      {dbError && (
        <div className="p-4 rounded-xl bg-red-50 border border-red-300 space-y-3">
          <p className="font-black text-red-700"> Supabase Error  folders could not be loaded</p>
          <p className="text-sm text-red-600 font-mono bg-red-100 p-2 rounded">{dbError}</p>
          <div className="bg-white border border-red-200 rounded-xl p-4 text-sm space-y-2">
            <p className="font-black text-gray-800"> Fix this by running the following SQL in the Supabase SQL Editor:</p>
            <pre className="bg-gray-900 text-green-400 p-3 rounded-lg text-xs overflow-x-auto whitespace-pre-wrap">{`-- Step 1: create the folders table
CREATE TABLE IF NOT EXISTS folders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  is_paid BOOLEAN DEFAULT FALSE,
  price_inr INTEGER DEFAULT 0,
  discount_percent INTEGER DEFAULT 0,
  sale_price_inr INTEGER DEFAULT 0,
  parent_id UUID REFERENCES folders(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE folders
ADD COLUMN IF NOT EXISTS is_paid BOOLEAN DEFAULT FALSE;
ALTER TABLE folders
ADD COLUMN IF NOT EXISTS price_inr INTEGER DEFAULT 0;
ALTER TABLE folders
ADD COLUMN IF NOT EXISTS discount_percent INTEGER DEFAULT 0;
ALTER TABLE folders
ADD COLUMN IF NOT EXISTS sale_price_inr INTEGER DEFAULT 0;

-- Step 2: add folder_id to practice_sets
ALTER TABLE practice_sets
ADD COLUMN IF NOT EXISTS folder_id UUID REFERENCES folders(id) ON DELETE SET NULL;

-- Step 3: RLS - public read only; writes go through the admin-write Edge Function
ALTER TABLE folders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "folders_read" ON folders;
DROP POLICY IF EXISTS "folders_write" ON folders;
CREATE POLICY "folders_read" ON folders FOR SELECT USING (true);
REVOKE INSERT, UPDATE, DELETE ON folders FROM anon, authenticated;`}</pre>
            <p className="text-xs text-gray-500">Refresh the page after running it and the folders should appear.</p>
          </div>
          <button className="btn-primary text-sm" onClick={loadFolders}> Try Again</button>
        </div>
      )}

      {msg && <div className={`p-3 rounded-lg text-sm ${msg.startsWith("") ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>{msg}</div>}

      {/*  Create Folder Form  */}
      {!dbError && (
        <div className="card border-t-4 border-orange-500">
          <h3 className="font-bold mb-4"> Create New Folder</h3>
          <div className="grid grid-cols-1 md:grid-cols-6 gap-3 items-end">
            <div className="md:col-span-2">
              <label>Folder Name *</label>
              <input
                placeholder="Example: UKSSSC, Hindi, GS..."
                value={newName}
                onChange={e => setNewName(e.target.value)}
                onKeyDown={e => e.key === "Enter" && createFolder()}
              />
            </div>
            <div className="md:col-span-2">
              <label>Parent Category (for creating a course)</label>
              <select value={newParent} onChange={e => setNewParent(e.target.value)}>
                <option value=""> Root Level </option>
                {rootFolders.map(f => <option key={f.id} value={f.id}> {f.name}</option>)}
              </select>
            </div>
            <div className="md:col-span-2 rounded-xl bg-yellow-50 border border-yellow-200 p-3">
              <label htmlFor="newFolderPaid" className="mb-0 flex cursor-pointer items-center gap-2 text-sm font-bold text-yellow-800">
                <input
                  id="newFolderPaid"
                  type="checkbox"
                  checked={newIsPaid}
                  onChange={e => setNewIsPaid(e.target.checked)}
                  className="h-4 w-4 accent-orange-500"
                />
                Paid Folder
              </label>
              <p className="mt-1 text-[11px] font-semibold text-yellow-700">Use this when the folder is a sellable course item.</p>
            </div>
            {newIsPaid && (
              <>
                <div className="md:col-span-2">
                  <label>MRP / Course Price</label>
                  <input
                    type="number"
                    min="1"
                    placeholder="Example: 999"
                    value={newPrice}
                    onChange={e => setNewPrice(e.target.value)}
                  />
                </div>
                <div className="md:col-span-2">
                  <label>Discount %</label>
                  <input
                    type="number"
                    min="0"
                    max="100"
                    placeholder="Example: 40"
                    value={newDiscount}
                    onChange={e => setNewDiscount(e.target.value)}
                  />
                </div>
                <div className="md:col-span-2">
                  <label>Final Sale Price</label>
                  <input
                    type="number"
                    min="1"
                    placeholder="Example: 599"
                    value={newSalePrice}
                    onChange={e => setNewSalePrice(e.target.value)}
                  />
                </div>
              </>
            )}
            <div className="md:col-span-6">
              <button className="btn-primary w-full" onClick={createFolder}> Create</button>
            </div>
          </div>
          <p className="text-xs text-gray-400 mt-3">
             Tip: Create the category first (UKSSSC), then add courses inside it (Hindi, GS, Reasoning).
          </p>
        </div>
      )}

      {/*  Folder Tree  */}
      {!dbError && (
        <div className="card">
          <div className="flex justify-between items-center mb-4">
            <h3 className="font-bold"> Folder Structure</h3>
            <span className="text-xs bg-gray-100 text-gray-600 px-3 py-1 rounded-full font-bold">{folders.length} folders</span>
          </div>
          {loading ? (
            <div className="space-y-2">{[1,2,3].map(i=><div key={i} className="h-10 bg-gray-100 rounded animate-pulse"></div>)}</div>
          ) : rootFolders.length === 0 ? (
            <div className="text-center py-10 text-gray-400">
              <div className="text-5xl mb-3"></div>
              <p className="text-sm font-medium">No folders yet. Create one above.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {rootFolders.map(folder => {
                const children = getChildren(folder.id);
                return (
                  <div key={folder.id} className="border rounded-xl overflow-hidden">
                    <div className="flex items-center gap-3 p-3 bg-orange-50">
                      <span className="text-xl"></span>
                      {editingId === folder.id ? (
                        <input className="flex-1 border-b-2 border-orange-500 bg-transparent outline-none font-bold px-1"
                          value={editName} onChange={e=>setEditName(e.target.value)}
                          onKeyDown={e=>{if(e.key==="Enter")saveEdit(folder.id);if(e.key==="Escape")setEditingId(null);}}
                          autoFocus />
                      ) : (
                        <span className="flex-1 font-black text-navy">
                          {folder.name}
                          {folder.is_paid && <span className="ml-2 text-xs font-black text-orange-600">{getCoursePriceLabel(folder)}</span>}
                        </span>
                      )}
                      <div className="flex gap-2 items-center">
                        <span className="text-xs bg-orange-100 text-orange-700 px-2 py-0.5 rounded font-bold">{children.length} sub</span>
                        <span className={`text-xs px-2 py-0.5 rounded font-bold ${folder.is_paid ? "bg-yellow-100 text-yellow-700" : "bg-green-100 text-green-700"}`}>
                          {folder.is_paid ? "PAID" : "FREE"}
                        </span>
                        {editingId === folder.id ? (
                          <>
                            <button className="text-xs bg-green-500 text-white px-3 py-1 rounded-lg font-bold" onClick={()=>saveEdit(folder.id)}>Save</button>
                            <button className="text-xs bg-gray-200 px-3 py-1 rounded-lg font-bold" onClick={()=>setEditingId(null)}>Cancel</button>
                          </>
                        ) : (
                          <>
                            <button className="text-xs bg-yellow-100 text-yellow-700 px-3 py-1 rounded-lg font-bold hover:bg-yellow-200" onClick={()=>updateFolderAccess(folder, true)} disabled={Boolean(folder.is_paid)}>Mark Paid</button>
                            <button className="text-xs bg-green-100 text-green-700 px-3 py-1 rounded-lg font-bold hover:bg-green-200" onClick={()=>updateFolderAccess(folder, false)} disabled={!folder.is_paid}>Mark Free</button>
                            <button className="text-xs bg-blue-100 text-blue-600 px-3 py-1 rounded-lg font-bold hover:bg-blue-200" onClick={()=>startEdit(folder)}> Rename</button>
                            <button className="text-xs bg-red-100 text-red-500 px-3 py-1 rounded-lg font-bold hover:bg-red-200" onClick={()=>deleteFolder(folder.id)}>Delete</button>
                          </>
                        )}
                      </div>
                    </div>
                    {folder.is_paid && renderPricingEditor(folder)}
                    {children.length > 0 && (
                      <div className="pl-8 py-2 space-y-1 bg-white">
                        {children.map(child => (
                          <div key={child.id} className="rounded-lg p-2 hover:bg-gray-50">
                            <div className="flex items-center gap-3">
                              <span className="text-gray-300 text-sm"></span>
                              <span className="text-lg"></span>
                              {editingId === child.id ? (
                                <input className="flex-1 border-b-2 border-orange-500 bg-transparent outline-none font-bold px-1 text-sm"
                                  value={editName} onChange={e=>setEditName(e.target.value)}
                                  onKeyDown={e=>{if(e.key==="Enter")saveEdit(child.id);if(e.key==="Escape")setEditingId(null);}}
                                  autoFocus />
                              ) : (
                                <div className="flex-1 min-w-0">
                                  <span className="font-bold text-navy text-sm">{child.name}</span>
                                  <span className={`ml-2 text-[10px] px-2 py-0.5 rounded font-bold ${child.is_paid ? "bg-yellow-100 text-yellow-700" : "bg-green-100 text-green-700"}`}>
                                    {child.is_paid ? "PAID" : "FREE"}
                                  </span>
                                  {child.is_paid && (
                                    <span className="ml-2 text-[10px] font-black text-orange-600">{getCoursePriceLabel(child)}</span>
                                  )}
                                </div>
                              )}
                              <div className="flex flex-wrap justify-end gap-2">
                                {editingId === child.id ? (
                                  <>
                                    <button className="text-xs bg-green-500 text-white px-2 py-0.5 rounded font-bold" onClick={()=>saveEdit(child.id)}>Save</button>
                                    <button className="text-xs bg-gray-200 px-2 py-0.5 rounded font-bold" onClick={()=>setEditingId(null)}>Cancel</button>
                                  </>
                                ) : (
                                  <>
                                    <button className="text-xs bg-yellow-100 text-yellow-700 px-2 py-1 rounded-lg font-bold hover:bg-yellow-200" onClick={()=>updateFolderAccess(child, true)} disabled={Boolean(child.is_paid)}>Paid</button>
                                    <button className="text-xs bg-green-100 text-green-700 px-2 py-1 rounded-lg font-bold hover:bg-green-200" onClick={()=>updateFolderAccess(child, false)} disabled={!child.is_paid}>Free</button>
                                    <button className="text-xs bg-blue-100 text-blue-600 px-2 py-1 rounded-lg font-bold hover:bg-blue-200" onClick={()=>startEdit(child)}>Rename</button>
                                    <button className="text-xs bg-red-100 text-red-500 px-2 py-1 rounded-lg font-bold hover:bg-red-200" onClick={()=>deleteFolder(child.id)}>Delete</button>
                                  </>
                                )}
                              </div>
                            </div>
                            {child.is_paid && renderPricingEditor(child, true)}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
