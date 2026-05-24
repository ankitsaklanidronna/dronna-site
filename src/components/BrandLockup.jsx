export const BRAND_NAME = "DRONNA";

export const BRAND_LOGO_SRC = "/favicon.svg";

export function BrandMark({ size = 40, className = "", alt = "Dronna logo" }) {
  return (
    <img
      src={BRAND_LOGO_SRC}
      alt={alt}
      width={size}
      height={size}
      className={`shrink-0 rounded-2xl object-contain ${className}`}
      style={{ width: size, height: size }}
    />
  );
}

export function BrandLockup({ textClassName = "text-xl", textColorClassName = "text-navy", logoSize = 36, className = "", onClick = null }) {
  return (
    <div className={`flex items-center gap-2 ${onClick ? "cursor-pointer" : ""} ${className}`} onClick={onClick || undefined}>
      <BrandMark size={logoSize} />
      <span className={`font-extrabold tracking-tighter font-headline ${textColorClassName} ${textClassName}`}>
        {BRAND_NAME}
      </span>
    </div>
  );
}
