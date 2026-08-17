import assert from "node:assert/strict";
import test from "node:test";
import {
  commercialSku,
  publicCommercialOffers,
  resolveCommercialOffer,
} from "../src/offer-registry.js";

const config = {
  offers: {
    semester: { id: "semester", price: "299.00" },
    year: { id: "year", price: "499.00", expiresAt: "2027-08-31T23:59:59+03:00" },
  },
};

test("commercial SKU is stable and scoped to university, program and plan", () => {
  assert.equal(
    commercialSku({ university: "izhgmu", program: "medicine", plan: "semester" }),
    "calendar:izhgmu:medicine:semester",
  );
  assert.equal(
    commercialSku({ university: "omgmu", program: "medicine", plan: "semester" }),
    "calendar:omgmu:medicine:semester",
  );
  assert.equal(
    commercialSku({ university: "izhgmu", program: "pediatrics", plan: "semester" }),
    "calendar:izhgmu:pediatrics:semester",
  );
});

test("commercial SKU fails closed for unknown universities and malformed programs", () => {
  assert.equal(commercialSku({ university: "unknown", program: "medicine", plan: "semester" }), "");
  assert.equal(commercialSku({ university: "izhgmu", program: "Medicine!", plan: "semester" }), "");
  assert.equal(commercialSku({ university: "izhgmu", program: "medicine", plan: "month" }), "");
});

test("resolved offer keeps price server-owned while binding it to exact commercial context", () => {
  const offer = resolveCommercialOffer(config, {
    university: "omgmu",
    program: "medicine",
    plan: "semester",
  });
  assert.deepEqual(offer, {
    id: "semester",
    plan: "semester",
    price: "299.00",
    expiresAt: undefined,
    sku: "calendar:omgmu:medicine:semester",
  });
});

test("legacy unscoped public offer metadata keeps the existing price-only contract", () => {
  assert.deepEqual(publicCommercialOffers(config), {
    semester: { price: "299.00" },
    year: { price: "499.00" },
  });
});

test("scoped public offer metadata exposes stable SKU without creating local price authority", () => {
  assert.deepEqual(publicCommercialOffers(config, { university: "izhgmu", program: "medicine" }), {
    semester: { price: "299.00", sku: "calendar:izhgmu:medicine:semester" },
    year: { price: "499.00", sku: "calendar:izhgmu:medicine:year" },
  });
});

test("unsupported commercial context returns no public offers and cannot resolve checkout", () => {
  assert.deepEqual(publicCommercialOffers(config, { university: "unknown", program: "medicine" }), {});
  assert.throws(
    () => resolveCommercialOffer(config, { university: "unknown", program: "medicine", plan: "semester" }),
    (error) => error?.code === "offer_not_configured",
  );
});
