const WORKER = "https://api.ergodika.it";

const test = async () => {
  const r = await fetch(`${WORKER}/api/checkout/one-time`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ amount: 300, currency: "eur" })
  });
  console.log(await r.json());
};

test();
