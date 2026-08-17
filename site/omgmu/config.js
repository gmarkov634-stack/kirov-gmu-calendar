window.OMGMU_CONFIG = Object.freeze({
  university: "omgmu",
  apiBaseUrl: "https://kgmu-calendar-api.containerapps.ru",
  paymentPath: "/api/v2/payments",
  programLabels: Object.freeze({
    medicine: Object.freeze({ title: "Лечебное дело", code: "31.05.01" }),
    "medicine-international": Object.freeze({ title: "Лечебное дело", subtitle: "для иностранных обучающихся" }),
    pediatrics: Object.freeze({ title: "Педиатрия", code: "31.05.02" }),
    dentistry: Object.freeze({ title: "Стоматология", code: "31.05.03" }),
    "preventive-medicine": Object.freeze({ title: "Медико-профилактическое дело", code: "32.05.01" }),
    pharmacy: Object.freeze({ title: "Фармация", code: "33.05.01" }),
  }),
});

if (typeof document !== "undefined" && document.currentScript) {
  const omgmuMobileStyles = document.createElement("link");
  omgmuMobileStyles.rel = "stylesheet";
  omgmuMobileStyles.href = new URL("mobile.css", document.currentScript.src).href;
  document.head.appendChild(omgmuMobileStyles);
}
