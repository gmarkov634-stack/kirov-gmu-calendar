window.OMGMU_CONFIG = Object.freeze({
  university: "omgmu",
  timezone: "Asia/Omsk",
  apiBaseUrl: "https://kgmu-calendar-api.containerapps.ru",
  paymentPath: "/api/v2/payments",
  defaultPlan: "semester",
  programs: Object.freeze({
    "medicine-international": "Лечебное дело · иностранные обучающиеся",
    medicine: "Лечебное дело",
    pediatrics: "Педиатрия",
    dentistry: "Стоматология",
    "preventive-medicine": "Медико-профилактическое дело",
    pharmacy: "Фармация",
  }),
});

if (typeof document !== "undefined" && document.currentScript) {
  const omgmuMobileStyles = document.createElement("link");
  omgmuMobileStyles.rel = "stylesheet";
  omgmuMobileStyles.href = new URL("mobile.css", document.currentScript.src).href;
  document.head.append(omgmuMobileStyles);
}
