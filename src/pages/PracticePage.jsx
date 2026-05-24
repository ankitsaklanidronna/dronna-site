import { useEffect, useState } from 'react';
import { CourseFeatureList, buildCourseFeatureRows, getCourseCardTheme } from '../components/CourseFeatureList.jsx';
import { Navbar } from '../components/Navbar.jsx';
import { ShareBtn } from '../components/ShareBtn.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { getRouteSearchParams, useRouter } from '../context/RouterContext.jsx';
import { createRazorpayOrder, getRazorpayKeyId, loadRazorpayCheckout, validateRazorpayCoupon, verifyRazorpayPayment } from '../services/razorpay.js';
import { supabase } from '../services/supabaseClient.js';
import { getCoursePricing, normalizeCouponCode } from '../utils/pricing.js';
import { APP_SHARE_TITLE, buildCourseShareText, getCoursePublicShareUrl, getCourseShareName } from '../utils/share.js';

export function PracticePage() {
  const { page, navigate } = useRouter();
  const { user, login } = useAuth();
  
  const [dbSets, setDbSets] = useState([]);
  const [dbFolders, setDbFolders] = useState([]);
  const [purchasedFolderIds, setPurchasedFolderIds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadWarning, setLoadWarning] = useState("");
  const [folderStack, setFolderStack] = useState([]);
  const [paymentStatus, setPaymentStatus] = useState({ loadingSetId: "", message: "", type: "" });
  const [couponDrafts, setCouponDrafts] = useState({});
  const [appliedCoupons, setAppliedCoupons] = useState({});
  const [couponLoadingFolderId, setCouponLoadingFolderId] = useState("");
  const routeParams = getRouteSearchParams(page);
  const isMyCourseMode = routeParams.has("mine");

  useEffect(() => { loadData(); }, [user?.access_token, page]);

  const loadData = async () => {
    setLoading(true);
    const [setsRes, fRes, purchaseRes, countRes] = await Promise.all([
      supabase.getAll("practice_sets"),
      supabase.getFolders(),
      user?.access_token ? supabase.getCoursePurchases(user.access_token) : Promise.resolve({ data: [] }),
      supabase.getSetQuestionCounts({ accessToken: user?.access_token })
    ]);

    const countLoadFailed = Boolean(countRes?.error);

    // Merge count into each set without presenting failed count requests as zero.
    const countMap = countRes?.data || {};
    const allSets = (setsRes.data || []).map(s => ({
      ...s,
      question_count: countMap[s.id] ?? (Array.isArray(s.question_ids) ? s.question_ids.length : countLoadFailed ? null : 0),
      question_count_unavailable: countLoadFailed && countMap[s.id] === undefined && !Array.isArray(s.question_ids)
    }));
    const folders = fRes.ok ? fRes.data : [];
    const purchasedIds = (purchaseRes.data || []).map((row) => row.folder_id).filter(Boolean);
    const warning = [
      setsRes?.error ? "Practice sets could not be loaded." : "",
      countRes?.error ? "Question counts are temporarily unavailable." : "",
      !fRes.ok ? "Courses could not be loaded." : "",
      purchaseRes?.error ? "Your purchased course access could not be refreshed." : ""
    ].filter(Boolean)[0] || "";

    setDbSets(Array.from(new Map(allSets.map(item => [item.id, item])).values()));
    setDbFolders(folders);
    setPurchasedFolderIds(purchasedIds);
    setLoadWarning(warning);
    const selectedFolderId = getRouteSearchParams(page).get("folder");
    if (selectedFolderId) {
      const folderById = new Map(folders.map((folder) => [folder.id, folder]));
      const path = [];
      const seen = new Set();
      let current = folderById.get(selectedFolderId);
      while (current && !seen.has(current.id)) {
        path.unshift(current);
        seen.add(current.id);
        current = current.parent_id ? folderById.get(current.parent_id) : null;
      }
      if (path.length > 0) {
        const routeIsMyCourse = getRouteSearchParams(page).has("mine");
        const firstPurchasedIndex = routeIsMyCourse ? path.findIndex((folder) => purchasedIds.includes(folder.id)) : -1;
        setFolderStack(firstPurchasedIndex >= 0 ? path.slice(firstPurchasedIndex) : path);
      }
    } else {
      setFolderStack([]);
    }
    setLoading(false);
  };

  const currentFolderId = folderStack.length > 0 ? folderStack[folderStack.length-1].id : null;
  const visibleFolders = currentFolderId
    ? dbFolders.filter(f => f.parent_id === currentFolderId)
    : isMyCourseMode
      ? dbFolders.filter(f => purchasedFolderIds.includes(f.id))
      : dbFolders.filter(f => !f.parent_id);
  const visibleSets = currentFolderId
    ? dbSets.filter(s => s.folder_id === currentFolderId)
    : isMyCourseMode
      ? []
      : dbSets.filter(s => !s.folder_id || !dbFolders.find(f => f.id === s.folder_id));

  const getFolderById = (folderId) => dbFolders.find((folder) => folder.id === folderId) || null;

  const getFolderPath = (folderId) => {
    const path = [];
    const seen = new Set();
    let current = getFolderById(folderId);

    while (current && !seen.has(current.id)) {
      path.unshift(current);
      seen.add(current.id);
      current = current.parent_id ? getFolderById(current.parent_id) : null;
    }

    return path;
  };

  const isPaidByFolderPath = (folderId) => {
    const path = getFolderPath(folderId);
    // Root folders are categories. Paid access starts from subfolders/material folders.
    return path.some((folder, index) => index > 0 && Boolean(folder.is_paid));
  };

  const isSetAccessPaid = (set) => {
    return Boolean(set?.is_paid) || isPaidByFolderPath(set?.folder_id);
  };

  const hasPurchasedFolderAccess = (folderId) => {
    if (user?.isAdmin) return true;
    const path = getFolderPath(folderId);
    return path.some((folder) => purchasedFolderIds.includes(folder.id));
  };

  const getPaidCourseFolderForFolder = (folderId) => {
    const path = getFolderPath(folderId);
    return path.find((folder, index) => index > 0 && Boolean(folder.is_paid)) || null;
  };

  const hasSetAccess = (set) => {
    if (!isSetAccessPaid(set)) return true;
    return hasPurchasedFolderAccess(set?.folder_id);
  };

  const countSetsInFolder = (fid) => {
    const direct = dbSets.filter(s => s.folder_id === fid).length;
    return direct + dbFolders.filter(f => f.parent_id === fid).reduce((sum, c) => sum + countSetsInFolder(c.id), 0);
  };

  const countQuestionsInFolder = (fid) => {
    let total = 0;
    let hasUnknown = false;

    dbSets.filter(s => s.folder_id === fid).forEach((set) => {
      const count = getSetQuestionCount(set);
      if (count === null) {
        hasUnknown = true;
        return;
      }
      total += count;
    });

    dbFolders.filter(f => f.parent_id === fid).forEach((folder) => {
      const childCount = countQuestionsInFolder(folder.id);
      if (childCount === null) {
        hasUnknown = true;
        return;
      }
      total += childCount;
    });

    return hasUnknown ? null : total;
  };

  const getSetQuestionCount = (set) => {
    if (set?.question_count_unavailable) return null;
    const count = Number(set?.question_count);
    if (Number.isFinite(count)) return count;
    return Array.isArray(set?.question_ids) ? set.question_ids.length : null;
  };

  const formatCount = (value) => Number.isFinite(value) ? value.toLocaleString("en-IN") : "--";

  const startSet = async (set) => {
    if (!user) {
      navigate("/login");
      return;
    }

    if (hasSetAccess(set)) {
      navigate(`/quiz/${set.id}`);
      return;
    }

    setPaymentStatus({
      loadingSetId: "",
      message: "This test is locked. Buy the course card to unlock all material.",
      type: "error"
    });
  };

  const validateCourseCoupon = async (folder) => {
    if (!user) {
      navigate("/login");
      return;
    }
    const code = normalizeCouponCode(couponDrafts[folder.id] || "");
    if (!code) {
      setPaymentStatus({ loadingSetId: "", message: "Enter a coupon code first.", type: "error" });
      return;
    }

    setCouponLoadingFolderId(folder.id);
    setPaymentStatus({ loadingSetId: "", message: "", type: "" });
    const result = await validateRazorpayCoupon({
      plan: "pro",
      folder_id: folder.id,
      coupon_code: code
    }, user.access_token);
    setCouponLoadingFolderId("");

    if (result?.error || !result?.ok || !result?.coupon) {
      setAppliedCoupons((current) => {
        const next = { ...current };
        delete next[folder.id];
        return next;
      });
      setPaymentStatus({ loadingSetId: "", message: result?.error || "Coupon could not be applied.", type: "error" });
      return;
    }

    setAppliedCoupons((current) => ({
      ...current,
      [folder.id]: result
    }));
    setPaymentStatus({
      loadingSetId: "",
      message: `${result.coupon.code} applied. You saved Rs ${result.discount_inr}.`,
      type: "success"
    });
  };

  const removeCourseCoupon = (folderId) => {
    setAppliedCoupons((current) => {
      const next = { ...current };
      delete next[folderId];
      return next;
    });
  };

  const startProPurchase = async ({ loadingId, description, setId = null, couponCode = "" }) => {
    if (!user) {
      navigate("/login");
      return;
    }

    if (hasPurchasedFolderAccess(setId || loadingId?.replace("folder:", ""))) {
      setPaymentStatus({ loadingSetId: "", message: "This course is already active on your account.", type: "success" });
      return;
    }

    setPaymentStatus({ loadingSetId: loadingId, message: "", type: "" });
    try {
      const scriptReady = await loadRazorpayCheckout();
      if (!scriptReady || !window.Razorpay) {
        throw new Error("Razorpay checkout could not be loaded. Please check your internet connection.");
      }

      const order = await createRazorpayOrder({
        plan: "pro",
        folder_id: loadingId?.startsWith("folder:") ? loadingId.replace("folder:", "") : undefined,
        coupon_code: normalizeCouponCode(couponCode),
        ...(setId ? { set_id: setId } : {})
      }, user.access_token);

      if (order?.error || !order?.order_id) {
        throw new Error(order?.error || "Payment order could not be created.");
      }

      const checkout = new window.Razorpay({
        key: getRazorpayKeyId(order),
        amount: order.amount,
        currency: order.currency || "INR",
        name: "Dronna",
        description: `Pro access - ${description}`,
        order_id: order.order_id,
        prefill: {
          name: user.name || "",
          email: user.email || ""
        },
        theme: {
          color: "var(--saffron-dark)"
        },
        handler: async (response) => {
          const verified = await verifyRazorpayPayment(response, user.access_token);
          if (verified?.error || !verified?.ok) {
            setPaymentStatus({
              loadingSetId: "",
              message: verified?.error || "Payment verification failed. Please contact support if amount was debited.",
              type: "error"
            });
            return;
          }

          await login({
            ...user,
            name: verified.profile?.full_name || user.name,
            exam_target: verified.profile?.exam_target || user.exam_target,
            subscription_plan: verified.profile?.subscription_plan || "pro"
          });
          if (verified.folder_id) {
            setPurchasedFolderIds((current) => Array.from(new Set([...current, verified.folder_id])));
          }
          setPaymentStatus({ loadingSetId: "", message: "Payment successful. Course access activated.", type: "success" });
          navigate("/dashboard");
        },
        modal: {
          ondismiss: () => setPaymentStatus({ loadingSetId: "", message: "Payment cancelled.", type: "error" })
        }
      });

      checkout.on("payment.failed", (response) => {
        setPaymentStatus({
          loadingSetId: "",
          message: response?.error?.description || "Payment failed. Please try again.",
          type: "error"
        });
      });

      checkout.open();
    } catch (e) {
      setPaymentStatus({ loadingSetId: "", message: e.message || "Payment could not be started.", type: "error" });
    }
  };


  if (loading) return <div className="p-20 text-center devanagari">Loading...</div>;

  return (
    <div className="page bg-[#FDF8F3] min-h-screen">
      <Navbar />
      <div className="max-w-6xl mx-auto px-4 py-8">
        {loadWarning && (
          <div className="mb-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-bold text-amber-800">
            {loadWarning} Some counts may show -- until the connection recovers.
          </div>
        )}

        {/* Breadcrumbs */}
        <div className="flex items-center gap-2 mb-6 text-sm flex-wrap">
          <span
            className="cursor-pointer hover:text-orange-500 font-bold text-navy"
            onClick={() => { setFolderStack([]); navigate(isMyCourseMode ? "/practice?mine=1" : "/practice"); }}
          >
             {isMyCourseMode ? "My Course" : "Course Store"}
          </span>
          {folderStack.map((f, i) => (
            <span key={f.id} className="flex items-center gap-2">
              <span className="text-gray-400">/</span>
                <span
                  className={`font-bold cursor-pointer ${i === folderStack.length-1 ? "text-orange-600" : "text-gray-500 hover:text-orange-400"}`}
                  onClick={() => {
                    if (i >= folderStack.length - 1) return;
                    setFolderStack(folderStack.slice(0, i + 1));
                    navigate(`/practice?${isMyCourseMode ? "mine=1&" : ""}folder=${f.id}`);
                  }}
                >{f.name}</span>
            </span>
          ))}
        </div>

        {/* Courses */}
        {visibleFolders.length > 0 && (
          <div className="mb-8">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 fade-in">
              {visibleFolders.map(folder => {
                const subCount = dbFolders.filter(f => f.parent_id === folder.id).length;
                const setCount = countSetsInFolder(folder.id);
                const questionCount = countQuestionsInFolder(folder.id);
                const folderIsPaidMaterial = isPaidByFolderPath(folder.id);
                const folderLocked = folderIsPaidMaterial && !hasPurchasedFolderAccess(folder.id);
                const folderPaymentLoading = paymentStatus.loadingSetId === `folder:${folder.id}`;
                const pricing = getCoursePricing(folder);
                const appliedCoupon = appliedCoupons[folder.id];
                const finalCoursePrice = appliedCoupon?.final_amount_inr || pricing.salePrice;
                const couponDraft = couponDrafts[folder.id] || "";
                const couponBusy = couponLoadingFolderId === folder.id;
                const theme = getCourseCardTheme(folder.name);
                const courseFeatures = buildCourseFeatureRows({
                  setCount,
                  questionCount,
                  hasPaidContent: folderIsPaidMaterial
                });
                const courseShareUrl = getCoursePublicShareUrl(folder);
                const courseShareText = buildCourseShareText(folder, {
                  setCount,
                  questionCount,
                  hasPaidContent: folderIsPaidMaterial,
                  price: folderIsPaidMaterial ? finalCoursePrice : undefined
                });
                return (
                  <article
                    key={folder.id}
                    onClick={() => {
                      setFolderStack([...folderStack, folder]);
                      navigate(`/practice?${isMyCourseMode ? "mine=1&" : ""}folder=${folder.id}`);
                    }}
                    className="group flex min-h-[500px] cursor-pointer flex-col overflow-hidden rounded-lg border bg-white shadow-sm transition-all duration-300 hover:-translate-y-1 hover:shadow-xl"
                    style={{borderColor:theme.line}}
                  >
                    <div className="relative min-h-[150px] p-5 text-white" style={{background:theme.cover}}>
                      <div className="flex items-start justify-between gap-3">
                        <span className="rounded-full bg-white/16 px-3 py-1 text-[11px] font-black uppercase tracking-[0.18em] ring-1 ring-white/25">
                          {folderLocked ? "Locked Course" : folderIsPaidMaterial ? "Active Course" : "Course Category"}
                        </span>
                        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white/15 ring-1 ring-white/25">
                          <span className="material-symbols-outlined" style={{ fontVariationSettings: "'FILL' 1" }}>
                            {folderLocked ? "lock" : "school"}
                          </span>
                        </span>
                      </div>
                      <div className="mt-8">
                        <p className="text-xs font-black uppercase tracking-[0.22em] text-white/75">Dronna Course</p>
                        <h3 className="mt-2 text-2xl font-black leading-tight text-white">{folder.name}</h3>
                      </div>
                    </div>

                    <div className="flex flex-1 flex-col p-4">
                      <div className="grid grid-cols-2 gap-2 text-center">
                        <div className="rounded-lg px-2 py-3" style={{background:theme.soft}}>
                          <span className="block text-xl font-black" style={{color:theme.ink}}>{formatCount(setCount)}</span>
                          <span className="text-[10px] font-black uppercase tracking-wide" style={{color:theme.accentDark}}>Sets</span>
                        </div>
                        <div className="rounded-lg bg-slate-50 px-2 py-3">
                          <span className="block text-xl font-black" style={{color:theme.ink}}>{formatCount(questionCount)}</span>
                          <span className="text-[10px] font-black uppercase tracking-wide text-slate-500">Questions</span>
                        </div>
                      </div>

                      <CourseFeatureList features={courseFeatures} className="mt-4" />

                      {folderLocked && (
                        <div className="mt-4 rounded-lg border px-3 py-3" style={{borderColor:"#FED7AA", background:"#FFF7ED"}}>
                          <div className="flex flex-wrap items-end gap-2">
                            {pricing.hasDiscount && <span className="text-xs font-bold text-gray-400 line-through">Rs {pricing.mrp}</span>}
                            <span className="text-2xl font-black text-orange-700">Rs {finalCoursePrice}</span>
                            {pricing.hasDiscount && (
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
                        </div>
                      )}

                      {folderLocked && (
                        <div className="mt-3 rounded-lg border border-dashed border-orange-200 bg-white p-2">
                          <div className="flex gap-2">
                            <input
                              className="min-w-0 flex-1 text-xs uppercase"
                              placeholder="Coupon code"
                              value={couponDraft}
                              onChange={(event) => {
                                const value = event.target.value;
                                setCouponDrafts((current) => ({ ...current, [folder.id]: value }));
                                if (appliedCoupon && normalizeCouponCode(value) !== appliedCoupon.coupon?.code) {
                                  removeCourseCoupon(folder.id);
                                }
                              }}
                              onClick={(event) => event.stopPropagation()}
                            />
                            <button
                              type="button"
                              className="rounded-lg bg-navy px-3 py-2 text-xs font-black text-white disabled:cursor-wait disabled:opacity-60"
                              disabled={couponBusy}
                              onClick={(event) => {
                                event.stopPropagation();
                                validateCourseCoupon(folder);
                              }}
                            >
                              {couponBusy ? "..." : "Apply"}
                            </button>
                          </div>
                          {appliedCoupon?.coupon && (
                            <button
                              type="button"
                              className="mt-2 text-xs font-black text-gray-500 hover:text-red-500"
                              onClick={(event) => {
                                event.stopPropagation();
                                removeCourseCoupon(folder.id);
                              }}
                            >
                              Remove coupon
                            </button>
                          )}
                        </div>
                      )}

                      {folderLocked ? (
                        <button
                          className="mt-auto w-full rounded-lg bg-orange-500 px-4 py-3 text-sm font-black text-white transition hover:bg-orange-600 disabled:cursor-wait disabled:opacity-70"
                          disabled={folderPaymentLoading}
                          onClick={(event) => {
                            event.stopPropagation();
                            startProPurchase({
                              loadingId: `folder:${folder.id}`,
                              description: folder.name,
                              couponCode: appliedCoupon?.coupon?.code || couponDraft
                            });
                          }}
                        >
                          {folderPaymentLoading ? "Starting Payment..." : `Buy Course Rs ${finalCoursePrice}`}
                        </button>
                      ) : (
                        <div className="mt-auto flex items-center justify-between rounded-lg px-3 py-3 text-sm font-black" style={{background:theme.soft, color:theme.accentDark}}>
                          <span>{folderIsPaidMaterial ? "Access active" : "Open category"}</span>
                          <span className="material-symbols-outlined text-lg">arrow_forward</span>
                        </div>
                      )}
                      <ShareBtn
                        title={`${getCourseShareName(folder)} | ${APP_SHARE_TITLE}`}
                        text={courseShareText}
                        url={courseShareUrl}
                        label="Share Course"
                        stopPropagation
                        className="mt-2 w-full justify-center rounded-lg border px-4 py-3 text-sm text-slate-600 hover:border-orange-300 hover:bg-orange-50 hover:text-orange-600"
                      />
                    </div>
                  </article>
                );
              })}
            </div>
          </div>
        )}

        {/* Sets */}
        {paymentStatus.message && (
          <div className={`mb-5 rounded-xl border px-4 py-3 text-sm font-bold ${
            paymentStatus.type === "success"
              ? "border-green-200 bg-green-50 text-green-700"
              : "border-red-200 bg-red-50 text-red-600"
          }`}>
            {paymentStatus.message}
          </div>
        )}
        {visibleSets.length > 0 && (
          <div className="fade-in">
            {folderStack.length > 0 && (
              <h2 className="text-xl font-black text-navy mb-4"> Sets in {folderStack[folderStack.length-1].name}</h2>
            )}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {visibleSets.map(set => {
                const setAccessPaid = isSetAccessPaid(set);
                const isLocked = setAccessPaid && !hasSetAccess(set);
                const isPaymentLoading = paymentStatus.loadingSetId === set.id;
                const courseFolder = getPaidCourseFolderForFolder(set.folder_id);
                const pricing = getCoursePricing(courseFolder || {});
                return (
                <div key={set.id} className="card relative overflow-hidden group">
                  {setAccessPaid && (
                    <div className="absolute top-0 right-0 bg-orange-500 text-white text-[10px] px-3 py-1 font-bold rounded-bl-xl uppercase">PRO</div>
                  )}
                  <h3 className="font-bold text-navy mb-4 devanagari text-lg pr-10">{set.set_name}</h3>
                  <div className="flex gap-4 text-xs text-gray-500 mb-6 font-medium">
                    <span> {formatCount(getSetQuestionCount(set))} questions</span>
                    <span> {set.time_limit_minutes} mins</span>
                    {setAccessPaid && <span> Rs {pricing.salePrice}</span>}
                  </div>
                  {setAccessPaid && (
                    <div className="mb-4 rounded-xl border border-purple-100 bg-purple-50 px-3 py-2 text-xs font-black uppercase tracking-wide text-purple-700">
                      AI Performance Analyzer included
                    </div>
                  )}
                  <div className="flex gap-2">
                    <button
                      className={`flex-1 justify-center border-none transition-colors ${
                        isLocked
                          ? "rounded-xl bg-gray-200 px-4 py-2 font-black text-gray-500 cursor-not-allowed"
                          : "btn-navy group-hover:bg-orange-500"
                      }`}
                      onClick={() => startSet(set)}
                      disabled={isPaymentLoading || isLocked}
                    >
                      {isPaymentLoading ? "Starting Payment..." : isLocked ? "Locked" : user ? "Start Test" : "Login to Start"}
                    </button>
                    <ShareBtn
                      title={set.set_name}
                      text={` ${set.set_name}\n Dronna  UKPSC & UKSSSC Exam Preparation\nPractice for free on Dronna.`}
                      url={window.location.href.split("#")[0] + "#/practice"}
                      label=""
                      className="px-4 py-2 rounded-xl border-2 border-gray-200 hover:border-orange-400 hover:text-orange-500 text-gray-400 bg-white"
                    />
                  </div>
                </div>
              );
              })}
            </div>
          </div>
        )}

        {/* Empty */}
        {visibleFolders.length === 0 && visibleSets.length === 0 && (
          <div className="text-center py-20 text-gray-400">
            <div className="text-5xl mb-4"></div>
            <p className="font-hindi text-lg">
              {folderStack.length > 0
                ? "This course is empty right now."
                : isMyCourseMode
                  ? "No purchased courses are active right now."
                  : "No courses are available right now."}
            </p>
            {folderStack.length > 0 && (
              <button
                className="mt-4 btn-outline py-1 px-4 text-sm"
                onClick={() => { setFolderStack([]); navigate(isMyCourseMode ? "/practice?mine=1" : "/practice"); }}
              >
                Go Back
              </button>
            )}
          </div>
        )}

      </div>
    </div>
  );
}
