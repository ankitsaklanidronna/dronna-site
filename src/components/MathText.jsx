import { useEffect, useRef } from 'react';
import { loadMathRenderer } from '../services/externalScripts.js';

export function normalizeInlineMath(content = "") {
  const placeholders = [];
  let text = String(content || "");
  const greekWordMap = {
    alpha: "\\alpha",
    beta: "\\beta",
    gamma: "\\gamma",
    delta: "\\delta",
    theta: "\\theta",
    lambda: "\\lambda",
    mu: "\\mu",
    pi: "\\pi",
    sigma: "\\sigma",
    phi: "\\phi",
    omega: "\\omega",
  };

  text = text.replace(/(\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]|\\\([\s\S]+?\\\)|\$[^$\n]+\$)/g, (match) => {
    const token = `__MATH_TOKEN_${placeholders.length}__`;
    placeholders.push(match);
    return token;
  });

  text = text.replace(
    /(\\(?:frac|dfrac|tfrac)\s*\{[^{}]+\}\s*\{[^{}]+\}|\\(?:sqrt|sum|prod|int|lim|log|ln|sin|cos|tan|cot|sec|cosec|theta|alpha|beta|gamma|delta|lambda|mu|pi|sigma|phi|omega|times|div|cdot|pm|mp|leq|geq|neq|approx|to|rightarrow|leftarrow|leftrightarrow|infty|therefore|because)(?:\s*\{[^{}]+\})*)/g,
    " \\($1\\) "
  );

  text = text.replace(
    /(^|[^\w\\])([A-Za-z0-9]+(?:_[A-Za-z0-9{}()+\-*/=,.]+|\^[A-Za-z0-9{}()+\-*/=,.]+)+(?:_[A-Za-z0-9{}()+\-*/=,.]+|\^[A-Za-z0-9{}()+\-*/=,.]+)*)/g,
    (match, prefix, expr) => `${prefix}\\(${expr}\\)`
  );

  text = text.replace(
    /(^|[^\w\\])(\([^()]+\)\^[A-Za-z0-9{}()+\-*/=,.]+)/g,
    (match, prefix, expr) => `${prefix}\\(${expr}\\)`
  );

  text = text.replace(
    /(^|[^\w\\])(alpha|beta|gamma|delta|theta|lambda|mu|pi|sigma|phi|omega)(?=$|[^\w])/gi,
    (match, prefix, greekWord) => `${prefix}\\(${greekWordMap[greekWord.toLowerCase()] || greekWord}\\)`
  );

  text = text.replace(/\s{2,}/g, " ");

  return text.replace(/__MATH_TOKEN_(\d+)__/g, (_, index) => placeholders[Number(index)] || "");
}

export function MathText({ content = "", as = "div", className = "", style = {} }) {
  const ref = useRef(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const preparedContent = normalizeInlineMath(content);
    let cancelled = false;

    node.innerHTML = "";
    node.textContent = preparedContent || "";

    const renderMath = async () => {
      const renderMathInElement = await loadMathRenderer();
      if (cancelled || !ref.current) return;

      renderMathInElement(ref.current, {
        throwOnError: false,
        strict: "ignore",
        delimiters: [
          { left: "$$", right: "$$", display: true },
          { left: "\\[", right: "\\]", display: true },
          { left: "\\(", right: "\\)", display: false },
          { left: "$", right: "$", display: false },
        ],
      });
    };

    renderMath();

    return () => {
      cancelled = true;
    };
  }, [content]);

  const Tag = as;
  return <Tag ref={ref} className={className} style={{ whiteSpace: "pre-wrap", ...style }} />;
}
