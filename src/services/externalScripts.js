export let chartJsLoader;

export let mathRendererLoader;

export let razorpayScriptLoader;

export function loadChartJs() {
  if (!chartJsLoader) {
    chartJsLoader = import('chart.js/auto').then((module) => module.default);
  }
  return chartJsLoader;
}

export function loadMathRenderer() {
  if (!mathRendererLoader) {
    mathRendererLoader = Promise.all([
      import('katex/contrib/auto-render'),
      import('katex/dist/katex.min.css'),
    ]).then(([module]) => module.default);
  }
  return mathRendererLoader;
}

export function loadRazorpayCheckout() {
  if (window.Razorpay) return Promise.resolve(true);
  if (!razorpayScriptLoader) {
    razorpayScriptLoader = new Promise((resolve) => {
      const script = document.createElement("script");
      script.src = "https://checkout.razorpay.com/v1/checkout.js";
      script.async = true;
      script.onload = () => resolve(true);
      script.onerror = () => resolve(false);
      document.body.appendChild(script);
    });
  }
  return razorpayScriptLoader;
}
