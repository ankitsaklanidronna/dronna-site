export const APP_SHARE_TITLE = "Dronna - UKPSC & UKSSSC Mock Tests";

export function getShareUrl(path = "/") {
  return `${window.location.href.split("#")[0]}#${path}`;
}

export function getCoursePublicShareUrl(folder = {}) {
  const courseId = folder?.id ? `?course=${encodeURIComponent(folder.id)}` : "";
  return getShareUrl(`/${courseId}`);
}

export function buildPromoShareText(lines = []) {
  return [
    ...lines,
    "Prepare for UKPSC and UKSSSC with Dronna.",
    "Use the current practice sets, daily challenge, syllabus and score tracking in the app.",
  ].join("\n");
}

export function getCourseShareName(folder = {}) {
  const courseName = (folder.name || "Dronna Course").trim();
  return /\b(practice\s*set|mock\s*test|test|sets?)\b/i.test(courseName)
    ? courseName
    : `${courseName} Practice Set`;
}

export function buildCourseShareText(folder = {}, { setCount = 0, questionCount = 0, hasPaidContent = false, price } = {}) {
  const courseName = getCourseShareName(folder);
  const details = [`Explore ${courseName} on Dronna.`];

  const statParts = [];
  if (setCount > 0) statParts.push(`${setCount} sets`);
  if (questionCount > 0) statParts.push(`${questionCount} questions`);
  if (statParts.length) details.push(`Includes ${statParts.join(" and ")}.`);
  if (hasPaidContent && price) details.push(`Price: Rs ${price}.`);
  details.push("Practice for UKPSC and UKSSSC with mock tests, progress tracking, and AI Coach.");

  return details.join("\n");
}

export async function shareContent({ title, text, url }) {
  const fullUrl = url || window.location.href.split("#")[0];
  if (navigator.share) {
    try {
      await navigator.share({ title, text, url: fullUrl });
      return "shared";
    } catch(e) { if (e.name === "AbortError") return "cancelled"; }
  }
  // Fallback: copy to clipboard
  try {
    await navigator.clipboard.writeText(text + "\n" + fullUrl);
    return "copied";
  } catch(e) {
    // Last resort
    const ta = document.createElement("textarea");
    ta.value = text + "\n" + fullUrl;
    document.body.appendChild(ta);
    ta.select(); document.execCommand("copy");
    document.body.removeChild(ta);
    return "copied";
  }
}
