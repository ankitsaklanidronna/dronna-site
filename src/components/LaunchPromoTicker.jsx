export function LaunchPromoTicker({ onClick }) {
  const promoItems = [
    "Launching offer",
    "Apply coupon code NEW50",
    "Get 50% off on premium courses",
    "Limited period discount for new students"
  ];
  const tickerItems = [...promoItems, ...promoItems, ...promoItems];

  return (
    <button
      type="button"
      onClick={onClick}
      className="promo-ticker group w-full overflow-hidden border-y border-orange-200 bg-orange-50 text-left text-orange-800"
    >
      <div className="promo-ticker-track py-2.5">
        {tickerItems.map((item, index) => (
          <span key={`${item}-${index}`} className="promo-ticker-item">
            <span className="material-symbols-outlined text-[17px]" style={{ fontVariationSettings: "'FILL' 1" }}>
              local_offer
            </span>
            <span>{item}</span>
          </span>
        ))}
      </div>
    </button>
  );
}
