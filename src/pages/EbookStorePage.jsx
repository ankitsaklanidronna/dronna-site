import { useEffect, useMemo, useState } from 'react';
import { Navbar } from '../components/Navbar.jsx';
import { ShareBtn } from '../components/ShareBtn.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { getRouteSearchParams, useRouter } from '../context/RouterContext.jsx';
import { createRazorpayOrder, getRazorpayKeyId, loadRazorpayCheckout, validateRazorpayCoupon, verifyRazorpayPayment } from '../services/razorpay.js';
import { supabase } from '../services/supabaseClient.js';
import { normalizeCouponCode, toPositiveInt } from '../utils/pricing.js';
import { APP_SHARE_TITLE, buildEbookShareText, getEbookPublicShareUrl } from '../utils/share.js';

function getEbookPricing(ebook = {}) {
  const price = toPositiveInt(ebook.price_inr, 0);
  const mrp = toPositiveInt(ebook.mrp_inr, price);
  const discountPercent = mrp > price && price > 0 ? Math.round(((mrp - price) / mrp) * 100) : 0;
  return {
    price,
    mrp,
    discountPercent,
    hasDiscount: mrp > price
  };
}

function getCoverStyle(index) {
  const covers = [
    'linear-gradient(135deg, #0D1B3E 0%, #0F766E 100%)',
    'linear-gradient(135deg, #1E293B 0%, #E65100 100%)',
    'linear-gradient(135deg, #312E81 0%, #0F766E 100%)',
    'linear-gradient(135deg, #172554 0%, #B45309 100%)'
  ];
  return covers[index % covers.length];
}

function EbookPasswordNotice({ password }) {
  if (!password) return null;

  return (
    <div className="mt-3 rounded-lg border-2 border-orange-200 bg-white px-3 py-3 text-center shadow-[0_14px_34px_rgba(230,81,0,0.22)] ring-4 ring-orange-50">
      <div className="text-[11px] font-black uppercase tracking-wide text-orange-700">
        PDF password
      </div>
      <div className="mt-1 break-all rounded-lg bg-orange-50 px-3 py-2 text-lg font-black leading-snug text-navy shadow-inner">
        {password}
      </div>
      <div className="mt-2 text-xs font-black text-orange-800">
        PDF open karte time ye password dalein.
      </div>
    </div>
  );
}

export function EbookStorePage() {
  const { navigate, page } = useRouter();
  const { user } = useAuth();
  const [ebooks, setEbooks] = useState([]);
  const [library, setLibrary] = useState([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState({ text: '', type: '' });
  const [activePaymentId, setActivePaymentId] = useState('');
  const [activeAccessId, setActiveAccessId] = useState('');
  const [couponDrafts, setCouponDrafts] = useState({});
  const [appliedCoupons, setAppliedCoupons] = useState({});
  const [couponLoadingEbookId, setCouponLoadingEbookId] = useState('');
  const featuredEbookId = getRouteSearchParams(page).get('ebook') || '';

  const libraryById = useMemo(() => {
    return new Map((library || []).map((item) => [item.id || item.ebook_id, item]));
  }, [library]);
  const displayedEbooks = useMemo(() => {
    if (!featuredEbookId) return ebooks;
    return [...ebooks].sort((left, right) => (
      Number(right.id === featuredEbookId) - Number(left.id === featuredEbookId)
    ));
  }, [ebooks, featuredEbookId]);

  useEffect(() => {
    loadData();
  }, [user?.access_token]);

  useEffect(() => {
    if (loading || !featuredEbookId || !ebooks.some((ebook) => ebook.id === featuredEbookId)) return;
    window.requestAnimationFrame(() => {
      document.getElementById(`ebook-${featuredEbookId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }, [loading, featuredEbookId, ebooks]);

  const loadData = async () => {
    setLoading(true);
    const [catalogRes, libraryRes] = await Promise.all([
      supabase.getPublicEbooks(),
      user?.access_token ? supabase.getMyEbookLibrary(user.access_token) : Promise.resolve({ data: [], error: null })
    ]);

    setEbooks(catalogRes.data || []);
    setLibrary(libraryRes.data || []);
    const warning = catalogRes.error || libraryRes.error || '';
    setMessage(warning ? { text: warning, type: 'error' } : { text: '', type: '' });
    setLoading(false);
  };

  const openPurchasedEbook = async (ebook) => {
    if (!user?.access_token) {
      navigate('/login');
      return;
    }
    const libraryItem = libraryById.get(ebook.id);
    if (!libraryItem) {
      setMessage({ text: 'This ebook is not active on your account yet.', type: 'error' });
      return;
    }

    if (!libraryItem.has_source_pdf) {
      setMessage({ text: 'Original PDF is not uploaded yet. Please try after the PDF is added.', type: 'error' });
      return;
    }

    const ebookWindow = window.open('about:blank', '_blank');
    if (ebookWindow) {
      ebookWindow.document.title = 'Preparing Ebook...';
      ebookWindow.document.body.innerHTML = '<p style="font-family: system-ui, sans-serif; padding: 24px;">Preparing your ebook...</p>';
    }

    setActiveAccessId(ebook.id);
    setMessage({ text: 'Preparing your password-protected PDF. This may take a few seconds.', type: 'success' });
    const result = await supabase.prepareEbookAccess(ebook.id, user.access_token);
    setActiveAccessId('');

    if (result?.error || !result?.signed_url) {
      if (ebookWindow) ebookWindow.close();
      setMessage({ text: result?.error || 'Ebook could not be opened right now.', type: 'error' });
      await loadData();
      return;
    }

    await loadData();
    setMessage({
      text: result.password_required === false
        ? 'Ebook is ready. Opening your PDF now.'
        : `Ebook is ready. PDF password: ${result.password || user.email}`,
      type: 'success'
    });
    if (ebookWindow) {
      ebookWindow.location.href = result.signed_url;
    } else {
      window.open(result.signed_url, '_blank', 'noopener,noreferrer');
    }
  };

  const validateEbookCoupon = async (ebook) => {
    if (!user) {
      navigate('/login');
      return;
    }

    const code = normalizeCouponCode(couponDrafts[ebook.id] || '');
    if (!code) {
      setMessage({ text: 'Enter a coupon code first.', type: 'error' });
      return;
    }

    setCouponLoadingEbookId(ebook.id);
    setMessage({ text: '', type: '' });
    const result = await validateRazorpayCoupon({
      plan: 'ebook',
      product_type: 'ebook',
      ebook_id: ebook.id,
      coupon_code: code
    }, user.access_token);
    setCouponLoadingEbookId('');

    if (result?.error || !result?.ok || !result?.coupon) {
      setAppliedCoupons((current) => {
        const next = { ...current };
        delete next[ebook.id];
        return next;
      });
      setMessage({ text: result?.error || 'Coupon could not be applied.', type: 'error' });
      return;
    }

    setAppliedCoupons((current) => ({
      ...current,
      [ebook.id]: result
    }));
    setMessage({ text: `${result.coupon.code} applied. You saved Rs ${result.discount_inr}.`, type: 'success' });
  };

  const removeEbookCoupon = (ebookId) => {
    setAppliedCoupons((current) => {
      const next = { ...current };
      delete next[ebookId];
      return next;
    });
  };

  const startEbookPurchase = async (ebook, couponCode = '') => {
    if (!user) {
      navigate('/login');
      return;
    }

    if (libraryById.has(ebook.id)) {
      await openPurchasedEbook(ebook);
      return;
    }

    setActivePaymentId(ebook.id);
    setMessage({ text: '', type: '' });
    try {
      const scriptReady = await loadRazorpayCheckout();
      if (!scriptReady || !window.Razorpay) {
        throw new Error('Razorpay checkout could not be loaded. Please check your internet connection.');
      }

      const order = await createRazorpayOrder({
        plan: 'ebook',
        product_type: 'ebook',
        ebook_id: ebook.id,
        coupon_code: normalizeCouponCode(couponCode)
      }, user.access_token);

      if (order?.error || !order?.order_id) {
        throw new Error(order?.error || 'Payment order could not be created.');
      }

      const checkout = new window.Razorpay({
        key: getRazorpayKeyId(order),
        amount: order.amount,
        currency: order.currency || 'INR',
        name: 'Dronna',
        description: `Ebook - ${ebook.title}`,
        order_id: order.order_id,
        prefill: {
          name: user.name || '',
          email: user.email || ''
        },
        theme: {
          color: '#E65100'
        },
        handler: async (response) => {
          const verified = await verifyRazorpayPayment(response, user.access_token);
          if (verified?.error || !verified?.ok) {
            setActivePaymentId('');
            setMessage({
              text: verified?.error || 'Payment verification failed. Please contact support if amount was debited.',
              type: 'error'
            });
            return;
          }

          await loadData();
          setActivePaymentId('');
          setMessage({ text: 'Payment successful. PDF password is highlighted on your ebook card.', type: 'success' });
        },
        modal: {
          ondismiss: () => {
            setActivePaymentId('');
            setMessage({ text: 'Payment cancelled.', type: 'error' });
          }
        }
      });

      checkout.on('payment.failed', (response) => {
        setActivePaymentId('');
        setMessage({
          text: response?.error?.description || 'Payment failed. Please try again.',
          type: 'error'
        });
      });

      checkout.open();
    } catch (e) {
      setActivePaymentId('');
      setMessage({ text: e.message || 'Payment could not be started.', type: 'error' });
    }
  };

  return (
    <div className="page bg-[#FDF8F3] min-h-screen">
      <Navbar />

      <section className="border-b border-b-line bg-white">
        <div className="max-w-6xl mx-auto px-4 py-7 sm:py-9 md:py-12">
          <div className="grid gap-4 sm:gap-6 md:grid-cols-[1fr_320px] md:items-center">
            <div>
              <p className="text-xs sm:text-sm font-black uppercase tracking-wider text-saffron-dark">Ebook Store</p>
              <h1 className="mt-2 text-2xl sm:text-3xl md:text-5xl font-headline font-black leading-tight text-navy">
                Exam-ready ebooks in one protected store.
              </h1>
              <p className="mt-3 sm:mt-4 max-w-2xl text-sm md:text-base font-semibold leading-6 sm:leading-7 text-muted">
                Buy with your Dronna account email. After payment, the ebook opens only from the same logged-in email, and the PDF password is your purchase email.
              </p>
            </div>
            <div className="space-y-3">
              <div className="rounded-lg border border-orange-100 bg-orange-50 p-4 sm:p-5">
                <div className="flex items-center gap-3">
                  <span className="flex h-10 w-10 sm:h-11 sm:w-11 shrink-0 items-center justify-center rounded-lg bg-saffron-dark text-white">
                    <span className="material-symbols-outlined" style={{ fontVariationSettings: "'FILL' 1" }}>lock</span>
                  </span>
                  <div>
                    <h2 className="text-base sm:text-lg font-black text-navy">Email protected</h2>
                    <p className="mt-1 text-sm font-bold text-orange-800">Purchase email is used for access and PDF password.</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      <main className="max-w-6xl mx-auto px-4 py-6 sm:py-8">
        {message.text && (
          <div className={`mb-5 rounded-xl border px-4 py-3 text-sm font-bold ${
            message.type === 'success'
              ? 'border-green-200 bg-green-50 text-green-700'
              : 'border-red-200 bg-red-50 text-red-600'
          }`}>
            {message.text}
          </div>
        )}

        {loading && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[1, 2, 3].map((item) => (
              <div key={item} className="rounded-lg border border-line bg-white p-4 shadow-sm animate-pulse">
                <div className="h-48 rounded-lg bg-slate-100"></div>
                <div className="mt-5 h-5 w-3/4 rounded bg-slate-100"></div>
                <div className="mt-3 h-4 w-full rounded bg-slate-100"></div>
              </div>
            ))}
          </div>
        )}

        {!loading && ebooks.length === 0 && (
          <div className="rounded-lg border border-line bg-white p-6 sm:p-8 text-center shadow-sm">
            <span className="material-symbols-outlined text-5xl text-orange-400">auto_stories</span>
            <h2 className="mt-3 text-xl sm:text-2xl font-black text-navy">Ebooks are being uploaded</h2>
            <p className="mt-2 text-sm font-bold text-muted">Add ebook records in Supabase and they will appear here automatically.</p>
          </div>
        )}

        {!loading && ebooks.length > 0 && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {displayedEbooks.map((ebook, index) => {
              const pricing = getEbookPricing(ebook);
              const owned = libraryById.has(ebook.id);
              const libraryItem = libraryById.get(ebook.id);
              const isPaymentBusy = activePaymentId === ebook.id;
              const isAccessBusy = activeAccessId === ebook.id;
              const isBusy = isPaymentBusy || isAccessBusy;
              const generationStatus = libraryItem?.generation_status || 'pending';
              const appliedCoupon = appliedCoupons[ebook.id];
              const couponDraft = couponDrafts[ebook.id] || '';
              const couponBusy = couponLoadingEbookId === ebook.id;
              const finalEbookPrice = appliedCoupon?.final_amount_inr || pricing.price;

              return (
                <article
                  id={`ebook-${ebook.id}`}
                  key={ebook.id}
                  className={`group flex h-full scroll-mt-24 flex-col overflow-hidden rounded-lg border bg-white shadow-sm transition duration-300 hover:shadow-xl sm:hover:-translate-y-1 ${
                    ebook.id === featuredEbookId
                      ? 'border-orange-400 ring-4 ring-orange-100 shadow-xl'
                      : 'border-line'
                  }`}
                >
                  <div className="relative bg-[#F4EEE7] px-4 pb-4 pt-4 sm:px-5 sm:pt-5">
                    {ebook.cover_url ? (
                      <img
                        src={ebook.cover_url}
                        alt={ebook.title}
                        className="mx-auto aspect-[3/4] w-full max-w-[136px] rounded-md object-cover shadow-[0_16px_30px_rgba(15,23,42,0.18)] ring-1 ring-black/10 sm:max-w-[190px] sm:shadow-[0_18px_38px_rgba(15,23,42,0.22)]"
                      />
                    ) : (
                      <div className="mx-auto flex aspect-[3/4] w-full max-w-[136px] flex-col justify-between rounded-md p-3 text-white shadow-[0_16px_30px_rgba(15,23,42,0.18)] ring-1 ring-black/10 sm:max-w-[190px] sm:p-4 sm:shadow-[0_18px_38px_rgba(15,23,42,0.22)]" style={{ background: getCoverStyle(index) }}>
                        <div>
                          <p className="text-[10px] font-black uppercase tracking-[0.18em] text-white/70">Dronna Ebook</p>
                          <h3 className="mt-3 text-base font-black leading-tight sm:mt-4 sm:text-xl">{ebook.title}</h3>
                        </div>
                        <span className="material-symbols-outlined text-3xl sm:text-4xl">auto_stories</span>
                      </div>
                    )}
                    <div className="absolute right-3 top-3 rounded-full bg-white px-2.5 py-1 text-[10px] font-black text-navy shadow-sm sm:px-3 sm:text-[11px]">
                      {owned ? (generationStatus === 'ready' ? 'Ready' : 'Owned') : 'Protected'}
                    </div>
                  </div>

                  <div className="flex flex-1 flex-col p-3.5 sm:p-4">
                    <div>
                      <h2 className="text-base sm:text-lg font-black leading-tight text-navy">{ebook.title}</h2>
                      {ebook.subtitle && <p className="mt-1 text-sm font-bold leading-5 text-muted">{ebook.subtitle}</p>}
                    </div>

                    {ebook.description && (
                      <p className="mt-2 sm:mt-3 line-clamp-2 text-sm font-semibold leading-6 text-steel">{ebook.description}</p>
                    )}

                    <div className="mt-3 sm:mt-4 flex flex-wrap gap-2 text-[10px] sm:text-[11px] font-black uppercase tracking-wide text-muted">
                      {ebook.pages && <span className="rounded-lg bg-slate-100 px-2.5 py-1.5 sm:px-3 sm:py-2">{ebook.pages} pages</span>}
                      <span className="rounded-lg bg-slate-100 px-2.5 py-1.5 sm:px-3 sm:py-2">{ebook.file_type || 'PDF'}</span>
                      {ebook.tags?.slice?.(0, 2)?.map((tag) => (
                        <span key={tag} className="rounded-lg bg-orange-50 px-2.5 py-1.5 text-orange-700 sm:px-3 sm:py-2">{tag}</span>
                      ))}
                    </div>

                    <div className="mt-auto pt-4 sm:pt-5">
                      <div className="mb-3">
                        <div className="flex flex-wrap items-end gap-2">
                          <span className="text-xl sm:text-2xl font-black text-orange-700">Rs {finalEbookPrice}</span>
                          {pricing.hasDiscount && <span className="pb-1 text-sm font-bold text-gray-400 line-through">Rs {pricing.mrp}</span>}
                          {pricing.discountPercent > 0 && (
                            <span className="mb-1 rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-black text-green-700">
                              {pricing.discountPercent}% OFF
                            </span>
                          )}
                        </div>
                        {appliedCoupon?.coupon && (
                          <div className="mt-2 text-xs font-black text-green-700">
                            {appliedCoupon.coupon.code} applied. Saved Rs {appliedCoupon.discount_inr}
                          </div>
                        )}
                        {owned && <EbookPasswordNotice password={libraryItem?.download_password} />}
                        {owned && generationStatus !== 'ready' && (
                          <p className="mt-1 text-xs font-bold text-orange-700">
                            {generationStatus === 'failed' ? 'Protected PDF will be regenerated on open.' : 'Protected PDF will be prepared on first open.'}
                          </p>
                        )}
                      </div>

                      {!owned && (
                        <div className="mb-3 rounded-lg border border-dashed border-orange-200 bg-white p-2">
                          <div className="flex flex-col gap-2 min-[360px]:flex-row">
                            <input
                              className="min-w-0 flex-1 text-xs uppercase"
                              placeholder="Coupon code"
                              value={couponDraft}
                              onChange={(event) => {
                                const value = event.target.value;
                                setCouponDrafts((current) => ({ ...current, [ebook.id]: value }));
                                if (appliedCoupon && normalizeCouponCode(value) !== appliedCoupon.coupon?.code) {
                                  removeEbookCoupon(ebook.id);
                                }
                              }}
                            />
                            <button
                              type="button"
                              className="rounded-lg bg-navy px-3 py-2.5 text-xs font-black text-white disabled:cursor-wait disabled:opacity-60"
                              disabled={couponBusy}
                              onClick={() => validateEbookCoupon(ebook)}
                            >
                              {couponBusy ? '...' : 'Apply'}
                            </button>
                          </div>
                          {appliedCoupon?.coupon && (
                            <button
                              type="button"
                              className="mt-2 text-xs font-black text-gray-500 hover:text-red-500"
                              onClick={() => removeEbookCoupon(ebook.id)}
                            >
                              Remove coupon
                            </button>
                          )}
                        </div>
                      )}

                      <button
                        type="button"
                        className={`${owned ? 'btn-navy' : 'btn-primary'} w-full justify-center py-3 text-sm disabled:cursor-wait disabled:opacity-70`}
                        disabled={isBusy}
                        onClick={() => owned ? openPurchasedEbook(ebook) : startEbookPurchase(ebook, appliedCoupon?.coupon?.code || couponDraft)}
                      >
                        <span className="material-symbols-outlined text-lg">{owned ? 'visibility' : 'shopping_bag'}</span>
                        {isAccessBusy ? 'Preparing Ebook...' : isPaymentBusy ? 'Starting Payment...' : owned ? 'Open Ebook' : `Buy Ebook Rs ${finalEbookPrice}`}
                      </button>

                      <ShareBtn
                        title={`${ebook.title} | ${APP_SHARE_TITLE}`}
                        text={buildEbookShareText(ebook, { price: finalEbookPrice })}
                        url={getEbookPublicShareUrl(ebook)}
                        label="Share Ebook"
                        className="mt-2 w-full justify-center rounded-lg border border-orange-200 bg-orange-50 px-3 py-2.5 text-sm text-orange-800 hover:border-orange-300 hover:bg-orange-100"
                      />
                    </div>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
