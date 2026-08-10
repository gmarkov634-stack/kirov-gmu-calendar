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
  const scriptUrl = new URL(document.currentScript.src);
  const mobileUrl = new URL("mobile.css", scriptUrl);
  const version = scriptUrl.searchParams.get("v");
  if (version) mobileUrl.searchParams.set("v", version);

  const omgmuMobileStyles = document.createElement("link");
  omgmuMobileStyles.rel = "stylesheet";
  omgmuMobileStyles.href = mobileUrl.href;
  document.head.append(omgmuMobileStyles);
}
