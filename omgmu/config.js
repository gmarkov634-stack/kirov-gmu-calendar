window.OMGMU_CONFIG = Object.freeze({
  university: "omgmu",
  program: "medicine-international",
  timezone: "Asia/Omsk",
  apiBaseUrl: "https://kgmu-calendar-api.containerapps.ru",
  paymentPath: "/api/v2/payments",
  priceRub: 490,
  testMode: true,
  checkoutEnabled: true,
});

if (typeof document !== "undefined" && document.currentScript) {
  const omgmuMobileStyles = document.createElement("link");
  omgmuMobileStyles.rel = "stylesheet";
  omgmuMobileStyles.href = new URL("mobile.css", document.currentScript.src).href;
  document.head.append(omgmuMobileStyles);
}
